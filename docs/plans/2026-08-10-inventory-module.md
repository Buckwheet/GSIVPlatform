# Inventory Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v1 inventory feature (read-only SQLite over `inv.db3`) into GSIVPlatform as the first feature module, proving the core module contract end-to-end (registry, scopes, routeScopes, OpenAPI, scopeGuard, rate limit).

**Reference (read-only):** `D:\Code Projects\GSIVDashboard\backend\src\invdb.ts` (v1 implementation — 101 lines, 8 queries) and the production DB at `/opt/gs4sd/lich5/data/inv.db3` on the server. v2 opens the SAME DB file read-only — no data migration needed.

**Tech:** better-sqlite3 readonly, Hono + zod-openapi, vitest. Module factory pattern: `createInventoryModule(store)` so tests inject a fixture DB.

## Global Constraints (inherit from core plan)

- Every route declares a scope; `routeScopes` keys are `METHOD /path` with `:params`.
- All SQL prepared statements. Read-only DB open (`{ readonly: true }`).
- DB path via `INV_DB_PATH` env (default `/opt/gs4sd/lich5/data/inv.db3`); tests use a fixture DB.
- TDD per step: failing test → implement → passing test → commit.
- Gates: `npm test && npm run typecheck && npm run lint`; security review before merge (per SECURITY.md module gate).

---

### Task 1: Fixture DB helper + InventoryStore

**Files:**
- Create: `backend/tests/fixtures/inv-fixture.ts` (schema + seed), `backend/src/modules/inventory/store.ts`
- Test: `backend/tests/modules/inventory/store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InventoryStore` class — `constructor(dbPath: string)`, methods `summary()`, `characters()`, `locations()`, `bank()`, `search(q, char, loc)`, `resources()`, `tickets()`; throws `InventoryDbError` if the DB can't be opened.

- [ ] **Step 1: Write the fixture helper** (`tests/fixtures/inv-fixture.ts`)

Replicates the production schema (character, bank, silver, location, item, tickets, resource) + seeds: 2 characters (Fisternar/warrior/lvl100, Neleourg/cleric/lvl88), 2 banks, silvers, 4 locations (inv, worn, container, locker), 5 items, 1 ticket row, 1 resource row.

- [ ] **Step 2: Write the failing store test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { buildInvFixture } from "../../fixtures/inv-fixture.js";
import { InventoryStore } from "../../../src/modules/inventory/store.js";

describe("InventoryStore", () => {
  let db: Database.Database;
  let store: InventoryStore;

  beforeAll(() => { db = buildInvFixture(); store = new InventoryStore(":memory:"); });
  afterAll(() => db.close());

  it("summary counts characters, items, silvers", () => {
    const s = store.summary();
    expect(s.characters).toBe(2);
    expect(s.items).toBe(5);
    expect(s.totalSilver).toBeGreaterThan(0);
  });
  // ... characters(), locations(), bank(), resources(), tickets(), search(q,char,loc)
});
```

- [ ] **Step 3: Run test to verify it fails**
  `npx vitest run tests/modules/inventory/store.test.ts` → FAIL (module not found)

- [ ] **Step 4: Implement store.ts** (port the 8 v1 queries, injectable path)

```ts
import Database from "better-sqlite3";

const DEFAULT_PATH = process.env.INV_DB_PATH || "/opt/gs4sd/lich5/data/inv.db3";

export class InventoryDbError extends Error {}

export class InventoryStore {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_PATH) {
    try {
      this.db = new Database(dbPath, { readonly: true });
      this.db.pragma("journal_mode = WAL");
    } catch (err) {
      throw new InventoryDbError(`cannot open inventory DB at ${dbPath}: ${(err as Error).message}`);
    }
  }
  // summary(), characters(), locations(), bank(), search(), resources(), tickets()
  // — identical SQL to v1 invdb.ts, returning the same shapes.
}
```

- [ ] **Step 5: Run test to verify it passes; commit**

---

### Task 2: Module routes + registration

**Files:**
- Create: `backend/src/modules/inventory/index.ts`
- Test: `backend/tests/modules/inventory/routes.test.ts`

**Interfaces:**
- Consumes: `InventoryStore`, `Module` type, `createRoute`/`z`.
- Produces: `createInventoryModule(store): Module` with prefix `/api/modules/inventory`, scope `inventory.read`, 7 GET routes, `routeScopes` covering all 7.

- [ ] **Step 1: Write the failing route test**

Mounts `createInventoryModule(fixtureStore)` in a real `createApp` (like scope-guard.test.ts), then asserts:
- 401 without token
- 403 with token lacking `inventory.read`
- 200 + correct JSON shape with `admin:*` and with `inventory.read`
- OpenAPI `/api/spec` includes `/api/modules/inventory/summary`

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run tests/modules/inventory/routes.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement index.ts**

7 routes, each a zod-openapi `createRoute` with responses schema, registered via `router.openapi(...)`. Search route: `GET /search` with query params `q`, `character`, `location` (all optional strings).

- [ ] **Step 4: Run test to verify it passes; run full gate; commit**

---

### Task 3: Wire into entrypoint + SECURITY.md delta

**Files:**
- Modify: `backend/src/index.ts` (register inventory module), `backend/SECURITY.md` (module delta)

- [ ] **Step 1: Register the module in index.ts**

```ts
import { createInventoryModule } from "./modules/inventory/index.js";
import { InventoryStore } from "./modules/inventory/store.js";
// after healthModule:
const inventoryStore = new InventoryStore();
registry.register(createInventoryModule(inventoryStore));
```

Note: index.ts imports the module — if `inv.db3` is absent locally, the server still boots because the store opens lazily? **Decision:** open eagerly at boot; if missing, log a warning and skip registration (server stays up without inventory). Implement via try/catch around `new InventoryStore()`.

- [ ] **Step 2: Update SECURITY.md** — add "Inventory module: read-only SQLite, no writes, scope `inventory.read`, path via env (never hardcoded in commit)."

- [ ] **Step 3: Build + smoke test**

`npm run build`; boot with `INV_DB_PATH` pointing at a fixture DB file (create one via the fixture helper in a temp path, not committed):
- `GET /health` 200
- `GET /api/modules/inventory/summary` authed → counts
- `GET /api/modules/inventory/summary` no-auth → 401
- wrong-scope token → 403

- [ ] **Step 4: Run security_review (full); fix findings; commit**

---

## Self-Review Notes

- **Scope coverage:** all 7 routes have `routeScopes` entries → scopeGuard enforces at request time (inherits the core fix).
- **Read-only discipline:** `{ readonly: true }` on the DB open; no write queries ported.
- **Test isolation:** fixture DB built in-memory per test run; tests never touch the production DB path.
- **Lazy vs eager:** eager open at boot with graceful skip (documented above) — server availability must not depend on inv.db3 presence.
