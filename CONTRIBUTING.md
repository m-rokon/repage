# Contributing to Repage

Thanks for considering a contribution — this is a young project with plenty of rough edges, and outside input is genuinely welcome, not just tolerated.

This doc covers the practical stuff: setup, where things live, and the guardrails that keep the IR (Intermediate Representation) stable as more people touch the codebase.

## Before you start

- **Open an issue first for anything substantial** — new serializers, changes to the IR schema, or anything touching the extraction pipeline. This avoids wasted work if the approach needs discussion.
- **Small fixes** (typos, obvious bugs, docs) can just go straight to a PR.
- If you're unsure which bucket your idea falls into, open an issue and ask — that's a fine use of one.

## Getting set up

Requires Node 20+.

```bash
git clone https://github.com/m-rokon/repage.git
cd repage

npm install
npx playwright install chromium   # one-time browser download

npm run dev        # API on 127.0.0.1:5177 + web UI on localhost:5173
```

Useful commands while working:

```bash
npm run spike -w server -- https://example.com   # run the full pipeline against a URL, dump output to server/scratch/
npm run typecheck                                 # strict TS, no `any` escape hatches — run before every push
npm run build                                      # typecheck + production build
npm run start                                       # run the built server
```

The `spike` command is the fastest way to sanity-check a change against a real page without going through the UI — use it liberally.

## Where things live

```
server/src/
  extract/extractor.ts   # Playwright capture: rendered DOM, used-CSS filtering, scripts
  clean/clean.ts, css.ts # cleaning pass: cruft strip, CSS dedupe/unused-drop, class renames, CMS-loop detection
  types.ts               # the IR schema (contract between extraction and serializers)
  serialize/             # one serializer per output mode (static, react)
  server.ts, jobs.ts     # Fastify API, in-memory job store + per-URL IR cache, rate limiting
web/src/                 # React + Vite UI: URL in, progress, code tabs, copy/zip, fidelity preview
```

If you're not sure where a change belongs, the rule of thumb is: **extraction** = getting data out of a live page, **cleaning** = normalizing/simplifying that data, **serialize** = turning the IR into a specific platform's code. Keep those concerns separated.

## The IR is the contract — treat it carefully

The Intermediate Representation (`server/src/types.ts`) is what makes the serializer architecture work: extraction happens once, and every output mode is just a transform on top of the same IR. That also means **changes to the IR schema ripple through every serializer** — static and react today, and whatever gets added later.

If your change touches `types.ts`:

- Explain in the PR *why* the existing shape doesn't support what you're doing, not just what you changed.
- Check that both existing serializers (`serialize/`) still handle the new/changed fields sensibly — don't leave one serializer silently ignoring new IR data.
- Prefer additive changes (new optional fields) over renaming/removing existing ones where possible.

## Adding a new output mode

The README roadmap mentions bringing back Framer, Shopify, and Webflow serializers (previously cut for focus) as plugins, plus ideas like a Tailwind mode. If you want to tackle one of these:

1. **Don't reach back into the extractor for mode-specific data.** Everything your serializer needs should already be representable in the IR. If it's not, that's an IR discussion (see above) — open an issue first.
2. Add your serializer as a new file under `server/src/serialize/`, following the existing `static`/`react` serializers as a structural reference.
3. Wire it into the job/output API (`jobs.ts`, `server.ts`) the same way the existing modes are exposed via `GET /api/jobs/:id/output/:mode`.
4. Add a corresponding tab/option in the web UI (`web/src/`) so it's actually reachable, not just available via API.
5. Update the README's **Output modes** table.

## Code style / quality bar

- Strict TypeScript, no `any` escape hatches — `npm run typecheck` must pass clean.
- Match the existing structure rather than introducing new patterns for the same kind of problem (e.g. don't add a second job-store mechanism alongside the existing in-memory one without discussing it first).
- Keep cleaning-pass heuristics (cruft stripping, CSS dedupe, CMS-loop detection) isolated in `clean/` — if you're adding a new heuristic, a short comment on *why* the pattern indicates what it does helps the next person debug it later.

## Reporting bugs

Bug reports are most useful with:

- The **URL** you extracted (if it's not private/internal — see the rate-limiting note in the README, some target URLs are rejected by design)
- The **output mode** you used
- What you **expected** vs. what you **got** (a screenshot or the extracted code snippet helps a lot here)

## Legal note

Repage extracts content from third-party pages at the contributor's/user's own request and risk. When testing against real sites, keep in mind you're responsible for having the right to extract and reuse whatever you point it at — the same note applies in the README for end users.

## License

By contributing, you agree your contributions are licensed under the project's [MIT license](LICENSE).
