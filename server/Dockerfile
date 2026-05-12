FROM node:22-bookworm-slim

# better-sqlite3 v12 ships prebuilt Linux x64 binaries; no compiler needed.
# Curl for healthcheck. tzdata so sqlite's datetime('now','localtime') resolves
# Asia/Bangkok — schema timestamps must stay in Thailand local time to match
# existing data and the xlsx export's parseLocal logic.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cache layer). Production-only — no dev tools in image.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code.
COPY src/ ./src/
COPY public/ ./public/

# /data is the persistent volume mount: DB + rolling log files live here.
# Created 755 so the non-root user (node:1000) can write.
RUN mkdir -p /data /data/logs \
 && chown -R node:node /data /app

USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Bangkok \
    SE_KEY_DB=/data/data.db \
    SE_KEY_LOG_DIR=/data/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "src/server.js"]
