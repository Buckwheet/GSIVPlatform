# GSIVPlatform — Project Status & Handoff

> **READ THIS FIRST** when starting a new session or worker. This is the
> single source of truth for where the project stands, what to do next, and
> how to work here.

**Updated:** 2026-08-10 (last: v2 deployed to server, design outputs landed)

---

## 1. What this project is

Greenfield rewrite ("v2") of the GSIVDashboard (Gemstone IV service dashboard)
as a **modular platform**: compile-time modules registered in a central
registry, each module = routes + store + scopes + WS events + (future) page.
The old v1 repo (`D:\Code Projects\GSIVDashboard`) stays as the reference
implementation; sales-tracker (`D:\Code Projects\sales-tracker`) is folded in
as the `pricing` module.

**Authoritative docs:**
- Architecture: `docs/design/2026-08-10-modular-platform-design.md`
- Design briefs + outputs: `docs/design/README.md`, `docs/design/briefs/`, `docs/design/output/`
- Plans: `docs/plans/2026-08-10-core-platform.md`, `...-inventory-module.md`, `...-pricing-module.md`
- Security contract: `backend/SECURITY.md`
- Deployment: `deploy/V2-DEPLOYMENT.md`

## 2. Current state (verified 2026-08-10)

| Area | State |
|---|---|
| Repo | `github.com/Buckwheet/GSIVPlatform` (PUBLIC), branch `main`, SSH remote |
| Branch rules | `main` protected: PRs required, direct push blocked, force-push blocked, auto-delete on merge. **All work ships via branch + PR.** |
| Backend | Hono + TS strict, 60 tests / 14 files, tsc + Biome clean |
| Modules live | `health` (built-in), `inventory` (read-only invdb port), `pricing` (sales-tracker fold-in + scraper) |
| Server | **DEPLOYED** — `gsiv-platform.service` on :3102 alongside v1 (:3100). Verified against real prod data. |
| Design | All 4 briefs executed → `docs/design/output/` (24 files). Design system (02) is the frontend foundation. |

## 3. How to work here (mandatory)

1. Always branch off updated `main`: `git checkout -b <type>/<topic>` (e.g. `feat/gems`, `docs/foo`).
2. Commit, push, then `gh pr create --base main`.
3. Merge via `gh pr merge <n> --merge` (branch auto-deletes).
4. Never push to `main` directly (blocked anyway).
5. Secrets: **never commit**. `.env` is gitignored; server `.env` is
   `/opt/gsiv-platform/backend/.env` (mode 600). Use placeholders in
   `.env.example` only.
6. File edits on D:\ repos go through **bash** (`cat > file << 'XEOF'` or
   node scripts) — the dedicated edit tools are confined to C:\.
7. TDD: failing test → implement → passing test → commit. Gate before merge:
   `cd backend && npm test && npm run typecheck && npm run lint`.
8. Security review (`security_review`) required for each module before merge
   (see `backend/SECURITY.md` module gate).

## 4. What's next (in order)

### Phase A — remaining backend modules (each = its own branch + PR)
1. **gems/jars pipeline** ← NEXT (jar status per char, fullness, claim/clear, queue; WS live updates)
2. **healer** (healer registry, pending requests, accept/complete)
3. **characters / managed** (systemd units: list, start, stop, restart)
4. **accounts / entry** (accounts list, scan, entry.yaml mgmt — TOTP-gated, most sensitive)
5. **config / go2 / eherbs** (per-character config editing)
6. **analysis / ai** (combat log analysis, history, upload)

Reference source for ports: v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts` (routes) + per-feature files; the pricing module port is the template for how to do it.

### Phase B — frontend (React + Vite)
- Design outputs are ready: adopt `docs/design/output/02-design-system/tokens.css` first.
- Build shell (`01-shell-and-nav`), then per-module pages (`03-module-pages`), game view link to VellumFE (`04-game-view`).
- BuckTV replacement = VellumFE headless on server, deep-link only.

### Phase C — deploy-phase (documented in `deploy/V2-DEPLOYMENT.md`)
- Expose :3102 via Caddy (subdomain/path) — deliberate, not wired yet
- Pricing data import from old sales-tracker DB (`/opt/sales-tracker/data/sales.db`)
- Lich autoprice URL migration to `/api/modules/pricing/*`
- Retire v1 (port 3100) once all modules are ported

## 5. Server facts (read-only reference)

- Host: `ubuntu@51.68.235.144` (SSH key in `~/.ssh/id_ed25519`, user `ubuntu`)
- v2: `/opt/gsiv-platform/backend`, service `gsiv-platform.service`, port 3102
- v1: `/opt/gs4sd/backend`, service `gs4sd-backend.service`, port 3100 (don't touch)
- Inventory DB (shared, read-only by v2): `/opt/gs4sd/lich5/data/inv.db3`
- Redeploy: see `deploy/V2-DEPLOYMENT.md`

## 6. Gotchas / memory

- Reasonix workspace root is `C:\Users\rpgfi`; repos are on D:\ — use bash for edits.
- Sub-agents' write tools are confined to the workspace; have them write there and copy to D:\ (see how the design outputs were landed).
- v1 git history was rewritten 2026-08-09 (filter-branch) — old clones invalid; re-clone if a stale clone appears.
- Don't stop working autonomously unless genuinely blocked on a user decision; never delete anything; keep working through the plan.
