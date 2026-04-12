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
  res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.use(express.static(__dirname));


// ── Keep-alive ping ───────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    http.get(`${SELF_URL}/health`).on('error', () => {});
  }, 8 * 60 * 1000);
}
app.get('/health', (req, res) => res.send('OK'));

// ── Debug ─────────────────────────────────────────────────────────────────────
app.get('/debug', (req, res) => {
  exec('which yt-dlp && yt-dlp --version', (err, stdout) => {
    const ytdlp = err ? `NOT FOUND: ${err.message}` : stdout.trim();
    exec('which ffmpeg && ffmpeg -version 2>&1 | head -1', (err2, stdout2) => {
      const ffmpeg = err2 ? `NOT FOUND: ${err2.message}` : stdout2.trim();
      res.json({ yt_dlp: ytdlp, ffmpeg, cwd: __dirname });
    });
  });
});

// ── Trending ──────────────────────────────────────────────────────────────────
let trendingCache = null, trendingFetchedAt = 0;
const TRENDING_TTL = 60 * 60 * 1000;

app.get("/trending", (req, res) => {
  if (trendingCache && Date.now() - trendingFetchedAt < TRENDING_TTL)
    return res.json(trendingCache);
  exec(`yt-dlp "ytsearch10:top trending music india today 2025" --dump-json --no-download --flat-playlist`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        trendingCache = parseYtdlpLines(stdout);
        trendingFetchedAt = Date.now();
        res.json(trendingCache);
      } catch(e) { res.status(500).json({ error: "Parse error" }); }
    });
});

function parseYtdlpLines(stdout) {
  return stdout.trim().split("\n").filter(Boolean).slice(0, 10).map(line => {
    const d = JSON.parse(line);
    return { id: d.id, title: d.title, duration: d.duration || 0,
      thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
      uploader: d.uploader || d.channel || d.uploader_id || "Unknown" };
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
      exec(`yt-dlp "ytsearch1:${song.search_query.replace(/"/g,'')}" --dump-json --no-download --flat-playlist`,
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
    res.json((await Promise.all(promises)).filter(Boolean));
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
        res.json(stdout.trim().split("\n").filter(Boolean).map(line => {
          const d = JSON.parse(line);
          return { id: d.id, title: d.title, duration: d.duration,
            thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
            uploader: d.uploader || d.channel || "Unknown" };
        }));
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

// ── STREAM endpoint — pipes audio directly to browser, no temp files ──────────
// GET /stream/:videoId
// Uses yt-dlp stdout → ffmpeg stdin → response stream
// Starts sending data in ~2-3 seconds, no waiting for full download
app.get("/stream/:videoId", (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`[stream] starting ${videoId}`);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering on Render

  // yt-dlp pipes raw audio to stdout
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '-o', '-',          // output to stdout
    url
  ]);
  console.log('[stream] yt-dlp spawned');

  // ffmpeg reads from stdin, encodes to mp3, writes to stdout
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-i', 'pipe:0',     // read from stdin
    '-vn',
    '-acodec', 'libmp3lame',
    '-ab', '128k',
    '-ar', '44100',
    '-f', 'mp3',
    'pipe:1'            // write to stdout
  ]);
  console.log('[stream] ffmpeg spawned');

  // Pipe: yt-dlp stdout → ffmpeg stdin
  ytdlp.stdout.pipe(ffmpeg.stdin);
  console.log('[stream] piped yt-dlp to ffmpeg');

  // Pipe: ffmpeg stdout → HTTP response
  ffmpeg.stdout.pipe(res);
  console.log('[stream] piped ffmpeg to response');

  // Error handling
  ytdlp.stderr.on('data', d => console.log(`[yt-dlp] ${d.toString().trim()}`));
  ffmpeg.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log(`[ffmpeg] ${msg.slice(0, 100)}`);
  });

  ytdlp.on('error', err => {
    console.error('[stream] yt-dlp error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });

  ytdlp.on('close', code => {
    console.log(`[stream] yt-dlp exit ${code}`);
  });

  ffmpeg.on('error', err => {
    console.error('[stream] ffmpeg error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });

  ffmpeg.on('close', code => {
    console.log(`[stream] done ${videoId} (ffmpeg exit ${code})`);
    res.end();
  });

  // If client disconnects, kill both processes
  req.on('close', () => {
    console.log(`[stream] client disconnected ${videoId}`);
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  });
});

// Keep old /chunk endpoint working as alias (forwards to stream)
app.get("/chunk/:videoId", (req, res) => {
  res.redirect(`/stream/${req.params.videoId}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎵 Melodify running on port ${PORT}`));
