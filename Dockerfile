FROM node:18-slim

# Install FFmpeg and procps (for pkill)
RUN apt-get update && \
    apt-get install -y ffmpeg procps && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY src/ ./src/
COPY views/ ./views/

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "src/index.js"]
