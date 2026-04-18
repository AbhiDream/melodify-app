require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
app.use(cors());
app.use(express.json());

// ── Static files ──────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Keep-alive ────────────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => http.get(`${SELF_URL}/health`).on('error', () => {}), 8 * 60 * 1000);
}
app.get('/health', (req, res) => res.send('OK'));
app.get('/debug', (req, res) => {
  exec('which yt-dlp && yt-dlp --version', (err, stdout) => {
    exec('which ffmpeg && ffmpeg -version 2>&1 | head -1', (err2, stdout2) => {
      res.json({ yt_dlp: err ? 'NOT FOUND' : stdout.trim(), ffmpeg: err2 ? 'NOT FOUND' : stdout2.trim(), cwd: __dirname });
    });
  });
});

// ── Chunks directory ──────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(__dirname, "chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// ══════════════════════════════════════════════════════
// SEARCH CACHE — avoid hitting YouTube for same query
// ══════════════════════════════════════════════════════
const searchCache = new Map(); // query → { results, ts }
const SEARCH_TTL = 10 * 60 * 1000; // 10 minutes

app.get("/search", (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: "No query" });

  // Return cached result immediately
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) {
    console.log(`[search cache] hit: ${query}`);
    return res.json(cached.results);
  }

  console.log(`[search] querying: ${query}`);

  // --flat-playlist = only basic metadata, much faster than full --dump-json
  // ytsearch5 instead of 8 = faster (5 results is plenty)
  // --no-warnings = skip warning output
  const cmd = `yt-dlp "ytsearch5:${query}" --flat-playlist --dump-json --no-download --no-warnings`;

  exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const results = stdout.trim().split("\n").filter(Boolean).map(line => {
        const d = JSON.parse(line);
        return {
          id: d.id,
          title: d.title,
          duration: d.duration || 0,
          thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
          uploader: d.uploader || d.channel || d.uploader_id || "Unknown",
        };
      });
      searchCache.set(query, { results, ts: Date.now() });
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: "Parse error" });
    }
  });
});

// ══════════════════════════════════════════════════════
// AUDIO URL CACHE — #1 speedup: don't call yt-dlp --get-url
// for every single chunk of the same song
// ══════════════════════════════════════════════════════
const audioUrlCache = new Map(); // videoId → { url, ts }
const AUDIO_URL_TTL = 5 * 60 * 60 * 1000; // YouTube URLs expire ~6h, cache 5h

function getAudioUrl(videoId) {
  const cached = audioUrlCache.get(videoId);
  if (cached && Date.now() - cached.ts < AUDIO_URL_TTL) {
    console.log(`[url cache] hit: ${videoId}`);
    return Promise.resolve(cached.url);
  }

  return new Promise((resolve, reject) => {
    console.log(`[yt-dlp] fetching URL for ${videoId}`);
    const cmd = `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-warnings "https://www.youtube.com/watch?v=${videoId}"`;
    exec(cmd, { timeout: 20000 }, (err, stdout) => {
      if (err || !stdout.trim()) return reject(err || new Error("No URL"));
      const url = stdout.trim().split("\n")[0];
      audioUrlCache.set(videoId, { url, ts: Date.now() });
      console.log(`[yt-dlp] got URL for ${videoId}`);
      resolve(url);
    });
  });
}

// ══════════════════════════════════════════════════════
// CHUNK ENDPOINT — uses cached audio URL, fast seek
// ══════════════════════════════════════════════════════
const chunkLocks = new Set();

