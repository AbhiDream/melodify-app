require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
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

// ── Keep-alive ping ───────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    http.get(`${SELF_URL}/health`).on('error', () => {});
  }, 8 * 60 * 1000);
}
app.get('/health', (req, res) => res.send('OK'));

// ── Debug endpoint ────────────────────────────────────────────────────────────
app.get('/debug', (req, res) => {
  exec('which yt-dlp && yt-dlp --version', (err, stdout) => {
    const ytdlp = err ? `NOT FOUND: ${err.message}` : stdout.trim();
    exec('which ffmpeg && ffmpeg -version 2>&1 | head -1', (err2, stdout2) => {
      const ffmpeg = err2 ? `NOT FOUND: ${err2.message}` : stdout2.trim();
      res.json({ yt_dlp: ytdlp, ffmpeg, cwd: __dirname, chunks_dir: CHUNK_DIR });
    });
  });
});

// ── Chunks directory ──────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(__dirname, "chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// ── Full audio file cache ─────────────────────────────────────────────────────
// Instead of streaming from YouTube CDN (blocked on Render), we download the
// full audio file once via yt-dlp, then ffmpeg trims it locally.
// Cache: videoId → { filePath, ts }
const fullAudioCache = {};
const FULL_AUDIO_TTL = 4 * 60 * 60 * 1000; // 4 hours
const fullAudioLocks = new Set(); // videoIds currently being downloaded
const fullAudioWaiters = {}; // videoId → [{ resolve, reject }]

function getFullAudio(videoId) {
  // Return cached path if still fresh
  const entry = fullAudioCache[videoId];
  if (entry && fs.existsSync(entry.filePath) && Date.now() - entry.ts < FULL_AUDIO_TTL) {
    console.log(`[audio-cache] hit for ${videoId}`);
    return Promise.resolve(entry.filePath);
  }

  // If already downloading, queue as waiter
  if (fullAudioLocks.has(videoId)) {
    console.log(`[audio-cache] queuing waiter for ${videoId}`);
    return new Promise((resolve, reject) => {
      if (!fullAudioWaiters[videoId]) fullAudioWaiters[videoId] = [];
      fullAudioWaiters[videoId].push({ resolve, reject });
    });
  }

  fullAudioLocks.add(videoId);
  const outFile = path.join(CHUNK_DIR, `${videoId}_full.webm`);

  // Delete stale file if exists
  if (fs.existsSync(outFile)) {
    try { fs.unlinkSync(outFile); } catch(_) {}
  }

  console.log(`[yt-dlp] downloading full audio for ${videoId}`);

  return new Promise((resolve, reject) => {
    // yt-dlp downloads via its own HTTP client which handles YouTube's IP restrictions
    // -x = extract audio, --no-playlist, output to known path
    const cmd = [
      'yt-dlp',
      '-f "bestaudio[ext=webm]/bestaudio/best"',
      '--no-playlist',
      '--no-warnings',
      `--output "${outFile}"`,
      `"https://www.youtube.com/watch?v=${videoId}"`
    ].join(' ');

    exec(cmd, { maxBuffer: 500 * 1024 * 1024, timeout: 5 * 60 * 1000 }, (err) => {
      fullAudioLocks.delete(videoId);

      if (err || !fs.existsSync(outFile)) {
        console.error(`[yt-dlp] download failed for ${videoId}:`, err?.message);
        const e = err || new Error('File not created');
        (fullAudioWaiters[videoId] || []).forEach(w => w.reject(e));
        delete fullAudioWaiters[videoId];
        return reject(e);
      }

      console.log(`[yt-dlp] download complete for ${videoId}`);
      fullAudioCache[videoId] = { filePath: outFile, ts: Date.now() };

      (fullAudioWaiters[videoId] || []).forEach(w => w.resolve(outFile));
      delete fullAudioWaiters[videoId];
      resolve(outFile);
    });
  });
}

// Clean expired full audio files every hour
setInterval(() => {
  const now = Date.now();
  Object.entries(fullAudioCache).forEach(([id, entry]) => {
    if (now - entry.ts > FULL_AUDIO_TTL) {
      try { fs.unlinkSync(entry.filePath); } catch(_) {}
      delete fullAudioCache[id];
      console.log(`[cleanup] removed full audio for ${id}`);
    }
  });
}, 60 * 60 * 1000);

// ── Trending ──────────────────────────────────────────────────────────────────
let trendingCache = null;
let trendingFetchedAt = 0;
const TRENDING_TTL = 60 * 60 * 1000;

app.get("/trending", (req, res) => {
  const now = Date.now();
  if (trendingCache && now - trendingFetchedAt < TRENDING_TTL) {
    return res.json(trendingCache);
  }
  const fallback = `yt-dlp "ytsearch10:top trending music india today 2025" --dump-json --no-download --flat-playlist`;
  exec(fallback, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const results = parseYtdlpLines(stdout);
      trendingCache = results;
      trendingFetchedAt = Date.now();
      res.json(results);
    } catch(e) { res.status(500).json({ error: "Parse error" }); }
  });
});

function parseYtdlpLines(stdout) {
  return stdout.trim().split("\n").filter(Boolean).slice(0, 10).map(line => {
    const d = JSON.parse(line);
    return {
      id: d.id, title: d.title, duration: d.duration || 0,
      thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
      uploader: d.uploader || d.channel || d.uploader_id || "Unknown",
    };
  });
}

