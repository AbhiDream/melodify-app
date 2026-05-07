FROM node:20-bullseye-slim

# Install system deps including python3, pip, ffmpeg, curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip3 (most reliable method on cloud)
RUN pip3 install --no-cache-dir -U yt-dlp

# Create symlink so yt-dlp is on PATH
RUN ln -sf /usr/local/bin/yt-dlp /usr/bin/yt-dlp || true

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/chunks

EXPOSE 3000

CMD ["node", "server.js"]
