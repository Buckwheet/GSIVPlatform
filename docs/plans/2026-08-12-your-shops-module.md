# Your Shops Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `your-shops` module to GSIVPlatform v2 that maps the user's shops (Erendiir, Boiler, Jinsem), tracks their sales from the pricing data, and alerts (bell + badge + toasts) when a new sale is detected — plus an hourly v2-native scan timer that replaces the retired v1 scraper.

**Architecture:** A new backend module (own sqlite store `data/yourshops.db`, reads pricing.db read-only via the shared pricing `CoreDb`) with routes under `/api/modules/your-shops`; an hourly systemd timer calls `POST /pricing/scrape` then `POST /your-shops/scan`; scan inserts notifications and emits a `sale_update` WS event (added to the backend ws-bridge whitelist); the frontend gets a page, a dashboard tile, and a header bell with badge + toasts.

**Tech Stack:** Node 20+ / TypeScript (ESM), `better-sqlite3`, Hono + `@hono/zod-openapi`, vitest, React 18 + Vite, systemd.

## Global Constraints

- **Spec:** `docs/design/2026-08-12-your-shops-module.md` (authoritative).
- **Repo edits via bash only** — the repo lives at `D:\Code Projects\GSIVPlatform`; file tools are confined to `C:\`. Never use edit_file/write_file on D: paths.
- **Gate before merge:** `cd backend && npm test && npm run typecheck && npm run lint` and `cd frontend && npm run build` — all must pass.
- **No Lich/game testing** in this feature; all verification is local tests + live API curls (safe).
- **Module prefix** `/api/modules/your-shops`; scopes `yourshops.read`, `yourshops.write`; nav `{ path: "/your-shops", title: "Your Shops", group: "market", order: 20, icon: "🏪" }`.
- **Server facts:** machine token `abdb3594-b6dd-4eef-89de-b083197f6798` (must gain `yourshops.read,yourshops.write` and verify `pricing.scrape`); admin token `415a689b-f097-4a0d-a8b7-6545afb84c83`; v2 backend on `:3102` at `ubuntu@51.68.235.144`; pricing db `/opt/gsiv-platform/backend/data/pricing.db`.
- **Seed shops:** Erendiir, Boiler, Jinsem.

---

## File Structure

- `backend/src/modules/your-shops/store.ts` — new: YourShopsStore (migrations, shops CRUD, scan/dedup, notifications, ack).
- `backend/src/modules/your-shops/index.ts` — new: module factory + routes + scopes + `sale_update` emit.
- `backend/tests/modules/your-shops/store.test.ts` — new: store unit tests.
- `backend/tests/modules/your-shops/routes.test.ts` — new: HTTP route tests (401/403/200).
- `backend/src/index.ts` — modify: register the module (after pricing registration).
- `backend/src/core/ws-bridge.ts` — modify: add `"sale_update"` to `EVENT_TYPES`.
- `backend/scripts/gen-frontend-manifest.ts` — modify: register factory (dummy deps).
- `frontend/src/generated/modules.json` — regenerate via `npm run gen:manifest`.
- `frontend/src/core/manifest.ts` — modify: add `your-shops` LOADER + NAV_COMPONENT.
- `frontend/src/pages/your-shops/index.tsx` — new: the page (stats, table, shop manager).
- `frontend/src/pages/dashboard/index.tsx` — modify: add a "Your Shops" tile.
- `frontend/src/shell/Bell.tsx` — new: bell + badge + dropdown + toasts.
- `frontend/src/shell/AppShell.tsx` — modify: render Bell in the topbar.
- `deploy/gsiv-sales-scan.sh`, `deploy/gsiv-sales-scan.service`, `deploy/gsiv-sales-scan.timer` — new: hourly scan.

---

## Task 1: YourShopsStore (scan, dedup, baseline, ack) — TDD

**Files:**
- Create: `backend/src/modules/your-shops/store.ts`
- Test: `backend/tests/modules/your-shops/store.test.ts`

**Interfaces:**
- Consumes: `CoreDb` (`backend/src/core/db.ts` — `migrate(module, sql[])`, `get()` → better-sqlite3 Database); pricing fixture `buildPricingFixture` (`backend/tests/fixtures/pricing-fixture.ts` — seeds Erendiir sales g1/g2/g3 + i1/i2 in other shops).
- Produces: `class YourShopsStore` with `seedDefaultIfEmpty()`, `listShops(): Shop[]`, `setShops(names: string[])`, `sales(pricingDb: CoreDb): Sale[]`, `scan(pricingDb: CoreDb): ScanResult`, `listNotifications(limit?): { total; unread; notifications }`, `ack(ids?: number[]): number`.

- [ ] **Step 1: Write the failing store test**

```ts
// backend/tests/modules/your-shops/store.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { YourShopsStore } from "../../../src/modules/your-shops/store.js";
import { buildPricingFixture } from "../../fixtures/pricing-fixture.js";

