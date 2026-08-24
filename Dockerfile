# Repage — single-container deployment: Fastify API + built web UI + headless Chromium.
# Works as-is on Railway, Render, Fly.io, or any Docker host.
# (Not deployable to Vercel/Netlify serverless: extraction needs a persistent
#  Node process with a full Chromium install and in-memory job state.)

# ---------- build stage: compile server (tsc) + web (vite) ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server/ server/
COPY web/ web/
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5177 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci -w server --omit=dev
# system libraries + fonts Chromium needs (as root), then drop privileges —
# Playwright runs Chromium with its sandbox off by default, and this app
# renders arbitrary URLs, so the process itself should not be root
RUN npx playwright install-deps chromium && rm -rf /var/lib/apt/lists/*
RUN useradd -m repage
USER repage
# the browser binary itself, into /home/repage/.cache/ms-playwright
RUN npx playwright install chromium
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
EXPOSE 5177
CMD ["node", "server/dist/index.js"]
