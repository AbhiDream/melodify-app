<div align="center">
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/icon.png" alt="Melodify Logo" width="120" style="border-radius: 20px;">

  # Melodify

  **An open-source web music player that streams audio directly from YouTube.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

  <br />
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot.png" alt="Melodify UI Screenshot" width="800" style="border-radius: 12px; margin-top: 20px;">
  <br /><br />
</div>

---

## Features

- **Redesigned UI**: A responsive, light-themed interface with translucent elements (PWA ready).<br><br>
  <img src="https://raw.githubusercontent.com/AbhiDream/melodify-app/main/public/screenshot-player.png" alt="Melodify Player Close-up" width="600" style="border-radius: 12px; margin-bottom: 15px;">
- **Autoplay Queue**: Automatically queues similar tracks based on artist and title matching to provide continuous playback.
- **Queue Visualization**: "Up Next" and "Previous" track cards that sync with the current playback state.<br><br>
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
- **Chunk-Based Streaming**: Streams YouTube audio dynamically in 20-second segments to reduce bandwidth and initial load times.
- **Buffered Seeking**: Retains recent chunks in memory and pre-fetches upcoming ones to minimize seek latency.
- **Trending Feed**: Integration with YouTube's trending music feed.
- **Search**: YouTube audio search with local caching.
- **Disk Management**: Automatically purges old audio chunks to manage disk space.

---

## Architecture

Unlike standard downloaders that fetch the entire media file before playback, Melodify acts as a proxy:

```text
Browser (Vanilla JS + Web Audio API)
  ↕ REST API (Chunk requests)
Node.js Server (Express)
  ↕ yt-dlp (URL resolver) + ffmpeg (Audio slicer)
YouTube Servers
```

### Chunk System
1. Client requests a track.
2. Server resolves the audio URL and uses `ffmpeg` to slice audio chunks on the fly.
3. Client pre-fetches upcoming chunks in the background and stitches them seamlessly via the Web Audio API.
4. Server manages and deletes stale chunks.

---

## Prerequisites

To run Melodify, you need **Node.js** and the following system dependencies installed and available in your system's PATH:

* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** (Handles downloading and resolving)
* **[FFmpeg](https://ffmpeg.org/)** (Handles audio extraction and chunking)

### Installation Guide

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

*(Note: The app relies on the `pip` or standard package manager versions of yt-dlp being up to date to properly parse YouTube URLs.)*

---

## Getting Started

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
   npm run dev    # For development
   # or
   npm start      # For production
   ```

4. **Access the application:**
   Navigate to `http://localhost:3000`

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=query` | Searches YouTube and caches results. |
| `GET` | `/trending` | Fetches live trending songs. |
| `GET` | `/chunk/:videoId?start=0&duration=20` | Streams a specific 20s audio chunk via ffmpeg. |
| `GET` | `/info/:videoId` | Fetches track metadata. |
| `DELETE` | `/chunk/:videoId` | Cleans up old cached chunks. |

---

## Contributing

Contributions, issues, and feature requests are welcome. Feel free to check the [issues page](https://github.com/AbhiDream/melodify-app/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
