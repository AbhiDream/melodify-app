FROM node:20-bullseye-slim

# Install ffmpeg and python (required by yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package.json to install node deps first
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Expose port (Render automatically maps port 10000 or reads via PORT env var)
EXPOSE 3000

# Start script
CMD ["node", "server.js"]
