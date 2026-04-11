FROM node:20-bullseye-slim

# Install ffmpeg, python3, pip, curl
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip (more reliable than binary on cloud)
RUN pip3 install -U yt-dlp

# Verify both tools are available
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app

# Install node dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
