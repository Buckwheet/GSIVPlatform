# GSIV Platform — Frontend (Phase B)

React + Vite shell built on the design outputs (`docs/design/output/`).

## Run

```bash
# 1. Backend (any port; dev default 3102):
cd ../backend && AUTH_TOKENS="admin:admintok:*,reader:readtok:characters.read,gems.read" npx tsx src/index.ts

# 2. Frontend dev server (proxies /api → :3102; override with BACKEND_PORT):
npm install
npm run dev          # http://localhost:5173
```

Open the app, paste an API token from `AUTH_TOKENS`, and the shell + nav render
for the scopes that token holds (scopes come from `GET /api/me`).

## Structure

- `src/design/tokens.css` — design-system tokens (adopted from design output 02)
- `src/core/manifest.ts` — data-driven nav model (`nav-ia.md`); add a page + one line here
- `src/core/auth.ts` / `api.ts` — token store, scope gating (`can()`), fetch wrapper
- `src/shell/` — TokenGate (token entry) + AppShell (sidebar/topbar, scope-gated nav)
- `src/pages/` — module pages; Dashboard (landing tiles) + Characters (live list) first

## Build

```bash
npm run build    # tsc -b && vite build
```
