#!/usr/bin/env bash
set -e

echo "=== Installing npm dependencies ==="
npm install

echo "=== Installing ffmpeg ==="
apt-get update -qq && apt-get install -y -qq ffmpeg

echo "=== Installing yt-dlp ==="
curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp

echo "=== Verifying tools ==="
yt-dlp --version
ffmpeg -version | head -1

echo "=== Build complete ==="
