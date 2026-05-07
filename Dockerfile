FROM node:20-bullseye-slim

# Install system deps
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp (binary, most reliable on cloud)
RUN curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

# Verify tools
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create chunks dir
RUN mkdir -p /app/chunks

EXPOSE 3000

CMD ["node", "server.js"]
