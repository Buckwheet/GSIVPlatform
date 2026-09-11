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

## Session discipline (mandatory)
- **End every wrap-up with a restart prompt.** When a block of work ends, or the user signals a pause / "what's next": write the progress AND hand over a copy-paste restart prompt for a new session — repo path, "read `docs/STATUS.md` §7 first", current state, next step, testing rule, server access, parked items, memories to recall — then **embed that same prompt in `docs/STATUS.md` §7** so it survives the session.
- **Say so when a new session is in order — and give the prompt.** Make it an explicit judgement, not a silent grind: call it when the session's tool state has degraded (e.g. local file-mutating shell commands get refused, so `git add/commit/push` and scratch cleanup cannot run) or when a long context makes a clean handoff cheaper.
- **Keep the work moving through a degraded shell.** `ssh`/`scp` and read-only commands keep working when local mutations are refused: do the work, and hand the git steps to a subagent (or a fresh session) instead of skipping them. Never let "I couldn't commit" become "the change didn't happen".
- **Never leave work unshipped silently.** If something could not be committed this session, say exactly what and where it sits.

## VellumFE release loop (production)
- The characters' game streams run on the OVH box from `/opt/vellumfe/vellum-fe` — upstream `Nisugi/VellumFE` **plus our two embedded web-UI patches** (zero-click `autoConnectLich`, no-flash `zeroClickConnecting`). Upstream deliberately never auto-connects, so this divergence is permanent; the delta lives in `deploy/vellumfe/gsiv-webui.patch`.
- **When a new upstream release appears, run the playbook: `deploy/VELLUMFE-UPGRADE.md`.** Read it, then follow it — it defines what we take (one rebuilt binary, nothing else), the port/build/swap/verify/rollback steps, and the provenance checks.
- **Never hand-patch `app.js` on the box** (that is how the two patches ended up living only in a server backup), never `cp` over the running binary, derive the unit list from `systemctl list-units 'vellum-fe@*'` (not the `.service.d` drop-ins), and remember GitHub tag archives are **not** immutable — compare the `pristine_appjs=` hash the build prints; `/app.js` is also served with a 4h cache, so verify after a hard refresh.
- Restarting a stream unit needs the user's approval (it drops that character's stream for a few seconds). Test on Fisternar/Neleourg only — **Amn is off-limits**.

## Dev-environment gotchas
- This workspace is on Windows; `backend/data/` and `/opt/gs4sd/...` paths only exist on the server. Ruby lich scripts (PasswordCipher, go2/eherbs sqlite) and analysis shell scripts are **deploy-only** — on dev they surface errors (expected).
- Env vars: `ENTRY_YAML_PATH`, `TOTP_SECRET_PATH`, `LICH_DB_PATH`, `ANALYSIS_DATA_DIR`, `LICH_LOG_DIR`, `GSIV_DATA_DIR`, `GST_DATA_DIR`, `AUTH_TOKENS`, `INV_DB_PATH`, `PRICING_DB_PATH`, `DB_PATH`. Never hardcode server paths in commits.

## Current state — see `docs/STATUS.md`
All 9 modules + the frontend are live on the OVH box, which also runs the VellumFE game streams. No pinned commit sha here on purpose (it drifts) — `docs/STATUS.md` (state table, §3 rules, §7 handoff) and `git log` are authoritative.

## Frontend design (Gemini/Antigravity handoff)
If you are redesigning the frontend UI: follow `docs/design/2026-08-10-frontend-handoff.md` —
implement the primitive kit from `docs/design/output/02-design-system/primitives.md` first,
then rebuild pages. Keep the data layer, scope gating (`can()`), WS hooks (`useWsEvents`),
and endpoint calls intact.
