# GSIVPlatform — Agent Instructions (read first)

Personal GSIV (GemStone IV) dashboard. **V2 = modular backend (Hono) + React/Vite frontend**, ported from v1 (`D:\Code Projects\GSIVDashboard`, port 3100 — read-only reference). V2 runs on :3102.

## Repo layout
- `backend/` — Hono API. `src/core/` (auth, KV, db, registry, WS bridge, **review-gated capabilities**), `src/modules/<name>/` (health, inventory, pricing, gems, healer, characters, accounts, config, analysis). Every route is scope-guarded; modules never import each other's internals.
- `frontend/` — Vite + React + TS. `src/core/manifest.ts` (data-driven nav), `src/pages/` (one per module), WS client in `src/core/ws.ts`.
- `docs/` — `STATUS.md` (state + plan), `plans/`, `design/` (briefs + outputs), `deploy/`.

## Run (dev)
```bash
# backend (any port; frontend proxies to 3102 by default)
cd backend && AUTH_TOKENS="admin:tok:*,reader:rtok:characters.read,gems.read" npx tsx src/index.ts
# frontend
cd frontend && npm install && npm run dev    # http://localhost:5173
```
Tokens: `name:token:scope1,scope2` (missing scopes = admin). The UI gates nav on scopes from `GET /api/me`. Sensitive entry.yaml edits are TOTP-gated (secret file `TOTP_SECRET_PATH`).

## Architecture rules (non-negotiable)
- **Review-gated core capabilities**: `child_process`, entry.yaml/lich-db/config-dir/analysis-dir file IO, and TOTP live ONLY in `backend/src/core/*` (systemd, ruby, lich-db, config-files, analysis-files, script-runner, totp, entry-yaml). Modules never exec or touch those paths directly. No shell strings — always `execFile` with args arrays.
- **Scopes**: every route declares scopes; `registry.validate()` fails the build on gaps. `accounts.write` + TOTP for entry mutations.
- **KV-backed operational state** (`gems:jars:*`, `healer:*`, `characters:managed`) vs **CoreDb durable data** (pricing, accounts scan) — don't mix.

## Workflow
- Work on a branch, ship via PR (`gh pr merge <n> --merge`). Merge happens per module/page.
- Gates before merge: `cd backend && npm test && npm run typecheck && npm run lint`; `cd frontend && npm run build`. Full suite currently 209 tests.
- Security-sensitive changes: run the review pass and document trade-offs in `backend/SECURITY.md` (per-module sections).
- Plans live in `docs/plans/`; update `docs/STATUS.md` at milestones.

## Dev-environment gotchas
- This workspace is on Windows; `backend/data/` and `/opt/gs4sd/...` paths only exist on the server. Ruby lich scripts (PasswordCipher, go2/eherbs sqlite) and analysis shell scripts are **deploy-only** — on dev they surface errors (expected).
- Env vars: `ENTRY_YAML_PATH`, `TOTP_SECRET_PATH`, `LICH_DB_PATH`, `ANALYSIS_DATA_DIR`, `LICH_LOG_DIR`, `GSIV_DATA_DIR`, `GST_DATA_DIR`, `AUTH_TOKENS`, `INV_DB_PATH`, `PRICING_DB_PATH`, `DB_PATH`. Never hardcode server paths in commits.

## Current state (main @ 4267998)
Phase A backend complete (9 modules), Phase B frontend shell + all module pages + WS layer. Next: registry-driven manifest, design polish, deploy wiring.

## Frontend design (Gemini/Antigravity handoff)
If you are redesigning the frontend UI: follow `docs/design/2026-08-10-frontend-handoff.md` —
implement the primitive kit from `docs/design/output/02-design-system/primitives.md` first,
then rebuild pages. Keep the data layer, scope gating (`can()`), WS hooks (`useWsEvents`),
and endpoint calls intact.
