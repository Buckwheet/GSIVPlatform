# GSIVPlatform — Project Status & Handoff

> **READ THIS FIRST** when starting a new session or worker. This is the
> single source of truth for where the project stands, what to do next, and
> how to work here.

**Updated:** 2026-08-11 EOD — Phase A + B complete, **Phase C live** (9 modules + frontend on
`gsiv.phylactery.ovh`), pricing imported, hardening + full security audit done.
See §7 for the session handoff.

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

## 2. Current state (verified 2026-08-11 EOD)

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
**Merged 2026-08-11:** #14 manifest, #15 polish, #16 docs, #17 nav-lazy fix, #18 pricing import, #19 hardening, #20 event log, #21 boot-event fix, #22 audit fixes (SGE pin, WS origin, TOTP events, node-server 2.x). main @ `3e3f3d4`.

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
- Game View — **LIVE (2026-08-11)**: VellumFE (Nisugi beta.37) headless per char on the box, Lich `--detachable-client` attach (Fisternar 9101, Neleourg 9102), Caddy `vellum.phylactery.ovh` + basic_auth, dashboard Watch column via the `gameview` module. See `deploy/V2-DEPLOYMENT.md` §VellumFE.

### Phase C — deploy-phase (`deploy/V2-DEPLOYMENT.md`)
- **Redeploy v2** — DONE 2026-08-11: all 9 modules + frontend live, **DNS added, site public**.
- **Pricing data import** — DONE: 16,775 sales + 8 listings imported (`backend/scripts/import-sales.mjs`, idempotent).
- **Security audit** — DONE 2026-08-11: see `backend/SECURITY.md` §audit (SGE cert pin, WS origin check, TOTP events, dep advisory cleared; residuals documented).
- Lich URL migrations to `/api/modules/*` (jar seller, healer, characters watchdog, config, accounts) + retire v1 (port 3100) — **remaining**.
- Game View — **LIVE (2026-08-11)**: VellumFE (Nisugi beta.37) headless per char on the box, Lich `--detachable-client` attach (Fisternar 9101, Neleourg 9102), Caddy `vellum.phylactery.ovh` + basic_auth, dashboard Watch column via the `gameview` module. See `deploy/V2-DEPLOYMENT.md` §VellumFE.

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

## 7. Session handoff — 2026-08-11 EOD → next session (start here)

**Where we are:** Phase A + B complete; **Phase C LIVE + FINISHED** — 11 modules + frontend on `https://gsiv.phylactery.ovh` (259 tests); pricing imported (16,775 sales); hardening + full security audit done (`backend/SECURITY.md` §audit); Game View streams live (VellumFE patched build); **Lich migrations done + v1 retired (port 3100)**. main @ latest.

**Platform inventory:**
- API: `gsiv.phylactery.ovh` — 11 modules (health, inventory, pricing, gems, healer, characters, accounts, config, analysis, logs, **lich**) + gameview + spec. Admin token: `415a689b-f097-4a0d-a8b7-6545afb84c83`; **machine token** `abdb3594-b6dd-4eef-89de-b083197f6798` (gems/healer/characters/pricing/lich read+write) — both in server .env `AUTH_TOKENS`.
- Lich integration: **all on v2** — publisher/premium/jarrer/post to `/api/modules/lich/*` + `/api/modules/gems/*`; units env `GS4SD_URL=http://localhost:3102`, `GS4SD_TOKEN=<machine>`, `gs4sd_streamer` dropped (BuckTV retired); watchdog timer + invdb scanner on v2 with the machine token. Watchdog restarts are gated on `systemctl is-enabled` (only Fisternar/Neleourg enabled — do NOT enable other units casually or the watchdog will start them).
- Streams: VellumFE headless per char — Lich `--detachable-client` (Fisternar 9101, Neleourg 9102), `vellum-fe@<Char>` units (web 9201/9202), Caddy `<char>.phylactery.ovh`; URL `#token=<t>&lich=127.0.0.1:<port>&name=<char>`; no basic_auth. app.js carries two GSIVPlatform patches (zero-click auto-connect; form-flash suppression, 2026-08-12). Rebuild recipe: `deploy/V2-DEPLOYMENT.md` §VellumFE.
- Lich + Ruby: **Lich v5.19.1** (git tag at `/opt/gs4sd/lich5`) on **rbenv Ruby 4.0.6** (`/home/ubuntu/.rbenv/versions/4.0.6/bin/ruby` in all Lich units; Ubuntu apt Ruby 3.2 is too old for 5.19). Upgrade/rollback recipe: `deploy/V2-DEPLOYMENT.md` §Lich + Ruby upgrade. `bundle install` with the full Gemfile (78 gems, no exclusions).
- v1 retired: `gs4sd-backend.service` + `gs4-sales-backend.service` stopped+disabled; ports 3100/3200 free; Caddy `dashboard.phylactery.ovh` + `sales.phylactery.ovh` → 301 to gsiv (fishbyte + bucktv still under the dashboard host); `/opt/gs4sd` files kept for rollback (Lich runtime lives there). `ebounty_tracker.lic` + `gs4sd_streamer.lic` have no v2 home (retired).