app.get("/chunk/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const start    = parseFloat(req.query.start)    || 0;
  const duration = parseFloat(req.query.duration) || 30;
  const chunkFile = path.join(CHUNK_DIR, `${videoId}_${start}_${duration}.mp3`);

  // Serve from disk cache immediately
  if (fs.existsSync(chunkFile)) {
    console.log(`[chunk] cache hit ${videoId}@${start}`);
    return res.sendFile(chunkFile);
  }

  // Queue if already being generated
  if (chunkLocks.has(chunkFile)) {
    let attempts = 0;
    const iv = setInterval(() => {
      if (!chunkLocks.has(chunkFile) || attempts++ > 60) {
        clearInterval(iv);
        if (fs.existsSync(chunkFile)) res.sendFile(chunkFile);
        else res.status(500).json({ error: "Concurrent generation failed" });
      }
    }, 300);
    return;
  }

  chunkLocks.add(chunkFile);
  console.log(`[chunk] generating ${videoId}@${start}s`);

  try {
    const audioUrl = await getAudioUrl(videoId);

    const ffCmd = [
      'ffmpeg',
      '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
      `-ss ${start}`,            // seek BEFORE -i = instant (no decode needed)
      `-t ${duration}`,
      `-i "${audioUrl}"`,
      '-vn -acodec libmp3lame -ab 128k -ar 44100 -ac 2',
      '-y',
      `"${chunkFile}"`
    ].join(' ');

    exec(ffCmd, { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }, (err) => {
      chunkLocks.delete(chunkFile);
      if (err || !fs.existsSync(chunkFile)) {
        // Bust URL cache on failure — URL may have expired
        audioUrlCache.delete(videoId);
        console.error(`[chunk] failed ${videoId}@${start}:`, err?.message);
        return res.status(500).json({ error: "Chunk failed" });
      }
      console.log(`[chunk] done ${videoId}@${start}`);
      res.sendFile(chunkFile);
    });
  } catch (err) {
    chunkLocks.delete(chunkFile);
    console.error(`[chunk] url fetch failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cleanup old chunks ────────────────────────────────────────────────────────
app.delete("/chunk/:videoId", (req, res) => {
  const { videoId } = req.params;
  const keepFrom = Math.max(0, (parseFloat(req.query.keepStart) || 0) - 30);
  try {
    fs.readdirSync(CHUNK_DIR).filter(f => f.startsWith(`${videoId}_`)).forEach(f => {
      const parts = f.replace(".mp3", "").split("_");
      const cs = parseFloat(parts[parts.length - 2]);
      if (cs < keepFrom) try { fs.unlinkSync(path.join(CHUNK_DIR, f)); } catch(_) {}
    });
  } catch(_) {}
  res.json({ ok: true });
});

// ── Trending (cached 1h) ──────────────────────────────────────────────────────
let trendingCache = null, trendingFetchedAt = 0;
const TRENDING_TTL = 60 * 60 * 1000;

app.get("/trending", (req, res) => {
  if (trendingCache && Date.now() - trendingFetchedAt < TRENDING_TTL)
    return res.json(trendingCache);

  // Direct trending page first, fallback to search
  const cmd = `yt-dlp "https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D" --flat-playlist --dump-json --no-download --no-warnings --playlist-end 10`;
  exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
    const fallback = () => {
      exec(`yt-dlp "ytsearch10:top hindi songs 2025" --flat-playlist --dump-json --no-download --no-warnings`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err2, stdout2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          try { const r = parseLines(stdout2); trendingCache = r; trendingFetchedAt = Date.now(); res.json(r); }
          catch(e) { res.status(500).json({ error: "Parse error" }); }
        });
    };
    if (err) return fallback();
    try { const r = parseLines(stdout); trendingCache = r; trendingFetchedAt = Date.now(); res.json(r); }
    catch(e) { fallback(); }
  });
});

function parseLines(stdout) {
  return stdout.trim().split("\n").filter(Boolean).slice(0, 10).map(line => {
    const d = JSON.parse(line);
    return { id: d.id, title: d.title, duration: d.duration || 0,
      thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
      uploader: d.uploader || d.channel || d.uploader_id || "Unknown" };
  });
}

// ── Video info ────────────────────────────────────────────────────────────────
app.get("/info/:videoId", (req, res) => {
  const { videoId } = req.params;
  exec(`yt-dlp "https://www.youtube.com/watch?v=${videoId}" --dump-json --no-download --no-warnings`,
    { maxBuffer: 5 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        const d = JSON.parse(stdout.trim());
        res.json({ id: d.id, title: d.title, duration: d.duration, thumbnail: d.thumbnail, uploader: d.uploader || d.channel });
      } catch(e) { res.status(500).json({ error: "Parse error" }); }
    });
});

// ── AI DJ ─────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
app.post("/api/ai-dj", async (req, res) => {
  const { mood, history } = req.body;
  if (!mood) return res.status(400).json({ error: "No mood provided" });
  try {
    const prompt = `You are a Spotify AI DJ.
User Mood: ${mood}
Recent Listens: ${history?.length ? history.join(", ") : "None"}
Recommend exactly 10 real popular songs matching this mood. Prefer Indian/Hindi/Punjabi and Global hits.
Output ONLY a JSON array, no markdown:
[{"title":"Song","artist":"Artist","search_query":"Song Artist official audio"}]`;
    const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }] }),
    });
    if (!apiRes.ok) throw new Error(`Groq ${apiRes.status}`);
    const data = await apiRes.json();
    let text = data.choices[0].message.content.trim().replace(/^```(json)?/, "").replace(/```$/, "").trim();
    const recs = JSON.parse(text);
    const promises = recs.map(song => new Promise(resolve => {
      const q = song.search_query.replace(/"/g, '');
      // Check search cache first
      const cached = searchCache.get(q);
      if (cached && Date.now() - cached.ts < SEARCH_TTL && cached.results[0]) return resolve(cached.results[0]);
      exec(`yt-dlp "ytsearch1:${q}" --flat-playlist --dump-json --no-download --no-warnings`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 20000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          try {
            const d = JSON.parse(stdout.trim());
            resolve({ id: d.id, title: d.title, duration: d.duration || 0,
              thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
              uploader: d.uploader || d.channel || "Unknown" });
          } catch(e) { resolve(null); }
        });
    }));
    res.json((await Promise.all(promises)).filter(Boolean));
  } catch(error) {
    console.error("AI DJ Error:", error.message);
    res.status(500).json({ error: "Failed to generate playlist" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎵 Melodify running on http://localhost:${PORT}`));
