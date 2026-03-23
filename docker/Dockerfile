FROM node:25-slim

RUN apt update && \
    apt install -y --no-install-recommends \
        ffmpeg \
        procps \
        git && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf ~/.npm /root/.npm

COPY scripts/ ./scripts/
COPY .git/ ./.git/
RUN mkdir -p src && \
    npm run build:info && \
    rm -rf scripts/ && \
    rm -rf .git/

COPY ./src ./src
COPY ./views ./views

EXPOSE 3000

CMD ["node", "src/index.js"]
