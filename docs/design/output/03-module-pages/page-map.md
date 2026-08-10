# Page Map — pattern → module

For each module: **chosen pattern(s)**, **key data endpoints** (following the `/api/modules/<name>/*` + `<module>.<verb>` scope contract from the approved design §4–§6), **WS topics**, and **deviations from the pattern**.

Endpoint names are the design-time contract; the OpenAPI spec generated from the registry is the final authority. Scope names follow `<module>.<verb>` (draft).

---

## Dashboard (landing)

- **Patterns:** 4 — Dashboard/Overview.
- **Endpoints (aggregates):** `GET /api/overview` (tile counts), `GET /api/modules/characters/summary` (character strip), alert topics.
- **WS:** `state.characters.status` (strip), alert/module events.
- **Scopes:** read-only; tiles link into modules. No write affordances.
- **Deviations:** None — the canonical Pattern 4.

---

## 1. Inventory

- **Patterns:** 1 — List/Search (primary); read-only Detail in a modal (single item/character/location).
- **Endpoints:**
  - `GET /api/modules/inventory/items?q=&type=&location=&page=&pageSize=`
  - `GET /api/modules/inventory/items/:id` (detail modal)
  - `GET /api/modules/inventory/characters?q=`, `GET /api/modules/inventory/locations?q=`
  - `GET /api/modules/inventory/silvers`, `GET /api/modules/inventory/resources`, `GET /api/modules/inventory/tickets`
- **Scopes:** `inventory.read` (module is read-only; registry has no `inventory.write` routes).
- **WS:** none.
- **Deviations:**
  - Tabbed List/Search variants (Items / Characters / Locations), shared toolbar.
  - Detail is a **modal**, not a page (rows have little extra data; keeps the page fast).
  - Must obey the read-only rule strictly: zero write affordances (`scope-driven-ui.md` §4).

---

## 2. Pricing

- **Patterns:** 1 — List/Search (sales, shop listings, my-shop, recommendations) + 6 — History/Trends (gem intelligence, price trends).
- **Endpoints:**
  - `GET /api/modules/pricing/sales?q=&item=&seller=&minPrice=&maxPrice=&page=`
  - `GET /api/modules/pricing/listings?q=` (shop listings), `GET /api/modules/pricing/my-shop?q=`
  - `GET /api/modules/pricing/recommendations?item=&window=`
  - `GET /api/modules/pricing/trends?item=&metric=avg_price&from=&to=&bucket=`
  - `GET /api/modules/pricing/gems` (gem intelligence)
  - `POST /api/modules/pricing/jobs` (run scraper job — the one write action)
- **Scopes:** `pricing.read`; `pricing.write` for the scraper job.
- **WS (optional):** `module.pricing.import` / `stream.pricing.import` for job progress (Pattern 6 live append).
- **Deviations:**
  - Multi-pattern page: tabbed List/Search (Sales / Listings / My shop) plus a Trends tab hosting Pattern 6.
  - Recommendations are a List/Search with an extra "confidence" bar column (design-system `Bar`).
  - Job runner appears as the toolbar "create action" (Pattern 1), gated by `pricing.write`.

---

## 3. Gems/Jars

- **Patterns:** 3 — Live status board (primary) + 2 — Detail (single jar) + queue region (Pattern 1 list strip).
- **Endpoints:**
  - `GET /api/modules/gems/jars?character=&state=` (snapshot; also via WS)
  - `GET /api/modules/gems/jars/:id` (detail)
  - `POST /api/modules/gems/jars/:id/claim` , `POST /api/modules/gems/jars/:id/clear`
  - `GET /api/modules/gems/queue` (pipeline queue)
- **Scopes:** `gems.read`; `gems.write` (claim/clear).
- **WS:** `state.gems.jars` (snapshot + deltas), `state.gems.queue`.
- **Deviations:**
  - Clear is destructive → `Confirm` modal before POST (per Pattern 3 rules).
  - Claim is the primary card action; buttons reflect server-authoritative state (pending → confirmed via WS delta).
  - Jar detail opens as a **page** (Pattern 2) — jars have enough state/history to deserve one.

---

## 4. Bounty

- **Patterns:** 3 — Live status board (active bounty) + 6 — History/Trends (history, per-task/creature/zone stats).
- **Endpoints:**
  - `GET /api/modules/bounty/active` (snapshot; also via WS)
  - `POST /api/modules/bounty/active/complete`, `POST /api/modules/bounty/active/remove`
  - `GET /api/modules/bounty/history?page=`
  - `GET /api/modules/bounty/stats?group=task|creature|zone&from=&to=`
- **Scopes:** `bounty.read`; `bounty.write` (complete/remove).
- **WS:** `state.bounty.active` (deltas), `module.bounty.completed` (activity events).
- **Deviations:**
  - The board is **single-card** (one active bounty) rather than a grid — Pattern 3 still governs (live updates, actions, stale strip).
  - Stats region switches between group-by selectors (task/creature/zone) — Pattern 6's metric selector.
  - "Remove" (abandon) is destructive → Confirm modal.

---

## 5. Healer

- **Patterns:** 3 — Live status board (pending requests) + 1 — List/Search (registry).
- **Endpoints:**
  - `GET /api/modules/healer/registry?q=&page=`
  - `GET /api/modules/healer/requests?state=pending` (board snapshot; also via WS)
  - `POST /api/modules/healer/requests/:id/accept`, `POST /api/modules/healer/requests/:id/complete`
