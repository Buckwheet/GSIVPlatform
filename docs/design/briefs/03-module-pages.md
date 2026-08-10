# Design Brief 03 — Module Page Patterns

## Context

GSIVPlatform greenfield rewrite of GSIVDashboard. Each feature is a backend
module + a frontend page (see approved design
`docs/design/2026-08-10-modular-platform-design.md`; shell in brief 01, design
system in brief 02). This brief defines the **page patterns** module pages
follow, so every feature page is consistent without being designed from
scratch each time.

## The modules (page targets)

1. **Inventory** — searchable item/character/location grid, bank silvers,
   resources, tickets. Read-only. (v1 reference:
   `D:\Code Projects\GSIVDashboard\frontend\inventory.html`)
2. **Pricing** — sales search + filters, gem intelligence, shop listings,
   my-shop, price recommendations, trends. (v1 reference:
   `D:\Code Projects\sales-tracker\frontend\`)
3. **Gems/Jars** — jar status per character, fullness, claim/clear actions,
   queue. Live updates via WS.
4. **Bounty** — active bounty card, history, per-task/creature/zone stats,
   complete/remove actions. Live via WS.
5. **Healer** — healer registry, pending requests, accept/complete actions.
   Live via WS.
6. **Characters** — character list with systemd status, start/stop/restart.
7. **Accounts** — account list, auth status, scan, entry.yaml management
   (TOTP-gated), premium info. (v1 reference:
   `D:\Code Projects\GSIVDashboard\frontend\accounts.html`)
8. **Config** — per-character config/go2/eherbs editing.
9. **Analysis** — combat log analysis, history, run/upload.

## Goal

Define a small set of **reusable page patterns** and map every module page to
one. No module page is unique; each is a composition of patterns.

## Patterns to define

For each pattern, give: anatomy, when to use it, data-fetch/WS strategy,
actions placement, empty/loading/error states, and mobile behavior.

1. **List/Search** (inventory, pricing sales, accounts, characters) —
   filterable table/card grid with client or server pagination.
2. **Detail** (single jar, single account, single analysis) — summary header
   + sections + actions.
3. **Live status board** (gems/jars, healer) — cards that update from WS,
   with action buttons, claim/confirm flows.
4. **Dashboard/Overview** (landing) — aggregate tiles + live character strip +
   alerts, linking into modules.
5. **Form/Edit** (config, entry management) — structured forms with TOTP gate
   where needed, save/validation states.
6. **History/Trends** (bounty stats, analysis history, pricing trends) —
   chart + table composition (charts: lightweight, no heavy chart lib
   assumption; canvas or inline SVG acceptable).

## Requirements

- Every page must handle: loading skeleton, empty state, error + retry,
  stale-data indicator (esp. WS-fed pages), auth/401 redirect.
- Action buttons follow one placement rule (per pattern).
- WS-fed pages: one subscription pattern (mount/unmount, reconnect, buffering)
  defined once, reused by all.
- Read-only pages must not show write affordances (scope-driven UI: page
  receives allowed scopes and hides actions accordingly).

## Deliverables (Markdown in `docs/design/output/03-module-pages/`)

1. `README.md` — index + pattern selection table for all 9 modules above.
2. `patterns.md` — one section per pattern (anatomy, states, mobile, actions).
3. `ws-data-pattern.md` — the shared live-data hook pattern (subscribe,
   buffering, reconnect, stale indicator).
4. `scope-driven-ui.md` — how pages render differently per allowed scopes.
5. `page-map.md` — for each module: chosen pattern(s), key data endpoints
   (from the module contract), and any deviations from the pattern.
