FROM node:18-slim

# Install FFmpeg, procps (for pkill), and Git (for build info)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        procps \
        git && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Set working directory
WORKDIR /app

# Copy package files and scripts
COPY package.json ./
COPY scripts/ ./scripts/

# Install dependencies and clean up
RUN npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf ~/.npm /root/.npm

# Generate build info (safe, no user input)
RUN mkdir -p src && \
    npm run build:info && \
    rm -rf scripts/

# Copy application files
COPY src/ ./src/
COPY views/ ./views/

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "src/index.js"]
