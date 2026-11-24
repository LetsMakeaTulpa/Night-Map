# AGENTS.md

Night Map — a static, mobile-first React 18 + TypeScript + Vite + MapLibre PWA for
San Francisco public-space and civic data. No backend; state lives in IndexedDB.

Start with [docs/build-prompt.md](docs/build-prompt.md) — product brief, data
rules, feature specification, responsive rules and acceptance criteria. Repo-wide
context is in [README.md](README.md); what is done and what is refused is in
[ROADMAP.md](ROADMAP.md).

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Default branch. The scheduled nightly workflow deploys it to Cloudflare Pages when credentials are configured; a push alone does not deploy. Do not push to it directly. |
| `merge/e15d06a-into-main` | Integration branch where feature work is assembled before it reaches `main`. |
| `freebuff/<chat-id>` | Per-chat working branch. Branch from `merge/e15d06a-into-main`, one branch per task. |
| `backup/*`, `preview/*` | Snapshots and throwaway previews. Never build on them. |

Push only the branch you are working on.

## Install

Requires Node 20+ and npm.

```bash
npm ci
```

Use `npm ci`, not `npm install`; `package-lock.json` is the source of truth.

## Run

```bash
npm run dev       # Vite dev server on http://localhost:3000 (binds 0.0.0.0)
```

`dev` rebuilds the street tiles first (the `predev` step) and does not register a
service worker; offline behaviour only works in the production preview.

```bash
npm run build     # typecheck, bundle, generate dist/sw.js
npm run preview   # serve the built PWA on http://localhost:3000
```

`dev` and `preview` both default to port 3000 with `strictPort`, so stop one
before starting the other. Playwright and CI use 4173: `npm run preview -- --port 4173`.

## Check

```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit tests, colocated in src/**/*.test.ts
npm run test:e2e    # Playwright against a production build; run `npx playwright install` once first
```

## Data

The City-backed JSON under `src/data` and `public/` is a committed snapshot.
Regenerate it with `npm run data:refresh`; that deliberately skips the basemap,
terrain and building-footprint tiles, which have their own `npm run data:*`
scripts (see README). Never hand-edit generated files, and never invent records
or present a static snapshot as a live feed.
