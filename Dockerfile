FROM node:18-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY src/ ./src/
COPY views/ ./views/

# Create buffer directory
RUN mkdir -p /tmp/iptv-buffer

# Expose port
EXPOSE 3000

# Set environment for buffer directory
ENV BUFFER_DIR=/tmp/iptv-buffer

# Start application
CMD ["node", "src/index.js"]
