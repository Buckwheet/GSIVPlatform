# Pricing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the sales-tracker (port 3200, `sales.phylactery.ovh`) into GSIVPlatform as the `pricing` module. This is the second feature module and the first read/write one. Retires the standalone service when complete.

**Reference (read-only):** `D:\Code Projects\sales-tracker\backend\src\` — `db.ts` (schema), `gems.ts` (597 lines: gem intelligence), `listings.ts` (151 lines), `scraper.ts` (94 lines), `index.ts` (13 routes). These are the user's own files; the port is faithful (same SQL, same algorithms), adapted to the GSIVPlatform module contract.

**Key differences from v1:**
- v1 had **no auth** (public API, plain CORS). v2 requires auth + scopes on every route.
- v1 DB is at `data/sales.db` (writable, has scraped data). v2 opens the SAME DB file read/write? **Decision: v2 owns a copy of the schema** via `CoreDb.migrate("pricing", [...])` and reads/writes its own DB (path `PRICING_DB_PATH`, default `data/pricing.db`). The old sales.db is imported later via a one-shot data-import task (out of scope here) — or the module can be pointed at the existing DB if desired via env. Keep it simple: fresh schema, env-configurable path.
- Route prefixes change: `/api/sales` → `/api/modules/pricing/sales`, etc. The Lich autoprice script (`gs4sd_jar_seller_autoprice.lic`) calls `/api/gems/price-recommendation` + `/api/listings` — it must be updated to the new prefix when the module lands (a follow-on Lich task, tracked here in Task 5).
- The scraper (`POST /api/scrape`) is an admin-only operation (scope `pricing.scrape`).

## Module contract

```
name: "pricing"
prefix: "/api/modules/pricing"
scopes: pricing.read, pricing.write, pricing.scrape
routes:
  GET  /status                  pricing.read
  POST /scrape                  pricing.scrape   (admin trigger; returns ScrapeResult)
  GET  /sales                   pricing.read     (q, town, shop, min/max_cost, min_enchant, enhancive, is_weapon/armor/jewelry, days, page, limit)
  GET  /gems/types              pricing.read
  GET  /gems/sales              pricing.read     (gem_type, page, limit)
  GET  /gems/intelligence       pricing.read     (gem_type required)
  GET  /gems/price-recommendation pricing.read   (gem_type, count)
  POST /listings                pricing.write    (record a jar listing)
  GET  /listings                pricing.read     (shop, page, limit)
  GET  /listings/sell-through   pricing.read     (shop required)
  GET  /towns                   pricing.read
```

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 13.
- All SQL prepared statements. `pricing.write` and `pricing.scrape` are the only write scopes; `pricing.read` is read-only.
- The scraper fetches `https://shops.elanthia.online/data/removed_items.json` (external, public data). No credentials involved. Rate-limit the scrape endpoint (module-level rate limit already applies; add a manual "one scrape per minute" guard in the store to protect the external host).
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review before merge.

---

### Task 1: PricingStore — schema + all queries

**Files:**
- Create: `backend/src/modules/pricing/store.ts`, `backend/tests/modules/pricing/store.test.ts`, `backend/tests/fixtures/pricing-fixture.ts`
- Test: 6-8 focused tests

**Interfaces:**
- Consumes: `CoreDb` (core, Task 3 of core plan).
- Produces: `class PricingStore { constructor(db: CoreDb) }` with methods: `status()`, `recordScrapeResult(r)`, `searchSales(filters)`, `gemTypes()`, `gemSales(gemType, limit, offset)`, `gemIntelligence(gemType)`, `priceRecommendation(gemType, count)`, `createListing(input)`, `getListings(shop, limit, offset)`, `sellThroughStats(shop)`, `towns()`, plus the internal helpers `isExcluded`, `extractGemType`, `estimateCount`, `getMarketPrice`, `inferPerGemPrice`, `weekStart`.

