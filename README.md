<div align="center">
  <img src="https://raw.githubusercontent.com/abhidream/melodify-app/main/public/icon.png" alt="Melodify Logo" width="120" style="border-radius: 20px;">

  # 🎵 Melodify — The Ultimate Open Source Spotify Clone

  **A blazing-fast, beautiful open-source music player and web-based Spotify alternative. Stream ad-free music instantly with our premium Spotify clone UI, Next-Gen AI DJ, and zero-lag YouTube audio streaming engine.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
  [![Stars](https://img.shields.io/github/stars/yourusername/melodify-app?style=social)](https://github.com/yourusername/melodify-app/stargazers)

  *If you like this project, please give it a ⭐️ to show your support!*
</div>

---

## ✨ Features

- **📱 Premium "Spotify-Like" UI**: Gorgeous dark mode, glassmorphism UI, fluid animations, and fully responsive for mobile and desktop (PWA ready).
- **🚀 Advanced Chunk Streaming Engine**: Streams audio from YouTube dynamically in **10-second chunks** — saving bandwidth and loading instantly (exactly like adaptive bitrate streaming).
- **🧠 AI DJ (Groq + Llama 3)**: Tell the AI your mood, and it instantly generates a custom 10-track playlist of real, trend-matching songs using ultra-fast LLM generation.
- **⚡ Zero-Lag Seeking**: Keeps the previous chunk in cache and pre-fetches 10 seconds ahead. Seek backwards instantly without buffering!
- **🔥 Trending Dashboard**: Live integration with YouTube's trending music feed.
- **🔍 Global Search**: Lightning-fast YouTube search with local caching.
- **💾 Auto-Cleanup**: Smart disk management automatically clears old audio chunks to prevent disk bloat.

---

## 🏗 Architecture

Unlike standard YouTube downloaders that fetch the entire 100MB video before playing, **Melodify** acts as a smart proxy:

```text
Browser (Vanilla JS + HTML5 Audio)
  ↕ REST API (Chunk requests)
Node.js Server (Express)
  ↕ yt-dlp (URL resolver) + ffmpeg (Audio slicer)
YouTube Servers
```

### The 10-Second Chunk System
1. You request a song.
2. Server rapidly resolves the audio URL and uses `ffmpeg` to slice exactly `00:00 - 00:10`.
3. As you listen, it pre-generates `00:10 - 00:20` in the background.
4. Old chunks are deleted, but the *immediately preceding* chunk is kept for instant seek-back.

---

## 🛠️ Prerequisites

To run Melodify, you need **Node.js** and these two system dependencies installed and available in your system's PATH:

* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** (Handles downloading from YT)
* **[FFmpeg](https://ffmpeg.org/)** (Handles audio extraction and chunking)

### Installation Guide:

**macOS (via Homebrew):**
```bash
brew install yt-dlp ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install ffmpeg
pip install yt-dlp
```

**Windows (via Chocolatey):**
```bash
choco install yt-dlp ffmpeg
```

---

## 🚀 Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/melodify-app.git
   cd melodify-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   Create a `.env` file in the root directory and add your Groq API key for the AI DJ feature:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   PORT=3000
   ```
   *(Get your free API key at [console.groq.com](https://console.groq.com))*

4. **Start the server:**
   ```bash
   npm run dev    # For development (nodemon)
   # or
   npm start      # For production
   ```

5. **Open in Browser:**
   Navigate to **[http://localhost:3000](http://localhost:3000)** and enjoy! 🎧

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=query` | Searches YouTube and caches results. |
| `GET` | `/trending` | Fetches live trending songs. |
| `GET` | `/chunk/:videoId?start=0&duration=10` | Streams a specific 10s audio chunk. |
| `POST` | `/api/ai-dj` | AI suggests songs based on mood. |
| `DELETE` | `/chunk/:videoId` | Cleans up old cached chunks. |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! 
Feel free to check [issues page](https://github.com/yourusername/melodify-app/issues).

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
