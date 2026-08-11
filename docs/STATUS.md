# GSIVPlatform — Project Status & Handoff

> **READ THIS FIRST** when starting a new session or worker. This is the
> single source of truth for where the project stands, what to do next, and
> how to work here.

**Updated:** 2026-08-11 — Phase A + B complete, **Phase C deployed**: all 9 modules +
frontend live on prod :3102, Caddy site wired. See §7 for the session handoff.

---

## 1. What this project is

Greenfield rewrite ("v2") of the GSIVDashboard (GemStone IV service dashboard)
as a **modular platform**: compile-time modules registered in a central
registry, each module = routes + store + scopes + WS events + frontend page.
The old v1 repo (`D:\Code Projects\GSIVDashboard`) stays as the reference
implementation; sales-tracker (`D:\Code Projects\sales-tracker`) is folded in
as the `pricing` module.

**Authoritative docs:**
- Architecture: `docs/design/2026-08-10-modular-platform-design.md`
- Design briefs + outputs: `docs/design/README.md`, `docs/design/briefs/`, `docs/design/output/`
- Plans: `docs/plans/` (core-platform, per-module; the last 6 modules each have one)
- Security contract: `backend/SECURITY.md` (per-module sections)
- Deployment: `deploy/V2-DEPLOYMENT.md`
- Agent onboarding: `AGENTS.md` (read by Antigravity/Gemini too)
- Frontend design handoff (Gemini): `docs/design/2026-08-10-frontend-handoff.md`

## 2. Current state (verified 2026-08-11)

| Area | State |
|---|---|
| Repo | `github.com/Buckwheet/GSIVPlatform` (PUBLIC), branch `main`, SSH remote |
| Branch rules | `main` protected: PRs required, direct push blocked, auto-delete on merge. **All work ships via branch + PR** (`gh pr merge <n> --merge`). |
| Backend | Hono + TS strict, **209 tests / 35 files**, tsc + Biome clean |
| Modules live | **all 9**: `health`, `inventory` (read-only invdb), `pricing`, `gems` (jars+queue), `healer`, `characters` (systemd), `accounts` (TOTP-gated), `config` (go2/eherbs), `analysis` — each with review-gated core capabilities |
| Frontend | **Phase B**: Vite+React shell (scope-gated nav), token gate, WS layer (backend `/ws` bridge + client), pages for **all 9 modules**, and a full **design-system restyle by Gemini Flash** (13-primitive kit) |
| Server | **DEPLOYED (Phase C)** — `gsiv-platform.service` on :3102 alongside v1 (:3100): all 9 modules + frontend dist live; Caddy site `gsiv.phylactery.ovh` wired (public once the DNS record is added). |
| Design | All 4 briefs executed → `docs/design/output/`; frontend adopted tokens + primitives |

**Merged 2026-08-10:** PRs #4–#13 (modules, frontend foundation, WS, endpoint fixes, Gemini design restyle).
**Merged 2026-08-11:** PR #14 registry-driven manifest (backend `Module.nav` → `frontend/src/generated/modules.json`, generated nav/routes, 8 tests), PR #15 polish (loading states, density toggle, a11y, backend Biome lint clean). main @ `2788b26`.

## 3. How to work here (mandatory)

1. Always branch off updated `main`: `git checkout -b <type>/<topic>`.
2. Commit, push, then `gh pr create --base main`. Merge via `gh pr merge <n> --merge`.
3. Never push to `main` directly (blocked anyway). **Create the feature branch BEFORE committing** (twice this session work landed on main by mistake and had to be moved).
4. Secrets: never commit. Server `.env` is `/opt/gsiv-platform/backend/.env` (mode 600). `AUTH_TOKENS=name:token:scope1,scope2` (missing scopes = admin).
5. File edits on D:\ repos go through **bash** (`cat > file << 'XEOF'` or node scripts) — the dedicated edit tools are confined to C:\.
6. TDD: failing test → implement → passing test → commit. Gate before merge:
   `cd backend && npm test && npm run typecheck && npm run lint`; `cd frontend && npm run build`.
7. Security review for each module before merge (see `backend/SECURITY.md`). The automated `security_review` subagent CANNOT see D:\ repos (workspace confinement) — use the built-in `review` + a manual security pass.
8. **Review-gated capabilities rule (non-negotiable):** `child_process`, entry.yaml/lich-db/config-dir/analysis-dir file IO, and TOTP live ONLY in `backend/src/core/*` (systemd, ruby, lich-db, config-files, analysis-files, script-runner, totp, entry-yaml). Modules never exec or touch those paths directly; no shell strings (execFile args arrays only).
9. Long file writes via heredoc get truncated mid-file (tool limit) — write big files in 2–3 chunks and join split lines after. Escaped `\t`/regex inside `node -e` heredocs get mangled — use `String.fromCharCode(92)` or script files in the backend dir.

## 4. What's next (in order)