- [ ] **Step 1: Write pricing-fixture.ts** — in-memory DB with the sales/listings/scrape_state schema + seed: 3 gem jars (e.g. "a jar containing uncut emeralds", "a jar containing sapphires"), 2 individual gem sales, 3 listings (1 confirmed sold), scrape_state etag row.
- [ ] **Step 2: Write failing store tests** (estimateCount correctness, searchSales filters, gemTypes aggregation, createListing + sellThroughStats, towns).
- [ ] **Step 3: Run tests → verify FAIL** (module not found).
- [ ] **Step 4: Implement store.ts** — port db.ts schema (via CoreDb.migrate), gems.ts queries/logic, listings.ts CRUD. Faithful port: same SQL strings, same algorithms.
- [ ] **Step 5: Run tests → PASS; run `npx tsc --noEmit` + `npx biome check`; commit.**

---

### Task 2: PricingScraper

**Files:**
- Create: `backend/src/modules/pricing/scraper.ts`
- Test: `backend/tests/modules/pricing/scraper.test.ts`

**Interfaces:**
- Consumes: `PricingStore`.
- Produces: `class PricingScraper { constructor(store); async scrapeRemoved(): Promise<ScrapeResult> }` — ports `scraper.ts` (ETag via scrape_state, fetch removed_items.json, INSERT OR IGNORE, tryMatchListing) with `fetch` injected for testability.

- [ ] **Step 1: Write failing test** — inject a mock `fetch` returning a fixture payload; assert newItems/skipped counts and ETag storage; assert 304 short-circuit; assert tryMatchListing marks a listing confirmed_sold.
- [ ] **Step 2: Run → FAIL. Step 3: implement. Step 4: run → PASS. Step 5: gate + commit.**

---

### Task 3: Module routes + registration

**Files:**
- Create: `backend/src/modules/pricing/index.ts`
- Test: `backend/tests/modules/pricing/routes.test.ts`

**Interfaces:**
- Consumes: `PricingStore`, `PricingScraper`, `Module` type.
- Produces: `createPricingModule(store, scraper): Module` — 13 routes, factory pattern.

- [ ] **Step 1: Write failing routes test** — 401 no-token; 403 read-token on POST /listings; 200 read on GET /sales; 200 write-token on POST /listings; 403 non-admin on POST /scrape; OpenAPI coverage of `/api/modules/pricing/sales`.
- [ ] **Step 2: Run → FAIL. Step 3: implement (port index.ts routes, zod-openapi schemas). Step 4: run → PASS; full gate; commit.**

---

### Task 4: Wire entrypoint + SECURITY.md delta

**Files:**
- Modify: `backend/src/index.ts`, `backend/SECURITY.md`

- [ ] **Step 1: Register pricing module in index.ts** (eager; DB open failure = crash, unlike inventory's optional module — pricing is a core service).
- [ ] **Step 2: SECURITY.md delta** — pricing: scopes read/write/scrape, external fetch to shops.elanthia.online (public data, no creds), rate-limit note.
- [ ] **Step 3: Build + smoke test** — boot with fixture pricing DB; curl /status, /sales (200), /listings POST (201), /scrape (403 without scrape scope); verify 401/403 paths.
- [ ] **Step 4: security_review (full); fix findings; commit.**

---

### Task 5: (Follow-on, tracked here) Lich autoprice URL migration

**Files:**
- Modify (in GSIVDashboard repo, NOT GSIVPlatform): `lich/gs4sd_jar_seller_autoprice.lic`

- [ ] When pricing module is deployed: update autoprice's `UserVars.gs4sd_url`/endpoint path from `/api/gems/price-recommendation` and `/api/listings` to `/api/modules/pricing/...`, and retire the sales-tracker service (Caddy `@sales` block, `gs4-sales-backend.service`, port 3200).
- Note: this task lives in the v1 repo and is executed after the pricing module is verified in v2 — a deployment-phase task, listed here for tracking.

---

## Self-Review Notes

- **Faithful port:** same SQL and algorithms as sales-tracker — no behavior drift; only the route prefix, auth model, and module boundary change.
- **Scopes:** read vs write vs scrape enforced at request time by scopeGuard (inherits core fix); POST /listings requires pricing.write, POST /scrape requires pricing.scrape.
- **External fetch:** scraper hits a public JSON endpoint with ETag caching; no secrets; add a per-minute guard.
- **Schema ownership:** pricing uses CoreDb.migrate (namespaced), not the old sales.db — avoids coupling to the standalone service's file; data import is a separate follow-on.