describe("YourShopsStore", () => {
  let own: CoreDb;
  let pricing: CoreDb;
  let store: YourShopsStore;

  beforeAll(() => {
    own = new CoreDb(":memory:");
    pricing = new CoreDb(":memory:");
    buildPricingFixture(pricing.get());
    store = new YourShopsStore(own);
    store.setShops(["Erendiir"]);
  });
  afterAll(() => {
    own.close();
    pricing.close();
  });

  it("lists configured shops", () => {
    expect(store.listShops().map((s) => s.name)).toEqual(["Erendiir"]);
  });

  it("first scan baselines history without notifying", () => {
    const res = store.scan(pricing);
    expect(res.new).toBe(0);
    expect(res.baselined).toBe(3); // g1, g2, g3 are Erendiir in the fixture
    expect(store.listNotifications().unread).toBe(0);
  });

  it("second scan notifies only on a new sale for a tracked shop", () => {
    store.scan(pricing);
    pricing.get().prepare(
      `INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
       VALUES ('g4', 'a jar containing uncut emeralds', "Ta'Vaalor", 'Erendiir', 24000, NULL, NULL, NULL, 'glass', 'jar', 0, 0, 0, '[]', '2026-07-26T00:00:00.000Z', '2026-07-26T01:00:00.000Z')`,
    ).run();
    const res = store.scan(pricing);
    expect(res.new).toBe(1);
    const notif = store.listNotifications();
    expect(notif.unread).toBe(1);
    expect(notif.notifications[0].item_id).toBe("g4");
  });

  it("does not re-alert the same item on a third scan", () => {
    expect(store.scan(pricing).new).toBe(0);
  });

  it("ack clears unread", () => {
    expect(store.ack()).toBe(1);
    expect(store.listNotifications().unread).toBe(0);
  });

  it("sales() returns only tracked-shop rows, newest first", () => {
    const sales = store.sales(pricing);
    expect(sales.every((s) => s.shop === "Erendiir")).toBe(true);
    expect(sales[0].removed_date >= sales[sales.length - 1].removed_date).toBe(true);
  });

  it("adding a new shop baselines its history without notifying", () => {
    store.setShops(["Erendiir", "Some Shop"]);
    const res = store.scan(pricing);
    expect(res.new).toBe(0); // "Some Shop" i1 baselined, Erendiir already seen
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `cd backend && npx vitest run tests/modules/your-shops/store.test.ts`
Expected: FAIL — import error (`Cannot find module ... your-shops/store.js`).

- [ ] **Step 3: Implement the store**

```ts
// backend/src/modules/your-shops/store.ts
import type { CoreDb } from "../../core/db.js";

export interface Shop {
  id: number;
  name: string;
  town: string | null;
  created_at: string;
}

export interface Sale {
  item_id: string;
  name: string;
  town: string;
  shop: string;
  cost: number | null;
  removed_date: string;
}

export interface Notification {
  id: number;
  item_id: string;
  shop: string;
  name: string;
  cost: number | null;
  removed_date: string;
  created_at: string;
  acknowledged_at: string | null;
}

export interface ScanResult {
  new: number;
  baselined: number;
  notifications: Notification[];
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    town TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS seen (
    item_id TEXT PRIMARY KEY,
    shop TEXT NOT NULL,
    removed_date TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    shop TEXT NOT NULL,
    name TEXT NOT NULL,
    cost INTEGER,
    removed_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT
  )`,
];

const DEFAULT_SHOPS = ["Erendiir", "Boiler", "Jinsem"] as const;

export class YourShopsStore {
  constructor(private db: CoreDb) {
    this.db.migrate("your-shops", MIGRATIONS);
  }

  seedDefaultIfEmpty(): void {
    const row = this.db.get().prepare("SELECT COUNT(*) AS n FROM shops").get() as { n: number };
    if (row.n > 0) return;
    const ins = this.db.get().prepare("INSERT INTO shops (name, town, created_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    for (const name of DEFAULT_SHOPS) ins.run(name, null, now);
  }

  listShops(): Shop[] {
    return this.db.get().prepare("SELECT id, name, town, created_at FROM shops ORDER BY name").all() as Shop[];
  }

  /** Replace the shop list (names only; towns are informational). */
  setShops(names: string[]): void {
    const txn = this.db.get().transaction(() => {
      this.db.get().prepare("DELETE FROM shops").run();
      const ins = this.db.get().prepare("INSERT INTO shops (name, town, created_at) VALUES (?, NULL, ?)");
      const now = new Date().toISOString();
      for (const name of names) ins.run(name, now);
    });
    txn();
  }

  /** All sales for the configured shops, newest first (read-only on pricing.db). */
  sales(pricingDb: CoreDb): Sale[] {
    const shops = this.listShops().map((s) => s.name);
    if (shops.length === 0) return [];
    const q = `SELECT item_id, name, town, shop, cost, removed_date FROM sales
               WHERE shop IN (${shops.map(() => "?").join(",")}) ORDER BY removed_date DESC`;
    return pricingDb.get().prepare(q).all(...shops) as Sale[];
  }

  /**
   * Scan pricing for new sales of the configured shops. Per-shop baseline:
   * a shop with no `seen` rows yet baselines its whole history without
   * alerting (covers first run AND later shop additions). Every later new
   * item_id for a baselined shop becomes a notification (once, dedup by
   * item_id).
   */
  scan(pricingDb: CoreDb): ScanResult {
    const shops = this.listShops().map((s) => s.name);
    if (shops.length === 0) return { new: 0, baselined: 0, notifications: [] };
    const rows = this.sales(pricingDb);
    const seenCounts = new Map<string, number>();
    for (const r of this.db.get().prepare("SELECT shop, COUNT(*) AS n FROM seen GROUP BY shop").all() as { shop: string; n: number }[]) {
      seenCounts.set(r.shop, r.n);
    }
    const notifications: Notification[] = [];
    let baselined = 0;
    const now = new Date().toISOString();
    const txn = this.db.get().transaction(() => {
      const insSeen = this.db.get().prepare("INSERT OR IGNORE INTO seen (item_id, shop, removed_date) VALUES (?, ?, ?)");
      const insNotif = this.db.get().prepare(
        "INSERT OR IGNORE INTO notifications (item_id, shop, name, cost, removed_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const r of rows) {
        const res = insSeen.run(r.item_id, r.shop, r.removed_date);
        if (res.changes === 0) continue; // already accounted for
        if ((seenCounts.get(r.shop) ?? 0) === 0) {
          baselined += 1; // first sighting of this shop: mark history seen, no alert
          continue;
        }
        const id = Number(insNotif.run(r.item_id, r.shop, r.name, r.cost, r.removed_date, now).lastInsertRowid);
        if (id > 0) {
          notifications.push({ id, item_id: r.item_id, shop: r.shop, name: r.name, cost: r.cost, removed_date: r.removed_date, created_at: now, acknowledged_at: null });
        }
      }
    });
    txn();
    return { new: notifications.length, baselined, notifications };
  }

  listNotifications(limit = 50): { total: number; unread: number; notifications: Notification[] } {
    const total = (this.db.get().prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n;
    const unread = (this.db.get().prepare("SELECT COUNT(*) AS n FROM notifications WHERE acknowledged_at IS NULL").get() as { n: number }).n;
    const notifications = this.db
      .get()
      .prepare("SELECT id, item_id, shop, name, cost, removed_date, created_at, acknowledged_at FROM notifications ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Notification[];
    return { total, unread, notifications };
  }

  /** Ack all unread (ids empty) or the given ids. Returns rows acked. */
  ack(ids?: number[]): number {
    const txn = this.db.get().transaction(() => {
      if (ids && ids.length > 0) {
        const stmt = this.db
          .get()
          .prepare(`UPDATE notifications SET acknowledged_at = ? WHERE acknowledged_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`);
        return Number(stmt.run(new Date().toISOString(), ...ids).changes);
      }
      const stmt = this.db.get().prepare("UPDATE notifications SET acknowledged_at = ? WHERE acknowledged_at IS NULL");
      return Number(stmt.run(new Date().toISOString()).changes);
    });
    return txn();
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd backend && npx vitest run tests/modules/your-shops/store.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/your-shops/store.ts backend/tests/modules/your-shops/store.test.ts
git commit -m "feat(your-shops): store — shops/seen/notifications, scan with per-shop baseline, ack"
```

---

## Task 2: your-shops module routes (index.ts) — TDD

**Files:**
- Create: `backend/src/modules/your-shops/index.ts`
- Test: `backend/tests/modules/your-shops/routes.test.ts`

**Interfaces:**
- Consumes: `YourShopsStore` (Task 1), `CoreDb`, `buildPricingFixture`.
- Produces: `createYourShopsModule(store: YourShopsStore, pricingDb: CoreDb): Module` — name `your-shops`, prefix `/api/modules/your-shops`, scopes `yourshops.read`/`yourshops.write`, nav as in Global Constraints; emits `sale_update` via `deps.eventBus` on scan when `new > 0`.

- [ ] **Step 1: Write the failing routes test**

```ts
// backend/tests/modules/your-shops/routes.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createYourShopsModule } from "../../../src/modules/your-shops/index.js";
import { YourShopsStore } from "../../../src/modules/your-shops/store.js";
import { buildPricingFixture } from "../../fixtures/pricing-fixture.js";

describe("your-shops module routes", () => {
  let own: CoreDb;
  let pricing: CoreDb;

  beforeAll(() => {
    own = new CoreDb(":memory:");
    pricing = new CoreDb(":memory:");
    buildPricingFixture(pricing.get());
  });
  afterAll(() => {
    own.close();
    pricing.close();
  });

  function makeApp(tokensEnv: string, seedShops = true) {
    const store = new YourShopsStore(own);
    if (seedShops) store.setShops(["Erendiir"]);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createYourShopsModule(store, pricing));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db: own, auth, eventBus: new EventBus() });
  }

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/your-shops/sales");
    expect(res.status).toBe(401);
  });

  it("denies read routes without yourshops.read (403)", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/your-shops/sales", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });

  it("GET /sales returns only tracked-shop rows for a yourshops.read token", async () => {
    const app = makeApp("limited:tok:yourshops.read");
    const res = await app.request("/api/modules/your-shops/sales", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; sales: { shop: string }[] };
    expect(body.sales.length).toBe(3);
    expect(body.sales.every((s) => s.shop === "Erendiir")).toBe(true);
  });

  it("denies PUT /shops without yourshops.write (403)", async () => {
    const app = makeApp("limited:tok:yourshops.read");
    const res = await app.request("/api/modules/your-shops/shops", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["Erendiir", "Boiler"] }),
    });
    expect(res.status).toBe(403);
  });

  it("PUT /shops replaces the list", async () => {
    const app = makeApp("admin:tok:*");
    await app.request("/api/modules/your-shops/shops", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["Boiler", "Jinsem"] }),
    });
    const list = await app.request("/api/modules/your-shops/shops", { headers: { Authorization: "Bearer tok" } });
    const shops = (await list.json()) as { name: string }[];
    expect(shops.map((s) => s.name).sort()).toEqual(["Boiler", "Jinsem"]);
  });

  it("POST /scan baselines then notifies; GET /notifications + ack roundtrip", async () => {
    const app = makeApp("admin:tok:*", false);
    const h = { Authorization: "Bearer tok" };
    await app.request("/api/modules/your-shops/shops", {
      method: "PUT",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["Erendiir"] }),
    });
    const scan1 = await app.request("/api/modules/your-shops/scan", { method: "POST", headers: h });
    expect(await scan1.json()).toMatchObject({ new: 0, baselined: 3 });
    pricing.get().prepare(
      `INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
       VALUES ('g9', 'a jar containing uncut emeralds', "Ta'Vaalor", 'Erendiir', 32000, NULL, NULL, NULL, 'glass', 'jar', 0, 0, 0, '[]', '2026-07-27T00:00:00.000Z', '2026-07-27T01:00:00.000Z')`,
    ).run();
    const scan2 = await app.request("/api/modules/your-shops/scan", { method: "POST", headers: h });
    expect(await scan2.json()).toMatchObject({ new: 1 });
    const n = await app.request("/api/modules/your-shops/notifications", { headers: h });
    expect(((await n.json()) as { unread: number }).unread).toBe(1);
    const ack = await app.request("/api/modules/your-shops/notifications/ack", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(await ack.json()).toMatchObject({ ok: true, acked: 1 });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd backend && npx vitest run tests/modules/your-shops/routes.test.ts`
Expected: FAIL — `Cannot find module .../your-shops/index.js`.

- [ ] **Step 3: Implement the module**

```ts
// backend/src/modules/your-shops/index.ts
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { CoreDb } from "../../core/db.js";
import type { YourShopsStore } from "./store.js";

const shopSchema = z.object({ id: z.number(), name: z.string(), town: z.string().nullable(), created_at: z.string() });
const saleSchema = z.object({
  item_id: z.string(), name: z.string(), town: z.string(), shop: z.string(),
  cost: z.number().nullable(), removed_date: z.string(),
});
const notifSchema = z.object({
  id: z.number(), item_id: z.string(), shop: z.string(), name: z.string(),
  cost: z.number().nullable(), removed_date: z.string(), created_at: z.string(), acknowledged_at: z.string().nullable(),
});

const listShopsRoute = createRoute({
  method: "get", path: "/shops",
  responses: { 200: { content: { "application/json": { schema: z.array(shopSchema) } }, description: "configured shops" } },
});
const setShopsRoute = createRoute({
  method: "put", path: "/shops",
  request: { body: { content: { "application/json": { schema: z.object({ names: z.array(z.string().min(1)) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "ok" } },
});
const salesRoute = createRoute({
  method: "get", path: "/sales",
  responses: { 200: { content: { "application/json": { schema: z.object({ total: z.number(), sales: z.array(saleSchema) }) } }, description: "tracked-shop sales" } },
});
const notificationsRoute = createRoute({
  method: "get", path: "/notifications",
  responses: { 200: { content: { "application/json": { schema: z.object({ total: z.number(), unread: z.number(), notifications: z.array(notifSchema) }) } }, description: "notifications" } },
});
const ackRoute = createRoute({
  method: "post", path: "/notifications/ack",
  request: { body: { content: { "application/json": { schema: z.object({ ids: z.array(z.number()).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), acked: z.number() }) } }, description: "ok" } },
});
const scanRoute = createRoute({
  method: "post", path: "/scan",
  responses: { 200: { content: { "application/json": { schema: z.object({ new: z.number(), baselined: z.number() }) } }, description: "scan result" } },
});

export function createYourShopsModule(store: YourShopsStore, pricingDb: CoreDb): Module {
  return {
    name: "your-shops",
    prefix: "/api/modules/your-shops",
    scopes: [
      { name: "yourshops.read", description: "Read your shops, sales, notifications" },
      { name: "yourshops.write", description: "Manage shops, ack notifications, run scan" },
    ],
    routeScopes: {
      "GET /shops": ["yourshops.read"],
      "PUT /shops": ["yourshops.write"],
      "GET /sales": ["yourshops.read"],
      "GET /notifications": ["yourshops.read"],
      "POST /notifications/ack": ["yourshops.write"],
      "POST /scan": ["yourshops.write"],
    },
    nav: { path: "/your-shops", title: "Your Shops", group: "market", order: 20, icon: "🏪" },
    registerRoutes(router: OpenAPIHono, deps: unknown): void {
      const eventBus = (deps as { eventBus: { emit(type: string, payload: unknown): void } }).eventBus;
      router.openapi(listShopsRoute, (c) => c.json(store.listShops()));
      router.openapi(setShopsRoute, (c) => {
        const { names } = c.req.valid("json");
        store.setShops([...new Set(names.map((n) => n.trim()).filter(Boolean))]);
        return c.json({ ok: true });
      });
      router.openapi(salesRoute, (c) => {
        const sales = store.sales(pricingDb);
        return c.json({ total: sales.length, sales });
      });
      router.openapi(notificationsRoute, (c) => c.json(store.listNotifications()));
      router.openapi(ackRoute, (c) => {
        const { ids } = c.req.valid("json");
        return c.json({ ok: true, acked: store.ack(ids) });
      });
      router.openapi(scanRoute, (c) => {
        const res = store.scan(pricingDb);
        if (res.new > 0) eventBus.emit("sale_update", { count: res.new });
        return c.json({ new: res.new, baselined: res.baselined });
      });
    },
  };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd backend && npx vitest run tests/modules/your-shops/routes.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/your-shops/index.ts backend/tests/modules/your-shops/routes.test.ts
git commit -m "feat(your-shops): module routes — shops/sales/notifications/ack/scan + sale_update WS emit"
```

---

## Task 3: Register the module + WS whitelist + regenerate manifest

**Files:**
- Modify: `backend/src/index.ts` (register after the pricing block, lines ~56-61)
- Modify: `backend/src/core/ws-bridge.ts` (`EVENT_TYPES` array, lines ~21-28)
- Modify: `backend/scripts/gen-frontend-manifest.ts` (import + register)
- Regenerate: `frontend/src/generated/modules.json`

- [ ] **Step 1: Register in backend/src/index.ts**

Add imports near the pricing imports:
```ts
import { createYourShopsModule } from "./modules/your-shops/index.js";
import { YourShopsStore } from "./modules/your-shops/store.js";
```
Insert right after `registry.register(createPricingModule(pricingStore, pricingScraper));`:
```ts
// Your Shops: user's shop sales + alerts; reads pricing.db read-only.
const yourShopsDb = new CoreDb(process.env.YOURSHOPS_DB_PATH || "data/yourshops.db");
const yourShopsStore = new YourShopsStore(yourShopsDb);
yourShopsStore.seedDefaultIfEmpty();
registry.register(createYourShopsModule(yourShopsStore, pricingDb));
```

- [ ] **Step 2: Whitelist the WS event**

In `backend/src/core/ws-bridge.ts`, extend the const array:
```ts
const EVENT_TYPES = [
  "jars_update",
  "jars_claimed",
  "queue_update",
  "healer_update",
  "heal_request",
  "heal_accepted",
  "heal_complete",
  "sale_update",
] as const;
```

- [ ] **Step 3: Add to the manifest generator**

In `backend/scripts/gen-frontend-manifest.ts`, add the import and registration (dummy deps, matching the file's pattern):
```ts
import { createYourShopsModule } from "../src/modules/your-shops/index.js";
// ...
registry.register(createYourShopsModule(undefined as never, undefined as never));
```

- [ ] **Step 4: Regenerate + verify the manifest**

Run: `cd backend && npm run gen:manifest`
Expected: `wrote .../frontend/src/generated/modules.json (... nav items, ... scopes)` — nav item count +1; the file now contains a `your-shops` nav item (`"path": "/your-shops"`, group `market`) and scopes `yourshops.read`/`yourshops.write`.

- [ ] **Step 5: Verify the whole backend still boots + tests pass**

Run: `cd backend && npm test && npm run typecheck`
Expected: all pass (previous suite + the 15 new your-shops tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts backend/src/core/ws-bridge.ts backend/scripts/gen-frontend-manifest.ts frontend/src/generated/modules.json
git commit -m "feat(your-shops): register module, whitelist sale_update WS event, regenerate manifest"
```

---

## Task 4: Frontend page (`/your-shops`)

**Files:**
- Create: `frontend/src/pages/your-shops/index.tsx`
- Modify: `frontend/src/core/manifest.ts` (LOADERS + NAV_COMPONENTS entries)

**Interfaces:**
- Consumes: `api` (`frontend/src/core/api.ts`), `can`/`AuthState` (`frontend/src/core/auth`), `Table`/`Button`/`useToast` (`frontend/src/components`). Backend: `GET /your-shops/sales` → `{ total, sales }`; `GET/PUT /your-shops/shops`; `GET /your-shops/notifications` → `{total,unread,notifications}`; `POST /your-shops/notifications/ack`.

- [ ] **Step 1: Add the loader to core/manifest.ts**

Add to `LOADERS` (after the `analysis` line):
```ts
  "your-shops": () => import("../pages/your-shops"),
```
and to `NAV_COMPONENTS` (after the `analysis` line):
```ts
  "your-shops": lazy(LOADERS["your-shops"]),
```

- [ ] **Step 2: Write the page**

```tsx
// frontend/src/pages/your-shops/index.tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Button, Table, useToast } from "../../components";

interface Sale {
  item_id: string;
  name: string;
  town: string;
  shop: string;
  cost: number | null;
  removed_date: string;
}
interface SalesResponse {
  total: number;
  sales: Sale[];
}
interface Shop {
  id: number;
  name: string;
  town: string | null;
  created_at: string;
}

function fmtCost(cost: number | null): string {
  return typeof cost === "number" ? cost.toLocaleString() : "";
}
function daysAgo(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export default function YourShops({ auth }: { auth: AuthState }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [newShops, setNewShops] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
  const canWrite = can(auth, ["yourshops.write"]);

  async function load() {
    try {
      const [sh, sa] = await Promise.all([
        api<Shop[]>("/modules/your-shops/shops", auth),
        api<SalesResponse>("/modules/your-shops/sales", auth),
      ]);
      setShops(sh);
      setSales(sa.sales);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const stats = useMemo(() => {
    const today = daysAgo(0);
    const week = daysAgo(7);
    const by = (from: number) => sales.filter((s) => new Date(s.removed_date).getTime() >= from);
    const sum = (rows: Sale[]) => rows.reduce((n, r) => n + (r.cost ?? 0), 0);
    return {
      today: { n: by(today).length, revenue: sum(by(today)) },
      week: { n: by(week).length, revenue: sum(by(week)) },
      all: { n: sales.length, revenue: sum(sales) },
    };
  }, [sales]);

  async function saveShops() {
    const names = newShops.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    try {
      await api("/modules/your-shops/shops", auth, { method: "PUT", body: JSON.stringify({ names }) });
      setNewShops("");
      addToast({ tone: "good", title: "Shops updated", message: `${names.length} shop${names.length === 1 ? "" : "s"} tracked.` });
      await load();
    } catch (err) {
      addToast({ tone: "bad", title: "Update failed", message: (err as Error).message });
    }
  }

  const columns = [
    { key: "name", header: "Item" },
    { key: "shop", header: "Shop" },
    { key: "town", header: "Town" },
    {
      key: "cost",
      header: "Price",
      align: "right" as const,
      render: (r: Sale) => fmtCost(r.cost),
    },
    { key: "removed_date", header: "Date", render: (r: Sale) => new Date(r.removed_date).toLocaleString() },
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header-title">Your Shops</h1>
          <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
            Sales from your shops: {shops.map((s) => s.name).join(", ") || "none configured"}.
          </p>
        </div>
        {canWrite && (
          <div className="page-header-actions">
            <input
              value={newShops}
              onChange={(e) => setNewShops(e.target.value)}
              placeholder="Add shops, comma-separated"
              aria-label="Shop names"
              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}
            />
            <Button onClick={saveShops} disabled={!newShops.trim()} ariaLabel="Save Shops">
              Save shops
            </Button>
          </div>
        )}
      </header>

      <div className="tile-grid" style={{ marginBottom: "var(--space-4)" }}>
        <div className="card"><div className="card-title">Today</div><div className="tile-value">{stats.today.n} sales · {fmtCost(stats.today.revenue)}</div></div>
        <div className="card"><div className="card-title">Last 7 days</div><div className="tile-value">{stats.week.n} sales · {fmtCost(stats.week.revenue)}</div></div>
        <div className="card"><div className="card-title">All time</div><div className="tile-value">{stats.all.n} sales · {fmtCost(stats.all.revenue)}</div></div>
      </div>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={sales}
        rowKey={(r) => r.item_id}
        ariaLabel="Sales from your shops"
        emptyState="No sales tracked yet."
        loading={loading}
      />
    </div>
  );
}
```

Note: `Table` supports `align`/`render` on columns (see `frontend/src/pages/pricing/index.tsx` + `frontend/src/components/Table.tsx`); if the `Table` column type differs, match it.

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: clean; a `your-shops-*.js` lazy chunk appears in `frontend/dist/assets/`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/your-shops/index.tsx frontend/src/core/manifest.ts
git commit -m "feat(frontend): your-shops page — stats, sales table, shop manager"
```

---

## Task 5: Dashboard tile

**Files:**
- Modify: `frontend/src/pages/dashboard/index.tsx` (TILES array)

- [ ] **Step 1: Add the tile**

In the `TILES` array (after the `accounts` entry), add:
```ts
  {
    id: "your-shops",
    title: "Your Shops",
    icon: "🏪",
    path: "/your-shops",
    scope: "yourshops.read",
    fetch: async (a) => {
      const res = await api<{ total: number; sales: { removed_date: string; cost: number | null }[] }>("/modules/your-shops/sales", a);
      const weekAgo = Date.now() - 7 * 86400_000;
      const week = res.sales.filter((s) => new Date(s.removed_date).getTime() >= weekAgo);
      const revenue = week.reduce((n, s) => n + (s.cost ?? 0), 0);
      return `${week.length} sales · ${revenue.toLocaleString()} this week`;
    },
  },
```

- [ ] **Step 2: Build + verify**

Run: `cd frontend && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/dashboard/index.tsx
git commit -m "feat(frontend): your-shops dashboard tile"
```

---

## Task 6: Header bell + toasts

**Files:**
- Create: `frontend/src/shell/Bell.tsx`
- Modify: `frontend/src/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `api`, `onWs` (`frontend/src/core/ws.ts`), `useToast`, `can`.
- Produces: `<Bell auth={auth} />` — badge = unread count; poll `GET /your-shops/notifications` every 60s and on each `sale_update` WS event; dropdown panel of latest notifications; "Mark all read" → `POST /your-shops/notifications/ack`; toast per incoming `sale_update`.

- [ ] **Step 1: Write the Bell component**

```tsx
// frontend/src/shell/Bell.tsx
import { useEffect, useState } from "react";
import { api } from "../core/api";
import { onWs } from "../core/ws";
import { can, type AuthState } from "../core/auth";
import { Button, useToast } from "../components";

interface Notification {
  id: number;
  shop: string;
  name: string;
  cost: number | null;
  removed_date: string;
}
interface NotifResponse {
  total: number;
  unread: number;
  notifications: Notification[];
}

export function Bell({ auth }: { auth: AuthState }) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const { addToast } = useToast();

  async function refresh() {
    try {
      const res = await api<NotifResponse>("/modules/your-shops/notifications", auth);
      setUnread(res.unread);
      setItems(res.notifications.slice(0, 20));
    } catch {
      // bell silently degrades if the module is unreachable
    }
  }

  useEffect(() => {
    if (!can(auth, ["yourshops.read"])) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    return onWs((e) => {
      if (e.type !== "sale_update") return;
      const count = (e.payload as { count?: number })?.count ?? 1;
      addToast({ tone: "good", title: "🏪 New sale", message: `${count} item${count === 1 ? "" : "s"} sold from your shops` });
      void refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  if (!can(auth, ["yourshops.read"])) return null;

  async function markAllRead() {
    try {
      await api("/modules/your-shops/notifications/ack", auth, { method: "POST", body: "{}" });
      setUnread(0);
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        ariaLabel={unread > 0 ? `Notifications: ${unread} unread` : "Notifications"}
        ariaPressed={open}
      >
        🔔{unread > 0 ? ` ${unread}` : ""}
      </Button>
      {open && (
        <div
          style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", width: 320, maxHeight: 420,
            overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)", zIndex: 50, padding: "var(--space-2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
            <strong>Sales</strong>
            {unread > 0 && <Button variant="ghost" size="sm" onClick={markAllRead} ariaLabel="Mark all read">Mark all read</Button>}
          </div>
          {items.length === 0 && <div className="muted" style={{ padding: "var(--space-2)" }}>No sales yet.</div>}
          {items.map((n) => (
            <div key={n.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}>
              <div>{n.name}</div>
              <div className="muted">{n.shop} · {typeof n.cost === "number" ? n.cost.toLocaleString() : "—"} · {new Date(n.removed_date).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the Bell in the topbar**

In `frontend/src/shell/AppShell.tsx`, add the import and render it in `.topbar-right` before the density button:
```tsx
import { Bell } from "./Bell";
// ...
<span className="topbar-right">
  <Bell auth={auth} />
  <span className="muted" style={{ fontSize: "var(--font-size-sm)" }}>{auth.name}</span>
```

- [ ] **Step 3: Build + verify**

Run: `cd frontend && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shell/Bell.tsx frontend/src/shell/AppShell.tsx
git commit -m "feat(frontend): header bell — sale alerts, unread badge, toasts"
```

---

## Task 7: Full gate + push

- [ ] **Step 1: Run the full gate**

Run: `cd backend && npm test && npm run typecheck && npm run lint && cd ../frontend && npm run build`
Expected: all green.

- [ ] **Step 2: Commit any leftovers**

```bash
git add -A && git status
```
Commit only intended changes; add a follow-up commit if anything is left.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Task 8: Deploy to prod (server changes)

**Files:**
- Create in repo: `deploy/gsiv-sales-scan.sh`, `deploy/gsiv-sales-scan.service`, `deploy/gsiv-sales-scan.timer`

**Server:** `ubuntu@51.68.235.144`. All commands via ssh. Machine token `abdb3594-b6dd-4eef-89de-b083197f6798`.

- [ ] **Step 1: Commit deploy assets**

```bash
# deploy/gsiv-sales-scan.sh
#!/usr/bin/env bash
# Hourly: refresh v2 pricing data, then scan the user's shops for new sales.
set -euo pipefail
TOKEN="${GS4SD_TOKEN:?GS4SD_TOKEN (machine token) is required}"
BASE="${GSIV_API:-http://localhost:3102}"
curl -fsS -X POST "$BASE/api/modules/pricing/scrape" -H "Authorization: Bearer $TOKEN" >/dev/null
curl -fsS -X POST "$BASE/api/modules/your-shops/scan" -H "Authorization: Bearer $TOKEN"
```
```ini
# deploy/gsiv-sales-scan.service
[Unit]
Description=GSIV v2 Sales Scan (pricing scrape + your-shops scan)
After=network-online.target gsiv-platform.service
Wants=gsiv-platform.service

[Service]
Type=oneshot
User=ubuntu
# Token lives on the server (not in git): /etc/gsiv-sales-scan.env (0600), GS4SD_TOKEN=...
EnvironmentFile=/etc/gsiv-sales-scan.env
ExecStart=/opt/gsiv-platform/scripts/gsiv-sales-scan.sh
```
```ini
# deploy/gsiv-sales-scan.timer
[Unit]
Description=Hourly GSIV v2 sales scan

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Update the machine token scopes + restart backend**

On the server: edit `/opt/gsiv-platform/backend/.env` — add `yourshops.read,yourshops.write` to the machine token's `AUTH_TOKENS` entry (and confirm `pricing.scrape` is present). Backup first (`sudo cp .env .env.bak-2026-08-12`). Then `sudo systemctl restart gsiv-platform` and verify `curl localhost:3102/api/modules/your-shops/sales -H "Authorization: Bearer $ADMIN"` returns 200 with `total >= 273`.

- [ ] **Step 3: Install the scan units + script**

```bash
sudo mkdir -p /opt/gsiv-platform/scripts
sudo cp deploy/gsiv-sales-scan.sh /opt/gsiv-platform/scripts/ && sudo chmod +x /opt/gsiv-platform/scripts/gsiv-sales-scan.sh
sudo cp deploy/gsiv-sales-scan.service /etc/systemd/system/ && sudo cp deploy/gsiv-sales-scan.timer /etc/systemd/system/
# Token is a server-side secret, not in git (0600, root-owned)
echo 'GS4SD_TOKEN=abdb3594-b6dd-4eef-89de-b083197f6798' | sudo tee /etc/gsiv-sales-scan.env >/dev/null
sudo chmod 600 /etc/gsiv-sales-scan.env
sudo systemctl daemon-reload
sudo systemctl enable --now gsiv-sales-scan.timer
```
Verify: `systemctl list-timers gsiv-sales-scan.timer --no-pager`.

- [ ] **Step 4: Disable the v1 scraper**

```bash
sudo systemctl disable --now gs4-sales-scraper.timer
systemctl is-enabled gs4-sales-scraper.timer   # expect "disabled"
```

- [ ] **Step 5: Run one manual scan + verify end-to-end**

```bash
sudo systemctl start gsiv-sales-scan.service
journalctl -u gsiv-sales-scan.service -n 10 --no-pager
curl -s localhost:3102/api/modules/your-shops/notifications -H "Authorization: Bearer $ADMIN"
```
Expected: scan service finishes clean; notifications returns `{"total":0,"unread":0,...}` (first scan baselined history — no alert spam); pricing `GET /status` shows a fresh `last_scraped_at`. Confirm the live site: `https://gsiv.phylactery.ovh/your-shops` loads (200).

- [ ] **Step 6: Verify streams still healthy (regression)**

```bash
curl -s localhost:3102/api/modules/gameview/streams -H "Authorization: Bearer $ADMIN"   # both up:true
curl -s -o /dev/null -w '%{http_code}\n' https://fisternar.phylactery.ovh/play          # 200
```

- [ ] **Step 7: Commit deploy assets + update docs**

```bash
git add deploy/gsiv-sales-scan.sh deploy/gsiv-sales-scan.service deploy/gsiv-sales-scan.timer
git commit -m "feat(deploy): hourly gsiv-sales-scan timer (pricing scrape + your-shops scan); retire v1 scraper"
git push origin main
```
Then update `docs/STATUS.md` §7 (Remaining list + a Done-since bullet) and `deploy/V2-DEPLOYMENT.md` (sales-scan units + v1 scraper retirement) and commit those doc updates.

---

## Self-Review Checklist (run after writing)

1. Spec coverage: §3 pipeline (Task 8), §4 module/endpoints/scan (Tasks 1-3), §4.4 WS (Tasks 2-3 + 6), §5 page/tile/bell (Tasks 4-6), §8 tests/gate/deploy (Tasks 3/7/8).
2. Placeholder scan: every code step shows complete code; no TBD.
3. Type consistency: `YourShopsStore` method names/signatures in `index.ts` and tests match Task 1; `sale_update` event name consistent across ws-bridge, module, Bell; `api()` paths `/modules/your-shops/...` consistent.