### Phase B — frontend (complete)
- **Registry-driven module manifest** — DONE (PR #14): `cd backend && npm run gen:manifest` regenerates `frontend/src/generated/modules.json`; nav + routes derive from it (fail-fast validation, per-page code-splitting).
- Design polish — DONE (PR #15): loading states on all fetch pages, density toggle (topbar, persisted, coarse-pointer-safe), a11y; backend Biome lint fully clean.
- Game View: link to VellumFE headless on server, deep-link only (`04-game-view`) — pending (config/deploy item).

### Phase C — deploy-phase (mostly done; `deploy/V2-DEPLOYMENT.md`)
- **Redeploy v2** — DONE 2026-08-11: all 9 modules + frontend live on :3102 (was 3 modules before).
- Expose via Caddy — DONE: `gsiv.phylactery.ovh` site block applied + verified via Host header. **Needs one Cloudflare A record `gsiv → 51.68.235.144` (proxied, like the other subdomains) to go public.**
- Pricing data import from old sales-tracker DB (`/opt/sales-tracker/data/sales.db`) — pending.
- Lich URL migrations to `/api/modules/*` (jar seller, healer, characters watchdog, config, accounts) + retire v1 (port 3100) — pending.

### Hardening backlog (documented in backend/SECURITY.md)
- `.bak` rotation (config/entry writes), symlink realpath checks on fs capabilities, payload caps where missing, PasswordCipher password-in-ARGV → stdin (server-only concern).

## 5. Server facts (read-only reference)

- Host: `ubuntu@51.68.235.144` (SSH key in `~/.ssh/id_ed25519`, user `ubuntu`)
- v2: `/opt/gsiv-platform/backend`, service `gsiv-platform.service`, port 3102; frontend dist served by Caddy from `/opt/gsiv-platform/frontend`; public URL `https://gsiv.phylactery.ovh` (needs Cloudflare A record `gsiv → 51.68.235.144`, proxied)
- v1: `/opt/gs4sd/backend`, service `gs4sd-backend.service`, port 3100 (don't touch)
- Inventory DB (shared, read-only by v2): `/opt/gs4sd/lich5/data/inv.db3`
- Env vars for the new modules (set in `/opt/gsiv-platform/backend/.env`):
  `ENTRY_YAML_PATH=/opt/gs4sd/lich5/data/entry.yaml`, `TOTP_SECRET_PATH`, `LICH_DB_PATH=/opt/gs4sd/lich5/data/lich.db3`, `ANALYSIS_DATA_DIR=/opt/gs4sd/data`, `LICH_LOG_DIR=/opt/gs4sd/lich5/logs`, `GSIV_DATA_DIR`, `GST_DATA_DIR` (derived from entry.yaml dir by default), `AUTH_TOKENS`, `INV_DB_PATH`, `PRICING_DB_PATH`, `DB_PATH`.
- Ruby PasswordCipher + go2/eherbs sqlite + analysis shell scripts are **server-only** (need Ruby + the lich dir; on dev they surface errors — expected).

## 6. Gotchas / memory

- Reasonix workspace root is `C:\Users\rpgfi`; repos are on D:\ — use bash for edits.
- Sub-agents' write tools are confined to the workspace; the `security_review` subagent reviews the wrong repo (v1) — do manual security passes.
- v1 git history was rewritten 2026-08-09 (filter-branch) — old clones invalid; re-clone if a stale clone appears.
- Don't stop working autonomously unless genuinely blocked on a user decision; never delete anything; keep working through the plan.
- Frontend dev: `cd frontend && npm run dev` (proxies /api + /ws → backend :3102; `BACKEND_PORT` override). WS client auto-reconnects; pages use `useWsEvents` for live boards (jars/healer). Token gate → `GET /api/me` → scopes drive nav.
- Gemini/Antigravity may work the repo too — `AGENTS.md` + the frontend handoff brief are its instructions; a stale working tree can collide, so `git pull` + check `git status` before starting.

## 7. Session handoff — 2026-08-11 → next session (start here)

**Where we are:** Phase A + B complete (9 modules, 219 tests, frontend manifest-driven nav/routes + polish). **Phase C deployed 2026-08-11**: all 9 modules + frontend live on prod :3102 (verified endpoint-by-endpoint), Caddy site `gsiv.phylactery.ovh` wired and verified via Host header. main @ `2788b26`.

**Finish Phase C (in order):**
1. **Cloudflare DNS** (user action): A record `gsiv` → `51.68.235.144` (proxied, like `dashboard`/`sales`). Once it propagates, `https://gsiv.phylactery.ovh` is live — verify `/health`, log in with an admin token, click through the 8 module pages. (Everything behind it is already tested via Host-header curl.)
2. **Pricing data import**: `/opt/sales-tracker/data/sales.db` → v2 pricing DB (see `deploy/V2-DEPLOYMENT.md`).
3. **Lich URL migrations** to `/api/modules/*` (jar seller, healer, characters watchdog, config, accounts) + retire v1 (port 3100) once confident.

**If continuing dev:** gate = `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`. Run backend (`cd backend && AUTH_TOKENS=... npx tsx src/index.ts`) + frontend (`npm run dev`), paste token in the UI. Dev servers may be running from a previous session — kill stale ones first.

**Dev servers left running (user can keep viewing :5173):** backend `:3102` (seeded jars/queue/healer demo data) + Vite `:5173`. Kill before redeploying or if Antigravity needs the ports. Tokens in use: `readtok` (module scopes) / `admintok` (`*`).

**Known env-limited things on dev (NOT bugs):** config go2/eherbs (needs ruby+lich.db3), analysis (needs server scripts + Groq key), inventory (needs inv.db3), pricing (needs sales import), TOTP (set up on Accounts page).

**Open items / loose ends:**
- `PROJECT_STATE.md` (repo root) is Gemini's design-pass work log — keep or fold into docs.
- Frontend pages hardcode endpoints matching the real module routes — if a route changes, update the page (see the handoff brief's constraint list). **2026-08-10 late fix:** pricing page crashed because `/pricing/sales` returns paginated `{sales:[]}` not an array — fixed (`20c66bb`); all other pages audited against real response shapes (only pricing was broken).
- Dev demo data (jars/queue/healer/request) lives in the backend InMemoryKV and was lost on the last restart — re-seed if you want the Jars/Healer boards populated on dev (POST a jar, join the queue, register a healer).
- `GET /api/logs` (event history) not ported — needs the logEvent core (later item).
- The `review` subagent works on the D:\ repo; `security_review` does not (see §6).
