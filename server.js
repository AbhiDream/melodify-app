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
app.use(express.static(path.join(__dirname, "public")));

const CHUNK_DIR = path.join(__dirname, "chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR);

// ── Trending cache (refresh every 1 hour) ───────────────────────────────────
let trendingCache = null;
let trendingFetchedAt = 0;
const TRENDING_TTL = 60 * 60 * 1000; // 1 hour

app.get("/trending", (req, res) => {
  const now = Date.now();
  if (trendingCache && now - trendingFetchedAt < TRENDING_TTL) {
    return res.json(trendingCache);
  }

  // YouTube Music trending category
  // bp= param selects the "Music" tab on the trending page
  const url = "https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D";
  const cmd = `yt-dlp "${url}" --flat-playlist --dump-json --no-download --playlist-end 10`;

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (err) {
      // Fallback: search for "trending hindi songs today" if direct trending fails
      const fallback = `yt-dlp "ytsearch10:top trending music india today 2025" --dump-json --no-download --flat-playlist`;
      exec(fallback, { maxBuffer: 10 * 1024 * 1024 }, (err2, stdout2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        try {
          const results = parseYtdlpLines(stdout2);
          trendingCache = results;
          trendingFetchedAt = Date.now();
          res.json(results);
        } catch (e) { res.status(500).json({ error: "Parse error" }); }
      });
      return;
    }
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
      id: d.id,
      title: d.title,
      duration: d.duration || 0,
      thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
      uploader: d.uploader || d.channel || d.uploader_id || "Unknown",
    };
  });
}

// ── AI DJ Feature ───────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.post("/api/ai-dj", async (req, res) => {
  const { mood, history } = req.body;
  if (!mood) return res.status(400).json({ error: "No mood provided" });

  try {
    console.log(`🎧 Generating AI DJ Playlist for mood: "${mood}"`);
    // 1. Call Groq API
    const prompt = `You are a Spotify AI DJ. 
User Mood: ${mood}
Recent Listens: ${history && history.length ? history.join(", ") : "None"}

Recommend exactly 10 real, popular songs that perfectly match this mood. Blend some similar songs to their history (if any) with great discoveries. Prefer Indian/Hindi/Punjabi and Global hits as appropriate.

Output MUST be strict JSON array with NO extra text or markdown formatting. Format:
[
  { "title": "Song", "artist": "Artist", "search_query": "Song Artist official audio" }
]`;

    const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }]
      })
    });

    
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Groq 400 Payload:", errText);
      throw new Error(`Groq returned ${apiRes.status}`);
    }
    const data = await apiRes.json();
    let textResult = data.choices[0].message.content.trim();
    
    if (textResult.startsWith('```')) {
      textResult = textResult.replace(/^```(json)?/, '').replace(/```$/, '').trim();
    }
    const recommendations = JSON.parse(textResult);

    // 2. Resolve YouTube tracks in parallel
    const promises = recommendations.map(song => {
      return new Promise(resolve => {
        const query = song.search_query.replace(/"/g, '');
        const cmd = `yt-dlp "ytsearch1:${query}" --dump-json --no-download --flat-playlist`;
        exec(cmd, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          try {
            const d = JSON.parse(stdout.trim());
            resolve({
              id: d.id,
              title: d.title,
              duration: d.duration || 0,
              thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
              uploader: d.uploader || d.channel || "Unknown"
            });
          } catch(e) { resolve(null); }
        });
      });
    });

    const resolved = (await Promise.all(promises)).filter(Boolean);
    console.log(`✅ AI DJ resolved ${resolved.length} playable tracks.`);
    res.json(resolved);

  } catch (error) {
    console.error("AI DJ Error:", error.message);
    res.status(500).json({ error: "Failed to generate playlist" });
  }
});

