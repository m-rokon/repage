# Repage

Paste a URL, get clean, copy-paste-ready code — extracted and rebuilt from the live page.

Repage fetches a real, rendered webpage and re-outputs it as clean **HTML/CSS/JS** or a **React + TypeScript** component — ready to paste into your own project.

> Status: 🚧 early development / private repo. Not production-ready.

---

## What this is

Repage extracts the *rendered* structure of a page (post-JavaScript execution), strips platform-specific cruft (WordPress classes, tracking scripts, plugin bloat, etc.), and re-serializes it into clean output for whichever platform you're building in.

## What this is **not**

To set expectations up front:

- Not a full site-to-site converter. It won't recreate backend logic, databases, auth, or checkout flows.
- Not guaranteed pixel-perfect. The goal is structurally faithful, editable, clean code — not a byte-for-byte visual clone.
- Not a multi-page crawler in v1 — one page in, one page's code out.

---

## Output modes

| Mode | Output | Paste target |
|---|---|---|
| Static | `.html`, `.css`, `.js` | Any static host |
| React + TypeScript | `.tsx` + `.module.css` | Any React/Vite/Next project |

(Earlier prototypes also emitted Framer, Shopify Liquid, and Webflow embeds; those modes were cut to keep the project focused. The IR/serializer split means they could return as plugins later.)

## How it works (high level)

```
URL → Extraction Engine (Playwright) → Cleaning Pass → Intermediate Representation (IR)
    → Platform Serializer → Copy-paste-ready code
```

The Intermediate Representation is the key design piece: extraction happens once, and each output mode is just a serializer built on top of the same IR.

## Tech stack

- **Extraction**: Playwright (Node)
- **Backend**: Node + TypeScript (Fastify/Express)
- **Frontend**: React + TypeScript + Vite
- **Queue** (once scaling): BullMQ + Redis
- **Code display**: Shiki / Monaco

## Getting started

Requires Node 20+.

```bash
npm install
npx playwright install chromium   # one-time browser download

npm run dev        # starts API (127.0.0.1:5177) + web UI (localhost:5173)
```

Open http://localhost:5173, paste a URL, pick an output mode.

Other useful commands:

```bash
npm run spike -w server -- https://example.com   # CLI: run the full pipeline, dump all modes to server/scratch/
npm run build      # typecheck + production build (server serves web/dist if present)
npm run start      # run the built server
npm run typecheck
```

## Deploying

Repage is **not deployable to Vercel or Netlify** (you'll get errors like `No Output Directory named "public" found`). Those platforms run serverless functions, and the Repage server needs things serverless can't provide: a full headless-Chromium install (hundreds of MB), extractions that run 30–60 s, and job/cache state held in memory between requests. Only the static `web/` frontend would deploy there — with no working API behind it.

Deploy it instead as **one container** on any host that runs persistent processes — Railway, Render, Fly.io, or a VPS. The included `Dockerfile` bundles the API, the built web UI (the server serves `web/dist` itself), and Chromium:

```bash
docker build -t repage .
docker run -p 5177:5177 repage     # → http://localhost:5177
```

- **Railway / Render**: point the service at this repo — both auto-detect the `Dockerfile`. The container listens on `$PORT` (set automatically by both platforms).
- **Fly.io**: `fly launch` picks up the `Dockerfile`; set `internal_port = 5177` (or pass `-e PORT`).
- **VPS**: `docker run -d --restart unless-stopped -p 80:5177 repage`, or skip Docker and run `npm run build && npm run start` behind a reverse proxy (set `HOST=0.0.0.0`).

Notes for public deployments: extraction is CPU/RAM-hungry — give the container **at least 1 GB RAM**; rate limiting is on by default (30 req/min, 10 extractions/min per IP) and private/internal target URLs are blocked, but there is no auth — anyone with the URL can trigger extractions.

### Repo layout

```
server/src/
  extract/extractor.ts   # Playwright capture: rendered DOM, used-CSS filtering, scripts
  clean/clean.ts, css.ts # cleaning pass: cruft strip, CSS dedupe/unused-drop, class renames, CMS-loop detection
  types.ts               # the IR schema (contract between extraction and serializers)
  serialize/             # one serializer per output mode (static, react)
  server.ts, jobs.ts     # Fastify API, in-memory job store + per-URL IR cache (15 min TTL), rate limiting
web/src/                 # React + Vite UI: URL in, progress, code tabs, copy/zip, fidelity preview
```

## Roadmap

1. Extraction spike — Playwright dump of rendered DOM/CSS/JS
2. Cleaning pass v1 — strip cruft, dedupe CSS
3. Lock the IR schema
4. Static serializer (first end-to-end demo)
5. React/TS serializer
6. Minimal web UI (URL in, code tabs out)
7. Preview iframe with fidelity diff
8. Queue + caching for scale

## Legal / usage note

Repage extracts content from third-party pages at the user's request. Users are responsible for ensuring they have the right to extract, reuse, or modify content from any URL they submit. This tool does not grant any license to third-party site content.

## License

Private repository — not currently licensed for external use or distribution. Licensing terms (if made public) are still under consideration.
