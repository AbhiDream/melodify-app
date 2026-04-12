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

// ── Static files — serve from project root ────────────────────────────────────
// manifest.json with correct MIME type
app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(__dirname, "manifest.json"));
});
// sw.js with correct MIME type
app.get("/sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(__dirname, "sw.js"));
});
// Everything else (index.html, icon.png, etc.) from root
app.use(express.static(__dirname, { index: "index.html" }));

// ── Keep-alive ping (prevents Render free-tier spin-down) ────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    http.get(`${SELF_URL}/health`).on("error", () => {});
  }, 8 * 60 * 1000);
}
app.get("/health", (req, res) => res.send("OK"));

// ── Debug endpoint ────────────────────────────────────────────────────────────
app.get("/debug", (req, res) => {
  exec("which yt-dlp && yt-dlp --version", (err, stdout) => {
    const ytdlp = err ? `NOT FOUND: ${err.message}` : stdout.trim();
    exec("which ffmpeg && ffmpeg -version 2>&1 | head -1", (err2, stdout2) => {
      const ffmpeg = err2 ? `NOT FOUND: ${err2.message}` : stdout2.trim();
      res.json({ yt_dlp: ytdlp, ffmpeg, cwd: __dirname, chunks_dir: CHUNK_DIR });
    });
  });
});

// ── Chunks directory ──────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(__dirname, "chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// ── Audio URL cache — avoids calling yt-dlp twice for same video ──────────────
// YouTube CDN URLs expire after ~6h, so we cache for 5h
const audioUrlCache = {};
const AUDIO_URL_TTL = 5 * 60 * 60 * 1000;

function getAudioUrl(videoId) {
  const entry = audioUrlCache[videoId];
  if (entry && Date.now() - entry.ts < AUDIO_URL_TTL) {
    console.log(`[cache hit] audio URL for ${videoId}`);
    return Promise.resolve(entry.url);
  }
  return new Promise((resolve, reject) => {
    const cmd = `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url "https://www.youtube.com/watch?v=${videoId}"`;
    console.log(`[yt-dlp] fetching audio URL for ${videoId}`);
    exec(cmd, { timeout: 40000 }, (err, stdout) => {
      if (err || !stdout.trim()) return reject(err || new Error("No URL returned"));
      const url = stdout.trim().split("\n")[0];
      audioUrlCache[videoId] = { url, ts: Date.now() };
      console.log(`[yt-dlp] got audio URL for ${videoId}`);
      resolve(url);
    });
  });
}

// Clear expired audio URL cache entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(audioUrlCache)) {
    if (now - audioUrlCache[id].ts > AUDIO_URL_TTL) delete audioUrlCache[id];
  }
}, 30 * 60 * 1000);

// ── Trending cache ────────────────────────────────────────────────────────────
let trendingCache = null;
let trendingFetchedAt = 0;
const TRENDING_TTL = 60 * 60 * 1000;

app.get("/trending", (req, res) => {
  const now = Date.now();
  if (trendingCache && now - trendingFetchedAt < TRENDING_TTL) {
    return res.json(trendingCache);
  }
  const fallbackCmd = `yt-dlp "ytsearch10:top trending music india today 2025" --dump-json --no-download --flat-playlist`;
  exec(fallbackCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const results = parseYtdlpLines(stdout);
      trendingCache = results;
      trendingFetchedAt = Date.now();
      res.json(results);
    } catch (e) { res.status(500).json({ error: "Parse error" }); }
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
          } catch (e) { resolve(null); }
        });
    }));
    const resolved = (await Promise.all(promises)).filter(Boolean);
    res.json(resolved);
  } catch (error) {
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
      } catch (e) { res.status(500).json({ error: "Parse error" }); }
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
      } catch (e) { res.status(500).json({ error: "Parse error" }); }
    });
});

// ── Chunk endpoint ────────────────────────────────────────────────────────────
const chunkLocks = new Set();

app.get("/chunk/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const start    = parseFloat(req.query.start)    || 0;
  const duration = parseFloat(req.query.duration) || 60;
  const chunkFile = path.join(CHUNK_DIR, `${videoId}_${start}_${duration}.mp3`);

  // Serve cached chunk immediately
  if (fs.existsSync(chunkFile)) {
    console.log(`[chunk] serving cached ${videoId}@${start}`);
    return res.sendFile(chunkFile);
  }

  // Queue if already being generated
  if (chunkLocks.has(chunkFile)) {
    console.log(`[chunk] waiting for in-progress ${videoId}@${start}`);
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
  console.log(`[chunk] generating ${videoId}@${start} dur=${duration}`);

  try {
    const audioUrl = await getAudioUrl(videoId);

    const ffCmd = [
      "ffmpeg",
      "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
      `-ss ${start}`,
      `-t ${duration}`,
      `-i "${audioUrl}"`,
      "-vn -acodec libmp3lame -ab 128k -ar 44100",
      "-y",
      `"${chunkFile}"`,
    ].join(" ");

    exec(ffCmd, { maxBuffer: 100 * 1024 * 1024, timeout: 120000 }, (err) => {
      chunkLocks.delete(chunkFile);
      if (err || !fs.existsSync(chunkFile)) {
        console.error(`[chunk] ffmpeg failed for ${videoId}@${start}:`, err?.message);
        // Bust URL cache so next attempt re-fetches a fresh URL
        delete audioUrlCache[videoId];
        return res.status(500).json({ error: "Chunk creation failed" });
      }
      console.log(`[chunk] done ${videoId}@${start}`);
      res.sendFile(chunkFile);
    });
  } catch (err) {
    chunkLocks.delete(chunkFile);
    console.error(`[chunk] error ${videoId}@${start}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cleanup old chunks ────────────────────────────────────────────────────────
app.delete("/chunk/:videoId", (req, res) => {
  const { videoId } = req.params;
  const keepStart = parseFloat(req.query.keepStart) || 0;
  const keepFrom  = Math.max(0, keepStart - 60);
  try {
    fs.readdirSync(CHUNK_DIR)
      .filter(f => f.startsWith(`${videoId}_`))
      .forEach(f => {
        const parts = f.replace(".mp3", "").split("_");
        const cs = parseFloat(parts[parts.length - 2]);
        if (cs < keepFrom) { try { fs.unlinkSync(path.join(CHUNK_DIR, f)); } catch (_) {} }
      });
  } catch (_) {}
  res.json({ ok: true });
});

// ── Periodic full chunk cleanup (keep disk clean on Render free tier) ─────────
setInterval(() => {
  try {
    const now = Date.now();
    fs.readdirSync(CHUNK_DIR).forEach(f => {
      const fp = path.join(CHUNK_DIR, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > 2 * 60 * 60 * 1000) fs.unlinkSync(fp);
      } catch (_) {}
    });
  } catch (_) {}
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎵 Melodify running on port ${PORT}`));