// ── Search YouTube ──────────────────────────────────────────────────────────
app.get("/search", (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "No query" });

  // yt-dlp search: grab top 8 results with metadata
  const cmd = `yt-dlp "ytsearch8:${query}" --dump-json --no-download --flat-playlist`;
  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const results = lines.map((line) => {
        const d = JSON.parse(line);
        return {
          id: d.id,
          title: d.title,
          duration: d.duration,
          thumbnail:
            d.thumbnail ||
            `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
          uploader: d.uploader || d.channel || "Unknown",
        };
      });
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: "Parse error" });
    }
  });
});

// ── Get full song duration ──────────────────────────────────────────────────
app.get("/info/:videoId", (req, res) => {
  const { videoId } = req.params;
  const cmd = `yt-dlp "https://www.youtube.com/watch?v=${videoId}" --dump-json --no-download`;
  exec(cmd, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const d = JSON.parse(stdout.trim());
      res.json({
        id: d.id,
        title: d.title,
        duration: d.duration,
        thumbnail: d.thumbnail,
        uploader: d.uploader || d.channel,
      });
    } catch (e) {
      res.status(500).json({ error: "Parse error" });
    }
  });
});

const chunkLocks = new Set();

// ── Download a 10-second chunk ──────────────────────────────────────────────
// GET /chunk/:videoId?start=0&duration=10
app.get("/chunk/:videoId", (req, res) => {
  const { videoId } = req.params;
  const start = parseFloat(req.query.start) || 0;
  const duration = parseFloat(req.query.duration) || 10;

  const chunkFile = path.join(CHUNK_DIR, `${videoId}_${start}_${duration}.mp3`);

  // Serve cached chunk immediately
  if (fs.existsSync(chunkFile)) return res.sendFile(chunkFile);

  // If already generating, wait for it
  if (chunkLocks.has(chunkFile)) {
    let attempts = 0;
    const iv = setInterval(() => {
      if (!chunkLocks.has(chunkFile) || attempts++ > 60) {
        clearInterval(iv);
        if (fs.existsSync(chunkFile)) res.sendFile(chunkFile);
        else res.status(500).json({ error: "Concurrent generation failed" });
      }
    }, 500);
    return;
  }

  chunkLocks.add(chunkFile);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const getUrlCmd = `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url "${url}"`;

  exec(getUrlCmd, (err, audioUrl) => {
    if (err) {
      chunkLocks.delete(chunkFile);
      return res.status(500).json({ error: err.message });
    }
    
    // Add reconnect flags to fix 7-minute drops, placing -ss before -i for fast-seeking
    const ffCmd = [
      `ffmpeg`,
      `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5`,
      `-ss ${start}`,
      `-t ${duration}`,
      `-i "${audioUrl.trim()}"`,
      `-vn`,
      `-acodec libmp3lame`,
      `-ab 128k`,
      `-ar 44100`,
      `-y`,
      `"${chunkFile}"`
    ].join(" ");

    exec(ffCmd, { maxBuffer: 50 * 1024 * 1024 }, (err2) => {
      chunkLocks.delete(chunkFile);
      if (err2 || !fs.existsSync(chunkFile)) {
        return res.status(500).json({ error: "Chunk not created" });
      }
      res.sendFile(chunkFile);
    });
  });
});

// ── Cleanup old chunks ──────────────────────────────────────────────────────
app.delete("/chunk/:videoId", (req, res) => {
  const { videoId } = req.params;
  const keepStart = parseFloat(req.query.keepStart) || 0;

  // Delete all chunks for this video EXCEPT those >= keepStart - 10
  const keepFrom = Math.max(0, keepStart - 10);
  const files = fs.readdirSync(CHUNK_DIR).filter((f) =>
    f.startsWith(`${videoId}_`)
  );
  files.forEach((f) => {
    const parts = f.replace(".mp3", "").split("_");
    const chunkStart = parseFloat(parts[parts.length - 2]);
    if (chunkStart < keepFrom) {
      try {
        fs.unlinkSync(path.join(CHUNK_DIR, f));
      } catch (_) {}
    }
  });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🎵 Music server running at http://localhost:${PORT}`)
);