// ── AI DJ ─────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.post("/api/ai-dj", async (req, res) => {
  const { mood, history } = req.body;
  if (!mood) return res.status(400).json({ error: "No mood provided" });
  try {
    const prompt = `You are a Spotify AI DJ.
User Mood: ${mood}
Recent Listens: ${history && history.length ? history.join(", ") : "None"}
Recommend exactly 10 real, popular songs that perfectly match this mood. Prefer Indian/Hindi/Punjabi and Global hits as appropriate.
Output MUST be strict JSON array with NO extra text or markdown. Format:
[{"title":"Song","artist":"Artist","search_query":"Song Artist official audio"}]`;

    const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }] }),
    });
    if (!apiRes.ok) throw new Error(`Groq ${apiRes.status}`);
    const data = await apiRes.json();
    let text = data.choices[0].message.content.trim().replace(/^```(json)?/, "").replace(/```$/, "").trim();
    const recommendations = JSON.parse(text);

    const promises = recommendations.map(song => new Promise(resolve => {
      const query = song.search_query.replace(/"/g, "");
      exec(`yt-dlp "ytsearch1:${query}" --dump-json --no-download --flat-playlist`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          try {
            const d = JSON.parse(stdout.trim());
            resolve({ id: d.id, title: d.title, duration: d.duration || 0,
              thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
              uploader: d.uploader || d.channel || "Unknown" });
          } catch(e) { resolve(null); }
        });
    }));
    const resolved = (await Promise.all(promises)).filter(Boolean);
    res.json(resolved);
  } catch(error) {
    console.error("AI DJ Error:", error.message);
    res.status(500).json({ error: "Failed to generate playlist" });
  }
});

// ── Search ────────────────────────────────────────────────────────────────────
app.get("/search", (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "No query" });
  exec(`yt-dlp "ytsearch8:${query}" --dump-json --no-download --flat-playlist`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        const results = stdout.trim().split("\n").filter(Boolean).map(line => {
          const d = JSON.parse(line);
          return { id: d.id, title: d.title, duration: d.duration,
            thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
            uploader: d.uploader || d.channel || "Unknown" };
        });
        res.json(results);
      } catch(e) { res.status(500).json({ error: "Parse error" }); }
    });
});

// ── Video info ────────────────────────────────────────────────────────────────
app.get("/info/:videoId", (req, res) => {
  const { videoId } = req.params;
  exec(`yt-dlp "https://www.youtube.com/watch?v=${videoId}" --dump-json --no-download`,
    { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        const d = JSON.parse(stdout.trim());
        res.json({ id: d.id, title: d.title, duration: d.duration,
          thumbnail: d.thumbnail, uploader: d.uploader || d.channel });
      } catch(e) { res.status(500).json({ error: "Parse error" }); }
    });
});

// ── Chunk endpoint ────────────────────────────────────────────────────────────
// Strategy: yt-dlp downloads full audio → ffmpeg trims locally (no CDN streaming)
const chunkLocks = new Set();

app.get("/chunk/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const start    = parseFloat(req.query.start)    || 0;
  const duration = parseFloat(req.query.duration) || 60;
  const chunkFile = path.join(CHUNK_DIR, `${videoId}_${start}_${duration}.mp3`);

  // Serve cached chunk
  if (fs.existsSync(chunkFile)) {
    console.log(`[chunk] cache hit ${videoId}@${start}`);
    return res.sendFile(chunkFile);
  }

  // Queue if already being generated
  if (chunkLocks.has(chunkFile)) {
    let attempts = 0;
    const iv = setInterval(() => {
      if (!chunkLocks.has(chunkFile) || attempts++ > 120) {
        clearInterval(iv);
        if (fs.existsSync(chunkFile)) res.sendFile(chunkFile);
        else res.status(500).json({ error: "Concurrent generation failed" });
      }
    }, 500);
    return;
  }

  chunkLocks.add(chunkFile);
  console.log(`[chunk] generating ${videoId}@${start}s dur=${duration}s`);

  try {
    // Step 1: Download full audio via yt-dlp (handles YouTube IP restrictions)
    const fullAudioPath = await getFullAudio(videoId);

    // Step 2: Trim locally with ffmpeg — no network needed, always works
    const ffCmd = [
      'ffmpeg',
      `-ss ${start}`,
      `-t ${duration}`,
      `-i "${fullAudioPath}"`,
      '-vn -acodec libmp3lame -ab 128k -ar 44100',
      '-y',
      `"${chunkFile}"`
    ].join(' ');

    exec(ffCmd, { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }, (err) => {
      chunkLocks.delete(chunkFile);
      if (err || !fs.existsSync(chunkFile)) {
        console.error(`[chunk] ffmpeg trim failed for ${videoId}@${start}:`, err?.message);
        return res.status(500).json({ error: "Chunk trim failed" });
      }
      console.log(`[chunk] done ${videoId}@${start}`);
      res.sendFile(chunkFile);
    });

  } catch(err) {
    chunkLocks.delete(chunkFile);
    console.error(`[chunk] getFullAudio failed for ${videoId}:`, err.message);
    res.status(500).json({ error: `Download failed: ${err.message}` });
  }
});

// ── Cleanup old chunks ────────────────────────────────────────────────────────
app.delete("/chunk/:videoId", (req, res) => {
  const { videoId } = req.params;
  const keepStart = parseFloat(req.query.keepStart) || 0;
  const keepFrom  = Math.max(0, keepStart - 60);
  try {
    fs.readdirSync(CHUNK_DIR)
      .filter(f => f.startsWith(`${videoId}_`) && !f.endsWith('_full.webm'))
      .forEach(f => {
        const parts = f.replace(".mp3", "").split("_");
        const cs = parseFloat(parts[parts.length - 2]);
        if (cs < keepFrom) { try { fs.unlinkSync(path.join(CHUNK_DIR, f)); } catch(_) {} }
      });
  } catch(_) {}
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎵 Melodify running on port ${PORT}`));
