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
- **`/lookup` page + Bank tab live (item-search step 1)**: new Lookup page in the operations group (`/lookup`, order 20, shell-owned core item — no new backend module yet); Bank tab renders sortable per-character × town-bank silvers (10 town columns + stored-Total column), per-char account · L{level} {prof} sub-line, grand total footer, character-name + account filters, currency formatting (thousands separators; missing town = –), disabled `launch ▸` per char (wired in step 5); disabled tabs for Resources/Tickets/Items (steps 2–4). `GET /api/modules/inventory/bank` extended with `account`/`prof`/`level` (stored Total row is authoritative for the per-char total; town-sum fallback when a char has no Total row).
- **/lookup step 4 (Item search) live** (`7c203b2`, PR #41): `GET /api/modules/inventory/search` gains a `filter=` param cloning invdb.lic's query grammar (bare-word name search, `type=`/`location=`/`amount>N`/`!=`/`/regex/`+`!`/`*` wildcards/`|`,` arrays/`limit=`/`orderby=`; case-insensitive regexp registered like invdb; unknown filter/bad regex/extras → 400 with message). Legacy `q`/`character`/`location` still work; rows gain `account`/`loc`/`location_name`/`path`/`registered`/`hidden`/`timestamp`. `/lookup` Items tab enabled: filter-expression input + example chips + grammar hint; results table with loc abbr + full-name tooltip, item/noun + container path, qty/type/stack/status/marked; launch ▸ still disabled (step 5). 300 tests green (24 store grammar tests + 3 route tests added); deployed + verified live on the box (200 with results, 400 on bad filter).
- **/lookup step 3 (Tickets + Lumnis)** (`ebf02c4`): Tickets tab enabled — Tickets table (per-char source/amount/currency: gold, bloodscrip, ethereal scrip, tickets, soul shards, raikhen, blackscrip) + Lumnis table (status/triple/double/total/start_day/start_time/last_schedule), same character-name + account filters; lazy-loaded. Backend: `GET /api/modules/inventory/tickets` extended with `account`; new `GET /api/modules/inventory/lumnis`. Pending (user, deferred): clean up chars no longer owned (e.g. **Mahres** / Buckwheet) from invdb data + characters.
- **/lookup step 2 (Resources) + Bank polish** (`77ffb49`): Resources tab enabled on `/lookup` — per-char energy/weekly/total/suffused/favor/bonus with the same character-name + account filters as Bank (lazy-loaded); `GET /api/modules/inventory/resources` extended with `account` (matches `/bank`); Bank tab gains a **Towns column selector** (show/hide any of the 10 town columns, All/None shortcuts).
- **invdb scan-status diagnostics fixed** (`88c5701`): `GET /api/modules/inventory/scan/status` `running` was always true — bare `pgrep -f invdb-parallel.sh` self-matched its own `sh -c` wrapper (UI showed "● scan running" forever and disabled "Run scan now"). Now uses the `[i]` bracket trick, and the endpoint gains `data_as_of` = newest write timestamp across `character/item/silver/resource/tickets` (ISO) so DB freshness is checkable on every scan.
- **Live pipeline consolidated on v2**: hourly `gsiv-sales-scan.timer` (oneshot service) runs `POST /pricing/scrape` + `POST /your-shops/scan` with the machine token (now also `pricing.scrape,yourshops.read,yourshops.write`; token lives in `/etc/gsiv-sales-scan.env` 0600, not in git). v1 `gs4-sales-scraper.timer` **disabled** — v2 pricing.db is the single live source (16,852 rows and growing; v1 db at `/opt/sales-tracker/data/sales.db` frozen as archive).

**Done since this handoff (2026-08-12):**
- **Zero-click Watch confirmed in a real browser** (user): dashboard/Characters Watch link opens the stream with no manual Connect.
- **Login-form flash fixed**: the stream opened but the stock attach form flashed for a split second before auto-connect. Patched VellumFE `app.js` (hide the attach form while the zero-click connect is in flight, show "Connecting…" instead; form restored on error) → `cargo build --release` → swapped `/opt/vellumfe/vellum-fe` (backups: `vellum-fe.bak-beta37`, `vellum-fe.bak-2026-08-12`, `app.js.bak-2026-08-12`) → restarted `vellum-fe@Fisternar`/`@Neleourg`. Verified: streams `up:true`, HTTPS 200s. **Gotcha:** vellum-fe serves `/app.js` with `cache-control: max-age=14400` — browsers keep the old UI for up to 4h after any rebuild; verify with a hard refresh / incognito tab.

**Session log — 2026-08-12 (late, from this session):**
- **Pricing page fixed + deployed** (`bf18f00`): table columns now map to the v2 schema (name/shop/town/cost) — was rendering v1 item/seller/buyer/price keys (empty cells).
- **Server Lich login data synced from local** (`D:\Lich5\data\entry.dat` + `accounts.txt`), gated by live SGE auth: **14 auth-valid accounts** in `/opt/gs4sd/lich5/data/entry.yaml` (adred, buckt2, buckwheet, cgross, diceisthelife, halstein, hoggz, jaycelia, jemley, jg01, jjb311, kaiser999(added), rylohk, shollindal) with SGE-verified char lists; removed marston/ssmith/tworazors/usher1 (don't authenticate); 13 dead local accounts NOT imported. Backups `entry.yaml.bak-2026-08-12-{sync,add14,chars,remove4}`. This roster is what the **invdb scanner cycles** (`gs4sd-lich@<Char>` logins).
- **invdb scan pipeline fixed** (was silently writing nothing): patched `/opt/gs4sd/lich5/scripts/invdb.lic` (benchmark require → gem path; society NULL guard) + `/opt/gs4sd/scripts/invdb-parallel.sh` (no `;repo download` overwrite; `scan_char` polls inv.db3 for the char row instead of fixed 30s sleeps). Scans now persist (78+ chars / 6k+ items; flaky chars converge over re-runs). Patches are server-side — see memory `invdb-lic-patches-scan-all-reliability-fixes-inventory-scheduler-server-time-translation-set-time`.
- **Inventory scheduler deployed** (`b4956c5`): `/api/modules/inventory/{time,schedule,scan/start,scan/status}` + `gsiv-invdb-scan.timer` (daily 03:00 UTC default). **User feedback (pending): scheduler is NOT user-friendly and should NOT live on the Inventory/items page; batch-add by account (15 accounts → threads) needs a better orchestrator.** Redesign is an open item.
- **NEXT FEATURE (user-approved direction, brainstorming started):** clone invdb's query/collection capability into an **interactive item-search** experience — search everything invdb collects, launch a character when a found item looks like the target (so we can look for it in-game), intelligent display of ALL collected data. Deliver stepwise, user signs off per step: **step 1 = bank balances**, then resources, etc. Auto-save progress at each sign-off so a fresh session can resume.

**Item-search feature — stepwise plan (user signs off each step; progress auto-saved after each):**
1. **Bank balances** (first step) — DONE 2026-08-12: interactive per-character/per-bank silvers view with filters on the new `/lookup` page.
2. **Resources** — DONE 2026-08-12: energy/weekly/total/suffused/favor/bonus per char on the `/lookup` Resources tab.
3. **Tickets + lumnis** — DONE 2026-08-12: ticket balances + lumnis status on the `/lookup` Tickets tab.
4. **Item search** — DONE 2026-08-12 (PR #41, `7c203b2`, live): invdb's filter grammar cloned over inv.db3 — bare words (name substring), `type=`/`location=` (name or abbr)/`amount>N`/`level>=N` (character level)/`!=`/`/regex/`+`!`/`*` wildcards/`a|b`+`a,b` arrays/`''` empty/`1,000` ints/`limit=N`/`orderby=-col`; case-insensitive `regexp()` registered like invdb; unknown filter/bad regex → 400. `/lookup` Items tab live: expression input + example chips + grammar hint, results table (character, loc abbr, item/noun+container path, type, qty, stack, status, marked, launch ▸ disabled), inline errors, 500-row cap notice.
5. **Launch-a-character** — from a search result, start the char's Lich session / open its stream to investigate in-game.
6. **Unified display** — intelligent dashboard view of everything invdb collects.
Separate workstream: **scheduler UX redesign** (move off the Inventory page; batch-by-account orchestrator with per-account threads + job status + retries, ~15 accounts).

**Patch-vs-build context (2026-08-12):** the *collection* must run inside a logged-in Lich session (game only reveals inventory to the client) — that's why invdb.lic gets patched for the headless server env (Ruby 4.0.6 gem shadowing, inv.db3 NOT NULL schema, scan timing). The *query/display* layer is dashboard-native (inv.db3 is already read by the v2 inventory module) — that part is built, not patched.

**Step 1 (bank balances) — DONE 2026-08-12:**
- **Home:** the interactive search feature gets its own page/module (`/lookup`, "Lookup", market or operations group) — NOT the Inventory page (scheduler feedback: keep items page clean). Tabs/sections for each step: Bank → Resources → Tickets → Items. Step 1 = the Bank section.
- **Data:** from `/opt/gs4sd/lich5/data/inv.db3` — `silver` (character_id, bank_id, amount) joined with `character` + static `bank` (10 towns + Total), via the v2 inventory module (`/api/modules/inventory/bank` — extend it if needed: it already returns character/bank/silvers).
- **UI:** sortable table of per-character × town-bank silvers; per-char total column; grand total; filters (character name, account via characters join); currency formatting; "launch ▸" affordance per char (wired in step 5).
- **Auto-save:** on sign-off, mark done in this file + memory; fresh session resumes at step 2 (resources).
- **Status:** implemented + committed (`093c97b`). Next session resumes at **step 5 (launch-a-character)**.

**Dev:** gate = `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`. Run backend (`cd backend && AUTH_TOKENS=... npx tsx src/index.ts`) + frontend (`npm run dev`), paste token in the UI. Kill stale dev servers (:3102/:5173) before redeploying. **Edits to this repo go through bash** (D: path — file tools are confined to the C: workspace). Redeploy recipe + lich module docs: `deploy/V2-DEPLOYMENT.md` (§Lich migration).

**Restart prompt (copy-paste into a new session when resuming):**

> Continue GSIVPlatform work in `D:\Code Projects\GSIVPlatform` (repo outside the C:\ workspace — all edits
> through bash; file tools refuse D:). Read docs/STATUS.md §7 first — it has the session log with the full state.
> Item-search feature on /lookup: steps 1–4 DONE + live (Bank, Resources, Tickets+Lumnis, Items tabs — the Items
> tab uses the invdb filter grammar: bare words, `type=`/`location=`/`amount>N`/`level>N`/`!=`/`/regex/`/
> `*` wildcards, `a|b` arrays, `limit=`/`orderby=`). NEXT = **step 5 (launch-a-character — from a search result,
> start the char's Lich session / open its stream to investigate in-game)**, then step 6 unified display. Testing rule:
> Fisternar/Neleourg only, Amn off-limits. Server: `ssh -i ~/.ssh/id_ed25519 ubuntu@51.68.235.144` (origin IP;
> the DNS name is Cloudflare-fronted and unreachable) — runbook at top of /opt/gsiv-platform/backend/.env;
> frontend deploys MUST copy contents into /opt/gsiv-platform/frontend (Caddy root), never dist/; verify the
> public bundle is text/javascript (CF cache poisoning gotcha). Workflow: branch → `gh pr merge`. Parked:
> **Mahres + stale chars cleanup from invdb** (user: do later), **scheduler UX redesign** (batch-by-account
> orchestrator, move off the Inventory page). Recall memories: next-feature-interactive-... ,
> gsiv-server-ssh-origin-ip-... , invdb-lic-patches-... .