# 🎵 WAVR — YouTube Music Player (Chunk Streaming)

A beautiful music player that searches YouTube and streams audio in **10-second chunks**, always staying 10 seconds ahead of playback.

## Architecture

```
Browser (index.html)
  ↕ REST API
Node.js Server (server.js)
  ↕ yt-dlp + ffmpeg
YouTube Audio
```

## How the Chunk System Works

1. Song is split into 10-second chunks on-demand
2. Server always pre-fetches **10 seconds ahead** of current position
3. Played chunks are deleted (except the **previous chunk** for seek-back)
4. Seeking backwards replays cached chunks instantly

```
Time:  0────10────20────30────40
       [cached] [playing] [loading] [pending]
                  ↑ you are here
       ← kept for seek-back
```

## Prerequisites

Install these system tools:

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
pip install yt-dlp

# Windows (with Chocolatey)
choco install yt-dlp ffmpeg
```

## Setup

```bash
cd music-player
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/search?q=query` | Search YouTube, returns top 8 |
| GET | `/info/:videoId` | Get video metadata & duration |
| GET | `/chunk/:videoId?start=0&duration=10` | Download a 10-sec audio chunk |
| DELETE | `/chunk/:videoId?keepStart=20` | Clean up old chunks |

## Features

- 🔍 YouTube search (top 8 results)
- 🎵 10-second chunked streaming (like adaptive bitrate)
- ⏩ Always buffers 10 seconds ahead
- ⏪ Previous chunk kept for seek-back support
- 🗑 Auto-deletes old chunks to save disk space
- 💿 Vinyl spin animation while playing
- 🌊 Live waveform visualizer
- ⏱ Seek bar with click-to-seek
- 🔊 Volume control

## Notes

- First chunk may take 5–15 seconds to load (yt-dlp + ffmpeg processing)
- Subsequent chunks load in the background while you listen
- Chunks are cached in `./chunks/` folder
- Server cleans up chunks older than current position - 10s
