# Your Shops module + live pricing pipeline fix — design (2026-08-12)

## 1. Problem

- The v1 sales-tracker's hourly scraper (`gs4-sales-scraper.timer` → `dist/scraper-run.js`,
  `DB_PATH=/opt/sales-tracker/data/sales.db`) still runs and writes to the **v1** db. v2's
  `pricing.db` only gets manual scrapes and is stale (16,811 rows vs v1's 16,820; last scrape
  2026-08-11T17:46).
- The historical import (`backend/scripts/import-sales.mjs`) copied all sales unfiltered, so the
  user's shops **are** present in v2 — but nothing surfaces or tracks them.
- No per-shop view, no owner mapping, no alerts.

Confirmed shop data in v2 pricing.db:

| Shop | Sales | Town | Span |
|---|---|---|---|
| Erendiir | 188 | Icemule Trace | 2026-03-15 → 2026-08-08 |
| Boiler | 69 | Icemule Trace | 2026-03-20 → 2026-07-25 |
| Jinsem | 16 | Mist Harbor | 2026-04-12 → 2026-08-08 |

## 2. Goals / non-goals

Goals:
- Make v2 the single live source of pricing data (hourly scrape via a v2-native timer).
- A `your-shops` module that maps the user's shops, lists their sales, and alerts (bell + badge +
  toasts) when a new sale is detected.
- Config-driven shop list (seed: Erendiir, Boiler, Jinsem).

Non-goals (v1 of this module):
- Gem-listing sell-through alerts (pricing `listings.confirmed_sold` exists but is out of scope).
- Distinguishing sold vs pulled items (community data is "removed from shop" only).

## 3. Live pipeline: consolidate on v2

- New systemd `gsiv-sales-scan.timer` (hourly, `OnBootSec=5min`, `OnUnitActiveSec=1h` — mirrors
  the old cadence) + `gsiv-sales-scan.service` (oneshot) running a small script that, with the
  **machine token** (`AUTH_TOKENS` abdb…, pricing + your-shops scopes):
  1. `POST /api/modules/pricing/scrape` — incremental pull of `removed_items.json` (ETag).
  2. `POST /api/modules/your-shops/scan` — detect new sales for configured shops, persist, emit.
- **The machine token needs `yourshops.read+write` scopes added** to its `AUTH_TOKENS` entry
  in the server `.env` (currently gems/healer/characters/pricing/lich).
- **Disable** `gs4-sales-scraper.timer` (v1 collection stops; v1 db freezes as archive).
- Idempotent: both calls are safe to run hourly; failures just mean an empty scan that hour.

## 4. Backend module `your-shops` (prefix `/api/modules/your-shops`)

### 4.1 Storage — `data/yourshops.db` (sqlite via CoreDb; KV is in-memory w/o Redis, so a table)

- `shops(id INTEGER PK, name TEXT NOT NULL UNIQUE, town TEXT, created_at TEXT NOT NULL)`
  — the user's shops; seeded Erendiir/Boiler/Jinsem (towns from pricing data).
- `seen(item_id TEXT PK, removed_date TEXT NOT NULL)` — baseline: items already accounted for
  (dedup across scans; never alert twice).
- `notifications(id INTEGER PK, item_id TEXT NOT NULL UNIQUE, shop TEXT, name TEXT, cost INTEGER,
  removed_date TEXT, created_at TEXT NOT NULL, acknowledged_at TEXT)` — the alert queue
  (acknowledged_at NULL = unread).

### 4.2 Endpoints + scopes (`yourshops.read` / `yourshops.write`)

| Method / path | Scope | Purpose |
|---|---|---|
| GET `/shops` | read | list configured shops |
| PUT `/shops` | write | replace the shop list (names; towns auto-derived from pricing data) |
| GET `/sales` | read | all sales for your shops from pricing.db (filters: shop, from/to, page) + stats (count, revenue) |
| GET `/notifications` | read | unread list + `unread` count (badge) |
| POST `/notifications/ack` | write | mark notifications read (`acknowledged_at=now`), body: all or ids |
| POST `/scan` | write | detect new sales for your shops since `seen`, insert notifications, `EventBus.emit("sale_update", …)` |

### 4.3 Scan semantics

- Query pricing `sales` for `shop IN (your shops)` with `removed_date > last seen`; insert
  notifications for rows not in `seen`; insert into `seen`; emit one `sale_update` WS event per
  scan (payload: new-sale summary; the frontend then re-fetches `GET /notifications` to refresh
  the badge + list — the WS event is the wake-up, the fetch is the truth). On first run, history is marked `seen` without alerting —
  no spam from the 273 existing sales. Dedup by `item_id` (matches pricing UNIQUE(item_id)).
  Detection = pricing rows for your shops whose `item_id` is not in `seen` and
  `removed_date > max(seen.removed_date)` (bounded query).

### 4.4 WS

- Add `sale_update` to the `frontend/src/core/ws-bridge.ts` whitelist so browsers receive it.

## 5. Frontend

- **Page** `frontend/src/pages/your-shops/` — nav "Your Shops" (market group, next to Pricing,
  icon 🏪): stats header (today / 7-day sales + revenue), filterable table
  (item · shop · town · price · date), shop-list manager (add/remove, `yourshops.write`).
- **Dashboard tile** in `pages/dashboard/index.tsx` TILES: "X sales · Y this week" → page.
- **Header bell**: unread badge (from `GET /notifications` poll + `sale_update` WS), click →
  dropdown panel of recent sales, "mark all read" → ack; **toasts** via existing ToastProvider
  when a `sale_update` arrives while on the site.
- Manifest via `gen:manifest` (same flow as other modules), lazy chunk.

## 6. Data flow (a new sale)

1. Hourly timer → `POST /pricing/scrape` → pricing.db gains the row.
2. Timer → `POST /your-shops/scan` → notification inserted, `sale_update` emitted.
3. Open dashboard: WS delivers `sale_update` → toast "🏪 Sold: <item> (<price>)" + badge++.
4. Bell panel lists it; ack clears; `your-shops` page shows it in the table/stats.

## 7. Error handling

- Scraper site down → scrape finds nothing; scan is a no-op; next hour retries (idempotent).
- Scan before any scrape → no new rows; harmless.
- Token expiry → scan service fails loudly in journal; user rotates token in `.env`.

## 8. Testing + gate + deploy

- Backend: `backend/tests/modules/your-shops/routes.test.ts` (401/403/200), scan
  detection/dedup/first-run-baseline, ack. Existing pattern per `tests/modules/pricing/`.
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`.
- Deploy: backend dist + frontend to gsiv.phylactery.ovh (recipe in `deploy/V2-DEPLOYMENT.md`);
  create `gsiv-sales-scan.{timer,service}` (drop `gs4-sales-scraper.timer`); verify with
  `curl localhost:3102/api/modules/your-shops/...` and a live scan.

## 9. Open items

- Exact scan cadence (hourly default) — adjustable via the timer.
- Town auto-derivation for shops added by the user: look up first matching pricing row.
