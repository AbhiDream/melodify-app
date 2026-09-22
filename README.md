<div align="center">
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/icon.png" alt="Melodify Logo" width="120" style="border-radius: 20px;">

  # 🎵 Melodify v2.0 — The Ultimate Open Source Music Player

  **A blazing-fast, beautiful open-source music player and web-based Spotify alternative. Stream ad-free music instantly with our premium glassmorphism UI, Smart Autoplay Queue, and zero-lag YouTube audio streaming engine.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
  [![Stars](https://img.shields.io/github/stars/AbhiDream/melodify-app?style=social)](https://github.com/AbhiDream/melodify-app/stargazers)

  <br />
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot.png" alt="Melodify UI Screenshot" width="800" style="border-radius: 12px; margin-top: 20px;">
  <br /><br />

  *If you like this project, please give it a ⭐️ to show your support!*
</div>

---

## ✨ What's New in v2.0?

- **📱 Redesigned Premium "Glassmorphism" UI**: A beautiful, fresh light-theme UI with frosted glass effects, fluid animations, and a responsive layout for mobile and desktop (PWA ready).<br><br>
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot-player.png" alt="Melodify Player Close-up" width="600" style="border-radius: 12px; margin-bottom: 15px;">
- **🎶 Smart Autoplay Queue**: Plays music non-stop! Our new recommendation engine dynamically queues up similar songs (based on artist and title fingerprints) so the music never stops.
- **✨ Dynamic Peek Cards**: Gorgeous, interactive "Up Next" and "Previous" album peek cards that hover seamlessly behind the main player, syncing perfectly with your smart queue.<br><br>
  <table>
    <tr>
      <td width="50%">
        <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot-prev.png?v=2" alt="Previous Peek Card" style="border-radius: 12px; width: 100%;">
      </td>
      <td width="50%">
        <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot-next.png?v=2" alt="Up Next Peek Card" style="border-radius: 12px; width: 100%;">
      </td>
    </tr>
  </table>
- **🚀 Advanced Chunk Streaming Engine**: Streams audio from YouTube dynamically in **20-second chunks** — saving bandwidth and loading instantly (exactly like adaptive bitrate streaming).
- **⚡ Zero-Lag Seeking**: Keeps chunks in cache and pre-fetches ahead. Seek backwards and forwards instantly without buffering!
- **🔥 Trending Dashboard**: Live integration with YouTube's trending music feed.
- **🔍 Global Search**: Lightning-fast YouTube search with local caching.
- **💾 Auto-Cleanup**: Smart disk management automatically clears old audio chunks to prevent disk bloat.

---

## 🏗 Architecture

Unlike standard YouTube downloaders that fetch the entire 100MB video before playing, **Melodify** acts as a smart proxy:

```text
Browser (Vanilla JS + Web Audio API)
  ↕ REST API (Chunk requests)
Node.js Server (Express)
  ↕ yt-dlp (URL resolver) + ffmpeg (Audio slicer)
YouTube Servers
```

### The Smart Chunk System
1. You request a song.
2. Server rapidly resolves the audio URL and uses `ffmpeg` to slice audio chunks on the fly.
3. As you listen, it pre-generates the next chunks in the background and stitches them seamlessly via the Web Audio API.
4. Old chunks are actively managed and deleted.

---

## 🛠️ Prerequisites

To run Melodify, you need **Node.js** and these two system dependencies installed and available in your system's PATH:

* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** (Handles downloading and resolving from YT)
* **[FFmpeg](https://ffmpeg.org/)** (Handles audio extraction and chunking)

### Installation Guide:

**macOS (via Homebrew):**
```bash
brew install yt-dlp ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install ffmpeg python3-pip
pip3 install yt-dlp
```

**Windows (via Chocolatey):**
```bash
choco install yt-dlp ffmpeg
```

*(Note: The app relies on the `pip` or standard package manager versions of yt-dlp being up to date to parse YouTube URLs correctly.)*

---

## 🚀 Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/AbhiDream/melodify-app.git
   cd melodify-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm run dev    # For development (nodemon)
   # or
   npm start      # For production
   ```

4. **Open in Browser:**
   Navigate to **[http://localhost:3000](http://localhost:3000)** and enjoy! 🎧

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=query` | Searches YouTube and caches results. |
| `GET` | `/trending` | Fetches live trending songs. |
| `GET` | `/chunk/:videoId?start=0&duration=20` | Streams a specific 20s audio chunk via ffmpeg. |
| `GET` | `/info/:videoId` | Fetches track metadata. |
| `DELETE` | `/chunk/:videoId` | Cleans up old cached chunks. |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! 
Feel free to check [issues page](https://github.com/AbhiDream/melodify-app/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---
<div align="center">
  <b>Built with ❤️ by the Open Source Community.</b><br>
  <i>Don't forget to leave a star ⭐️ if you found this repository useful!</i>
</div>