**Testing rule: only Fisternar + Neleourg.** Amn is off-limits for any testing (no throwaway test char); verify changes on the live pair with brief restarts (user-approved).

**Remaining (in order):**
1. **Stream more chars** when they come online (3-step recipe in `deploy/V2-DEPLOYMENT.md` §VellumFE).
2. (Optional) port `ebounty_tracker.lic` (`/api/bounty/*`) into v2 if wanted.

**Done since this handoff (2026-08-12, cont.):**
- **your-shops module live** (`/api/modules/your-shops`, page `/your-shops`, dashboard tile, header bell + badge + toasts): tracks the user's shops (seeded Erendiir, Boiler, Jinsem — editable in the UI, `yourshops.read/write`), lists their sales (273 rows, from pricing.db read-only) and alerts on new sales via a `sale_update` WS event. Per-shop baseline: history never spams alerts; adding a shop baselines it silently.
- **Live pipeline consolidated on v2**: hourly `gsiv-sales-scan.timer` (oneshot service) runs `POST /pricing/scrape` + `POST /your-shops/scan` with the machine token (now also `pricing.scrape,yourshops.read,yourshops.write`; token lives in `/etc/gsiv-sales-scan.env` 0600, not in git). v1 `gs4-sales-scraper.timer` **disabled** — v2 pricing.db is the single live source (16,852 rows and growing; v1 db at `/opt/sales-tracker/data/sales.db` frozen as archive).

**Done since this handoff (2026-08-12):**
- **Zero-click Watch confirmed in a real browser** (user): dashboard/Characters Watch link opens the stream with no manual Connect.
- **Login-form flash fixed**: the stream opened but the stock attach form flashed for a split second before auto-connect. Patched VellumFE `app.js` (hide the attach form while the zero-click connect is in flight, show "Connecting…" instead; form restored on error) → `cargo build --release` → swapped `/opt/vellumfe/vellum-fe` (backups: `vellum-fe.bak-beta37`, `vellum-fe.bak-2026-08-12`, `app.js.bak-2026-08-12`) → restarted `vellum-fe@Fisternar`/`@Neleourg`. Verified: streams `up:true`, HTTPS 200s. **Gotcha:** vellum-fe serves `/app.js` with `cache-control: max-age=14400` — browsers keep the old UI for up to 4h after any rebuild; verify with a hard refresh / incognito tab.

**Dev:** gate = `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`. Run backend (`cd backend && AUTH_TOKENS=... npx tsx src/index.ts`) + frontend (`npm run dev`), paste token in the UI. Kill stale dev servers (:3102/:5173) before redeploying. **Edits to this repo go through bash** (D: path — file tools are confined to the C: workspace). Redeploy recipe + lich module docs: `deploy/V2-DEPLOYMENT.md` (§Lich migration).