- **Scopes:** `healer.read`; `healer.write` (accept/complete).
- **WS:** `state.healer.requests` (snapshot + deltas), `state.healer.registry`.
- **Deviations:**
  - Two regions: pending-request **board** (Pattern 3) + registry **list** (Pattern 1) — either stacked or tabbed; recommend tabs with board default.
  - Accept is a two-step confirm (route the player) — same confirm modal rules as Pattern 3.

---

## 6. Characters

- **Patterns:** 1 — List/Search with per-row actions; live status columns (Pattern 3 flavor for status only).
- **Endpoints:**
  - `GET /api/modules/characters?q=&page=`
  - `POST /api/modules/characters/:id/start`, `POST /api/modules/characters/:id/stop`, `POST /api/modules/characters/:id/restart`
- **Scopes:** `characters.read`; `characters.write` (start/stop/restart).
- **WS (optional):** `state.characters.status` — systemd state patches the status column in place; if WS unavailable, poll the list on a 15–30 s interval (only acceptable fallback; see `ws-data-pattern.md` §8).
- **Deviations:**
  - The status **column** (dot + "running/stopped/failed") is live-updated via WS; the page itself is a List/Search, not a board.
  - Restart is destructive-ish → Confirm modal. Start/Stop are immediate (pattern's per-row primary/secondary split).
  - Bulk "restart selected" appears when ≥1 row selected and `characters.write` is present (Pattern 1 bulk rule).

---

## 7. Accounts

- **Patterns:** 1 — List/Search (account list + auth status) + 2 — Detail (single account) + 5 — Form/Edit (entry.yaml, TOTP-gated).
- **Endpoints:**
  - `GET /api/modules/accounts?q=&page=`
  - `GET /api/modules/accounts/:id` (detail)
  - `GET /api/modules/accounts/:id/auth` (auth status), `GET /api/modules/accounts/:id/premium`
  - `POST /api/modules/accounts/scan` (bulk scan)
  - `GET /api/modules/accounts/entry.yaml`, `PUT /api/modules/accounts/entry.yaml`
  - `POST /api/modules/accounts/totp/verify` (session second factor)
- **Scopes:** `accounts.read`; `accounts.write` (scan); `accounts.entry` (entry.yaml edit, **TOTP-gated**).
- **WS:** none (optional `module.accounts.scanned` for scan progress).
- **Deviations:**
  - Most sensitive module (approved design §8) → Form/Edit only for entry.yaml, with the TOTP gate (`scope-driven-ui.md` §6).
  - Detail opens as a **modal** for account summary; entry.yaml editing is a dedicated page/panel.
  - Scan is the toolbar "create action", gated by `accounts.write`.

---

## 8. Config

- **Patterns:** 5 — Form/Edit (per-character config, go2, eherbs).
- **Endpoints:**
  - `GET /api/modules/config/:character`, `PUT /api/modules/config/:character`
  - `GET /api/modules/config/:character/go2`, `PUT /api/modules/config/:character/go2`
  - `GET /api/modules/config/:character/eherbs`, `PUT /api/modules/config/:character/eherbs`
- **Scopes:** `config.read`; `config.write` (save).
- **WS:** none.
- **Deviations:**
  - Character selector at the top of the form (not a separate list page) — switching character swaps the form context.
  - Config/go2/eherbs as **sections or tabs** within the Form/Edit page; monospace editor with a "validate" step before Save.
  - 409 conflict handling per Pattern 5 (revision check) matters here — configs change server-side.

---

## 9. Analysis

- **Patterns:** 6 — History/Trends (run history + trends) + 2 — Detail (single run) + 5 — Form/Edit (run/upload as a sheet).
- **Endpoints:**
  - `GET /api/modules/analysis/runs?page=&state=` (history)
  - `GET /api/modules/analysis/runs/:id` (detail: log, results, charts)
  - `GET /api/modules/analysis/trends?metric=&from=&to=&bucket=`
  - `POST /api/modules/analysis/run` (params), `POST /api/modules/analysis/upload` (log upload)
- **Scopes:** `analysis.read`; `analysis.write` (run/upload).
- **WS:** `stream.analysis.progress` (run progress appends live to the run's row/detail).
- **Deviations:**
  - Run/Upload is a **Form/Edit sheet** launched from the control bar (Pattern 6 "create action").
  - A running analysis's row shows a live progress bar fed by `stream.analysis.progress`; history otherwise refetches on range/page change.
  - Detail (Pattern 2) for a run shows log + per-combat breakdown sections.

---

## Pattern usage summary

| Pattern | Used by |
|---|---|
| 1 List/Search | Inventory, Pricing, Accounts, Characters (+ Healer registry, Gems queue strip) |
| 2 Detail | Gems/Jars, Accounts, Analysis (+ Inventory modal detail) |
| 3 Live status board | Gems/Jars, Bounty, Healer (+ Characters status column) |
| 4 Dashboard/Overview | Landing |
| 5 Form/Edit | Config, Accounts entry.yaml (+ Analysis run/upload sheet) |
| 6 History/Trends | Pricing, Analysis, Bounty |
