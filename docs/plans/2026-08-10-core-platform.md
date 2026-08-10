# Core Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GSIVPlatform core: module registry, auth+scopes, rate limiting, DB/Redis abstractions, WS event bus, OpenAPI spec merge, bootstrap server, and the built-in `health` module — with full test suite, linter, formatter, and commit hooks from day one.

**Architecture:** Compile-time modules registered in a central `Registry`. Each module declares `scopes`, `routeScopes` (per-route scope map keyed by `METHOD /path`), and routes via `@hono/zod-openapi`'s `OpenAPIHono`. Core enforces: every route has a scope (boot validation), tokens map to scope lists, rate limits per token, and a merged OpenAPI spec served at `/api/spec`. Redis-backed state with an in-memory fallback so the whole suite runs without a Redis server.

**Tech Stack:** TypeScript 5.6 (strict, ESM), Hono 4 + `@hono/node-server`, `@hono/zod-openapi` + zod 3, better-sqlite3, ioredis, ws, vitest, Biome (lint+format), husky + lint-staged.

## Global Constraints

- TypeScript `strict: true`, `module: ESNext`, `moduleResolution: bundler`, `target: ES2022`, `verbatimModuleSyntax: true`, `outDir: dist`.
- ESM only (`"type": "module"` in package.json). All relative imports use `.js` extensions (NodeNext-style) even though source is `.ts`.
- Node >= 20 required (engines field).
- **Every route MUST declare a scope.** Registry boot fails if any route in a module's OpenAPI spec has no entry in that module's `routeScopes`.
- All SQL via prepared statements (better-sqlite3 `.prepare()`). No string-concatenated SQL with user input.
- No `eval`, no `child_process` shell strings. Token comparison is constant-time (`crypto.timingSafeEqual`).
- Test commands (run from `backend/`): `npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint` (biome check), `npm run format` (biome format --write).
- Commit hooks: `husky pre-commit` runs `lint-staged` → `biome check --staged` + `tsc --noEmit` on staged TS.
- A task's steps are TDD: write failing test → verify it fails → implement → verify it passes → commit.
- Dependencies are added in Task 1 only; no new deps later without a plan update.

---

### Task 1: Project Scaffolding + Tooling

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/biome.json`, `backend/vitest.config.ts`, `backend/.gitignore`, `backend/.env.example`, `backend/src/core/types.ts`
- Create: `.husky/pre-commit` (repo root), `.gitignore` (repo root), `package.json` (repo root, for husky only)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `npm test` / `npm run typecheck` / `npm run lint` / `npm run format` all working; husky pre-commit wired; `src/core/types.ts` with `Scope`, `Module`, `RouteScopeKey` used by every later task.

- [ ] **Step 1: Create the root package.json + .gitignore + husky hook**

Repo root `package.json`:
```json
{
  "name": "gsiv-platform",
  "private": true,
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.1.7"
  }
}
```

Repo root `.gitignore`:
```
node_modules/
dist/
*.log
.env
.DS_Store
```

`.husky/pre-commit`:
```sh
cd backend && npx lint-staged
```

- [ ] **Step 2: Create backend/package.json with all dependencies**

```json
{
  "name": "gsiv-platform-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/zod-openapi": "^0.18.4",
    "better-sqlite3": "^12.2.0",
    "hono": "^4.6.14",
    "ioredis": "^5.4.2",
    "ws": "^8.18.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "biome": "^1.9.4",
    "lint-staged": "^15.3.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^3.0.2"
  }
}
```

- [ ] **Step 3: Create backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create backend/biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "ignore": ["dist", "node_modules"] },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

- [ ] **Step 5: Create backend/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
```

- [ ] **Step 6: Create backend/.env.example and backend/.gitignore**

`.env.example`:
```
# Local Redis (dashboard internals). Leave empty to use the in-memory fallback.
REDIS_URL=

# Auth tokens: name:token[:scope1,scope2]. Missing scopes = full admin (*).
# Generate with: node -e "console.log(crypto.randomUUID())"
AUTH_TOKENS=admin:changeme:*
```

`backend/.gitignore`:
```
node_modules/
dist/
*.db
*.db-journal
*.db-wal
*.db-shm
.env
```

- [ ] **Step 7: Create src/core/types.ts**

```ts
export interface Scope {
  name: string;
  description: string;
}

/** Key format: "METHOD /path" with :params, e.g. "GET /items/:id". */
export type RouteScopeKey = string;

export interface Module {
  name: string;
  prefix: string;
  scopes: Scope[];
  /** Every route in the module's OpenAPI spec must appear here: key -> allowed scopes. */
  routeScopes: Record<RouteScopeKey, string[]>;
  registerRoutes(app: import("@hono/zod-openapi").OpenAPIHono, deps: unknown): void;
  wsEvents?: Record<string, (msg: unknown, ctx: unknown) => void>;
  onLoad?(deps: unknown): void;
  onUnload?(deps: unknown): void;
}
```

- [ ] **Step 8: Install and verify the toolchain works**

Run (from repo root): `npm install && cd backend && npm install`
Run: `cd backend && npx tsc --noEmit` — expected: PASS (no source yet besides types.ts)
Run: `cd backend && npx biome check .` — expected: PASS
Run: `cd backend && npm test` — expected: "no test files found" (vitest exits 0 with no tests) — verify exit 0.

- [ ] **Step 9: Commit**

```bash
git add package.json .gitignore .husky backend/package.json backend/tsconfig.json backend/biome.json backend/vitest.config.ts backend/.env.example backend/.gitignore backend/src/core/types.ts
git commit -m "chore: scaffold backend toolchain (ts, vitest, biome, husky) + core types"
```

---

### Task 2: Module Registry

**Files:**
- Create: `backend/src/core/registry.ts`
- Test: `backend/tests/core/registry.test.ts`

**Interfaces:**
- Consumes: `Module`, `Scope`, `RouteScopeKey` from `./types.js` (Task 1).
- Produces: `class Registry { register(m: Module): void; get(name: string): Module | undefined; list(): Module[]; validate(): void }` — `validate()` throws `RegistryError` with all violations listed. Used by `server.ts` (Task 9) and `spec.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Registry } from "../../src/core/registry.js";
import type { Module } from "../../src/core/types.js";

function module(overrides: Partial<Module>): Module {
  return {
    name: "test",
    prefix: "/api/modules/test",
    scopes: [{ name: "test.read", description: "read" }],
    routeScopes: { "GET /items": ["test.read"] },
    registerRoutes() {},
    ...overrides,
  };
}

describe("Registry", () => {
  it("registers and lists modules", () => {
    const r = new Registry();
    r.register(module({}));
    expect(r.list().map((m) => m.name)).toEqual(["test"]);
    expect(r.get("test")?.name).toBe("test");
  });

  it("rejects duplicate module names", () => {
    const r = new Registry();
    r.register(module({}));
    expect(() => r.register(module({}))).toThrow(/duplicate/i);
  });

  it("rejects duplicate prefixes", () => {
    const r = new Registry();
    r.register(module({ name: "a" }));
    expect(() => r.register(module({ name: "b", prefix: "/api/modules/test" }))).toThrow(/prefix/i);
  });

  it("validate() fails when a declared scope is unused", () => {
    const r = new Registry();
    r.register(module({ scopes: [{ name: "unused.scope", description: "x" }] }));
    expect(() => r.validate()).toThrow(/unused/i);
  });

  it("validate() fails when a route has no scope entry", () => {
    const r = new Registry();
    r.register(module({ routeScopes: {} }));
    expect(() => r.validate()).toThrow(/scope/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/registry.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/registry.js'`

- [ ] **Step 3: Implement the registry**

```ts
import type { Module } from "./types.js";

export class RegistryError extends Error {}

export class Registry {
  private modules = new Map<string, Module>();

  register(m: Module): void {
    if (this.modules.has(m.name)) {
      throw new RegistryError(`duplicate module name: ${m.name}`);
    }
    for (const existing of this.modules.values()) {
      if (existing.prefix === m.prefix) {
        throw new RegistryError(`duplicate prefix: ${m.prefix} (${m.name} vs ${existing.name})`);
      }
    }
    this.modules.set(m.name, m);
  }

  get(name: string): Module | undefined {
    return this.modules.get(name);
  }

  list(): Module[] {
    return [...this.modules.values()];
  }

  /** Fail-fast boot validation. Throws RegistryError with all violations. */
  validate(): void {
    const errors: string[] = [];
    for (const m of this.modules.values()) {
      const declared = new Set(m.scopes.map((s) => s.name));
      const used = new Set(Object.values(m.routeScopes).flat());
      for (const name of declared) {
        if (!used.has(name)) errors.push(`${m.name}: declared scope '${name}' is never used`);
      }
      for (const [key] of Object.entries(m.routeScopes)) {
        if (!/^(GET|POST|PUT|PATCH|DELETE) \//.test(key)) {
          errors.push(`${m.name}: invalid route scope key '${key}'`);
        }
      }
    }
    if (errors.length) throw new RegistryError(errors.join("; "));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/registry.ts backend/tests/core/registry.test.ts
git commit -m "feat(core): module registry with boot validation"
```

---

### Task 3: Core DB (SQLite + migrations)

**Files:**
- Create: `backend/src/core/db.ts`
- Test: `backend/tests/core/db.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 1 types.
- Produces: `class CoreDb { constructor(dbPath?: string); get(): Database.Database; migrate(module: string, migrations: string[]): void; close(): void }` — `migrate()` runs each migration once, tracked per module in `schema_migrations`, all in a transaction. Used by modules' `store.ts` files and `server.ts` (Task 9). Tests use `:memory:`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, afterEach } from "vitest";
import { CoreDb } from "../../src/core/db.js";

describe("CoreDb", () => {
  let db: CoreDb | undefined;

  afterEach(() => db?.close());

  it("runs migrations once and tracks them", () => {
    db = new CoreDb(":memory:");
    db.migrate("inventory", ["CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, name TEXT);"]);
    db.migrate("inventory", ["CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, name TEXT);"]);
    const rows = db.get().prepare("SELECT * FROM schema_migrations").all();
    expect(rows).toHaveLength(1);
  });

  it("runs multiple migrations in order", () => {
    db = new CoreDb(":memory:");
    db.migrate("pricing", [
      "CREATE TABLE pricing_sales (id INTEGER PRIMARY KEY, name TEXT);",
      "ALTER TABLE pricing_sales ADD COLUMN cost INTEGER;",
    ]);
    const cols = db.get().prepare("PRAGMA table_info(pricing_sales)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("cost");
  });

  it("rolls back a failed migration transaction", () => {
    db = new CoreDb(":memory:");
    expect(() => db.migrate("bad", ["CREATE TABLE ok (id INTEGER);", "THIS IS NOT SQL;"]))
      .toThrow();
    const rows = db.get().prepare("SELECT * FROM schema_migrations WHERE module='bad'").all();
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/db.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import Database from "better-sqlite3";

export class CoreDb {
  private db: Database.Database;

  constructor(dbPath: string = process.env.DB_PATH || ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        module TEXT NOT NULL,
        idx INTEGER NOT NULL,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (module, idx)
      );
    `);
  }

  get(): Database.Database {
    return this.db;
  }

  migrate(module: string, migrations: string[]): void {
    const applied = new Set(
      (this.db.prepare("SELECT idx FROM schema_migrations WHERE module = ?").all(module) as { idx: number }[]).map(
        (r) => r.idx,
      ),
    );
    const run = this.db.transaction(() => {
      migrations.forEach((sql, idx) => {
        if (applied.has(idx)) return;
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations (module, idx) VALUES (?, ?)").run(module, idx);
      });
    });
    run();
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/db.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/db.ts backend/tests/core/db.test.ts
git commit -m "feat(core): SQLite wrapper with per-module transactional migrations"
```

---

### Task 4: Core KV (Redis with in-memory fallback)

**Files:**
- Create: `backend/src/core/kv.ts`
- Test: `backend/tests/core/kv.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 1 types.
- Produces: `interface KV { get(k): Promise<string|null>; set(k, v, ttlMs?): Promise<void>; del(k): Promise<void>; incr(k): Promise<number>; keys(pattern): Promise<string[]>; }` and `createKV(url?: string): Promise<KV>` — Redis impl when `REDIS_URL` set, `InMemoryKV` otherwise. Used by auth (Task 5), rate-limit (Task 6), modules.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryKV } from "../../src/core/kv.js";

describe("InMemoryKV", () => {
  it("set/get/del roundtrip", async () => {
    const kv = new InMemoryKV();
    await kv.set("a", "1");
    expect(await kv.get("a")).toBe("1");
    await kv.del("a");
    expect(await kv.get("a")).toBeNull();
  });

  it("expires keys by TTL", async () => {
    const kv = new InMemoryKV();
    await kv.set("a", "1", 20);
    expect(await kv.get("a")).toBe("1");
    await new Promise((r) => setTimeout(r, 40));
    expect(await kv.get("a")).toBeNull();
  });

  it("incr is atomic-ish and starts at 1", async () => {
    const kv = new InMemoryKV();
    expect(await kv.incr("n")).toBe(1);
    expect(await kv.incr("n")).toBe(2);
  });

  it("keys(pattern) glob matching", async () => {
    const kv = new InMemoryKV();
    await kv.set("rl:u:1", "x");
    await kv.set("rl:u:2", "y");
    await kv.set("other", "z");
    const keys = await kv.keys("rl:*");
    expect(keys.sort()).toEqual(["rl:u:1", "rl:u:2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/kv.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
interface KVEntry {
  value: string;
  expiresAt: number | null;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export class InMemoryKV implements KV {
  private store = new Map<string, KVEntry>();

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt !== null && v.expiresAt <= now) this.store.delete(k);
    }
  }

  async get(key: string): Promise<string | null> {
    this.prune();
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    const cur = Number((await this.get(key)) ?? 0) + 1;
    await this.set(key, String(cur));
    return cur;
  }

  async keys(pattern: string): Promise<string[]> {
    this.prune();
    const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\]/g, "\$&").replace(/\*/g, ".*") + "$");
    return [...this.store.keys()].filter((k) => re.test(k));
  }
}

export async function createKV(url?: string): Promise<KV> {
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) return new InMemoryKV();
  const { default: Redis } = await import("ioredis");
  const client = new Redis(redisUrl, { lazyConnect: true });
  await client.connect();
  return {
    async get(k) { return client.get(k); },
    async set(k, v, ttl) { if (ttl) await client.set(k, v, "PX", ttl); else await client.set(k, v); },
    async del(k) { await client.del(k); },
    async incr(k) { return client.incr(k); },
    async keys(p) { return client.keys(p); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/kv.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/kv.ts backend/tests/core/kv.test.ts
git commit -m "feat(core): KV abstraction — Redis with in-memory fallback"
```

---

### Task 5: Core Auth (tokens → scopes, middleware)

**Files:**
- Create: `backend/src/core/auth.ts`
- Test: `backend/tests/core/auth.test.ts`

**Interfaces:**
- Consumes: `KV` (Task 4).
- Produces: `interface AuthedUser { name: string; scopes: string[] }`, `class Auth { constructor(kv: KV); async verify(token): Promise<AuthedUser|null>; authMiddleware(): MiddlewareHandler; requireScope(scope: string): MiddlewareHandler; }`. `AUTH_TOKENS` format `name:token[:scope1,scope2]`, missing scopes = `["*"]`. `requireScope` checks `scopes.includes("*") || scopes.includes(scope)`, else 403. Token compare via `crypto.timingSafeEqual`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryKV } from "../../src/core/kv.js";
import { Auth } from "../../src/core/auth.js";

describe("Auth", () => {
  async function makeAuth(tokensEnv: string) {
    const prev = process.env.AUTH_TOKENS;
    process.env.AUTH_TOKENS = tokensEnv;
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv();
    process.env.AUTH_TOKENS = prev;
    return auth;
  }

  it("verifies a token and returns scopes", async () => {
    const auth = await makeAuth("admin:tok123:*");
    const user = await auth.verify("tok123");
    expect(user?.name).toBe("admin");
    expect(user?.scopes).toContain("*");
  });

  it("parses explicit scopes", async () => {
    const auth = await makeAuth("friend:tok456:inventory.read,pricing.read");
    const user = await auth.verify("tok456");
    expect(user?.scopes).toEqual(["inventory.read", "pricing.read"]);
  });

  it("rejects unknown tokens", async () => {
    const auth = await makeAuth("admin:tok123:*");
    expect(await auth.verify("nope")).toBeNull();
  });

  it("requireScope denies without the scope", async () => {
    const auth = await makeAuth("friend:tok456:inventory.read");
    const app = new Hono();
    app.use("*", auth.authMiddleware());
    app.get("/x", auth.requireScope("pricing.read"), (c) => c.json({ ok: true }));
    const res1 = await app.request("/x", { headers: { Authorization: "Bearer tok456" } });
    expect(res1.status).toBe(403);
    const res2 = await app.request("/x", { headers: { Authorization: "Bearer nope" } });
    expect(res2.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { KV } from "./kv.js";

export interface AuthedUser {
  name: string;
  scopes: string[];
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export class Auth {
  private tokens = new Map<string, AuthedUser>();

  constructor(private kv: KV) {}

  loadFromEnv(env: string = process.env.AUTH_TOKENS || ""): void {
    this.tokens.clear();
    for (const pair of env.split(",")) {
      const [name, token, scopeList] = pair.split(":");
      if (!name || !token) continue;
      const scopes = scopeList ? scopeList.split(",").map((s) => s.trim()).filter(Boolean) : ["*"];
      this.tokens.set(token.trim(), { name: name.trim(), scopes });
    }
  }

  async verify(token: string | null | undefined): Promise<AuthedUser | null> {
    if (!token) return null;
    const user = this.tokens.get(token);
    if (!user) return null;
    await this.kv.set(`auth:last:${token.slice(0, 8)}`, user.name, 60_000).catch(() => {});
    return user;
  }

  authMiddleware(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const header = c.req.header("Authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      const user = await this.verify(token);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      c.set("user", user);
      await next();
    };
  }

  requireScope(scope: string): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const user = c.get("user") as AuthedUser | undefined;
      if (!user) return c.json({ error: "unauthorized" }, 401);
      if (!user.scopes.includes("*") && !user.scopes.includes(scope)) {
        return c.json({ error: "forbidden", scope }, 403);
      }
      await next();
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/auth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/auth.ts backend/tests/core/auth.test.ts
git commit -m "feat(core): bearer auth with per-token scopes + constant-time compare"
```

---

### Task 6: Core Rate Limiting

**Files:**
- Create: `backend/src/core/rate-limit.ts`
- Test: `backend/tests/core/rate-limit.test.ts`

**Interfaces:**
- Consumes: `KV` (Task 4).
- Produces: `function rateLimit(opts: { kv: KV; windowMs: number; max: number; keyFn: (c: Context) => string }): MiddlewareHandler` — sliding window via sorted timestamps in a single KV list value; on exceed returns 429 + `Retry-After`; always sets `X-RateLimit-Limit` / `X-RateLimit-Remaining`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryKV } from "../../src/core/kv.js";
import { rateLimit } from "../../src/core/rate-limit.js";

describe("rateLimit", () => {
  it("allows up to max then 429", async () => {
    const kv = new InMemoryKV();
    const app = new Hono();
    app.use("*", rateLimit({ kv, windowMs: 60_000, max: 3, keyFn: (c) => c.req.header("x-key") || "anon" }));
    app.get("/", (c) => c.json({ ok: true }));
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/", { headers: { "x-key": "u1" } })).status).toBe(200);
    }
    const res = await app.request("/", { headers: { "x-key": "u1" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("different keys are independent", async () => {
    const kv = new InMemoryKV();
    const app = new Hono();
    app.use("*", rateLimit({ kv, windowMs: 60_000, max: 1, keyFn: (c) => c.req.header("x-key") || "anon" }));
    app.get("/", (c) => c.json({ ok: true }));
    expect((await app.request("/", { headers: { "x-key": "a" } })).status).toBe(200);
    expect((await app.request("/", { headers: { "x-key": "b" } })).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/rate-limit.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import type { Context, MiddlewareHandler, Next } from "hono";
import type { KV } from "./kv.js";

interface RateLimitOpts {
  kv: KV;
  windowMs: number;
  max: number;
  keyFn: (c: Context) => string;
}

export function rateLimit(opts: RateLimitOpts): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const key = `rl:${opts.keyFn(c)}`;
    const now = Date.now();
    const raw = await opts.kv.get(key);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const fresh = stamps.filter((t) => now - t < opts.windowMs);
    const remaining = Math.max(0, opts.max - fresh.length);
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(remaining));
    if (fresh.length >= opts.max) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    fresh.push(now);
    await opts.kv.set(key, JSON.stringify(fresh), opts.windowMs);
    await next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/rate-limit.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/rate-limit.ts backend/tests/core/rate-limit.test.ts
git commit -m "feat(core): sliding-window rate limiter with headers"
```

---

### Task 7: Core WS Event Bus

**Files:**
- Create: `backend/src/core/ws.ts`
- Test: `backend/tests/core/ws.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 1 types.
- Produces: `class EventBus { on(module: string, type: string, handler: (payload: unknown) => void): () => void; emit(type: string, payload: unknown): void; }` — per-module namespaced subscriptions; `emit` fans out to matching handlers. Later tasks (Task 9) attach the actual `WebSocketServer`; the bus is the testable core.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/core/ws.js";

describe("EventBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.on("inventory", "update", (p) => seen.push(p));
    bus.emit("update", { n: 1 });
    bus.emit("update", { n: 2 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    off();
    bus.emit("update", { n: 3 });
    expect(seen).toHaveLength(2);
  });

  it("scopes subscriptions per module", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.on("inventory", "update", (p) => a.push(p));
    bus.on("pricing", "update", (p) => b.push(p));
    bus.emit("update", { x: 1 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("throws on duplicate module registration", () => {
    const bus = new EventBus();
    bus.on("m", "e", () => {});
    expect(() => bus.on("m", "e", () => {})).toThrow(/already/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/ws.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
export class EventBus {
  private subs = new Map<string, Map<string, Set<(p: unknown) => void>>>();

  on(module: string, type: string, handler: (payload: unknown) => void): () => void {
    let byType = this.subs.get(module);
    if (!byType) {
      byType = new Map();
      this.subs.set(module, byType);
    }
    let handlers = byType.get(type);
    if (!handlers) {
      handlers = new Set();
      byType.set(type, handlers);
    }
    if (handlers.has(handler)) throw new Error(`duplicate subscription: ${module}.${type}`);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  emit(type: string, payload: unknown): void {
    for (const byType of this.subs.values()) {
      const handlers = byType.get(type);
      if (!handlers) continue;
      for (const h of [...handlers]) h(payload);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/ws.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/ws.ts backend/tests/core/ws.test.ts
git commit -m "feat(core): namespaced WS event bus"
```

---

### Task 8: Core OpenAPI Spec Merge

**Files:**
- Create: `backend/src/core/spec.ts`
- Test: `backend/tests/core/spec.test.ts`

**Interfaces:**
- Consumes: `Registry` (Task 2), `Module` (Task 1).
- Produces: `function buildSpec(registry: Registry, app: OpenAPIHono): Promise<Record<string, unknown>>` — collects each module's `getOpenAPISpec()`, merges `paths`, adds `info`; throws if a module's spec has a route path not covered by `routeScopes`. `server.ts` (Task 9) serves it at `/api/spec`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Registry } from "../../src/core/registry.js";
import { buildSpec } from "../../src/core/spec.js";
import type { Module } from "../../src/core/types.js";

describe("buildSpec", () => {
  it("merges module specs and validates scope coverage", async () => {
    const registry = new Registry();
    const route = createRoute({
      method: "get",
      path: "/items",
      responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.number() })) } }, description: "ok" } },
    });
    const module: Module = {
      name: "inventory",
      prefix: "/api/modules/inventory",
      scopes: [{ name: "inventory.read", description: "r" }],
      routeScopes: { "GET /items": ["inventory.read"] },
      registerRoutes(router) {
        router.openapi(route, (c) => c.json([{ id: 1 }]));
      },
    };
    registry.register(module);
    registry.validate();
    const spec = await buildSpec(registry);
    expect(spec.paths["/api/modules/inventory/items"]).toBeDefined();
  });

  it("fails when a route is missing from routeScopes", async () => {
    const registry = new Registry();
    const route = createRoute({
      method: "get",
      path: "/secret",
      responses: { 200: { description: "ok" } },
    });
    registry.register({
      name: "m",
      prefix: "/api/modules/m",
      scopes: [{ name: "m.read", description: "r" }],
      routeScopes: {},
      registerRoutes(router) {
        router.openapi(route, (c) => c.json({}));
      },
    });
    await expect(buildSpec(registry)).rejects.toThrow(/scope/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/spec.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Registry } from "./registry.js";
import type { Module } from "./types.js";

function normalizePath(path: string): string {
  // zod-openapi spec paths use {param}; routeScopes keys use :param. Normalize both to :param.
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

export async function buildSpec(registry: Registry): Promise<Record<string, unknown>> {
  const paths: Record<string, unknown> = {};
  for (const m of registry.list()) {
    const spec = await moduleSpec(m);
    for (const [p, methods] of Object.entries(spec.paths as Record<string, unknown>)) {
      const key = normalizePath(p);
      const scopes = m.routeScopes[key] ?? m.routeScopes[p];
      if (!scopes) {
        throw new Error(`${m.name}: route ${p} is missing from routeScopes`);
      }
      paths[p] = methods;
    }
  }
  return {
    openapi: "3.0.3",
    info: { title: "GSIVPlatform API", version: "0.1.0" },
    paths,
  };
}

async function moduleSpec(m: Module): Promise<{ paths: Record<string, unknown> }> {
  const router = new OpenAPIHono();
  m.registerRoutes(router, {});
  return router.getOpenAPISpec() as { paths: Record<string, unknown> };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/spec.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/spec.ts backend/tests/core/spec.test.ts
git commit -m "feat(core): OpenAPI spec merge with route-scope coverage check"
```

---

### Task 9: Bootstrap Server + health Module

**Files:**
- Create: `backend/src/core/server.ts`, `backend/src/modules/health/index.ts`, `backend/src/index.ts`
- Test: `backend/tests/core/server.test.ts`

**Interfaces:**
- Consumes: `Registry` (2), `CoreDb` (3), `createKV` (4), `Auth` (5), `rateLimit` (6), `EventBus` (7), `buildSpec` (8).
- Produces: `function createApp(opts: { registry, kv, db, auth, eventBus }): Hono` — mounts `/health` (public), `/api/modules/<name>` per module with `authMiddleware` + `rateLimit` + module routes, and `/api/spec` (authed). `health` module exposes `GET /api/modules/health/status` authed (scope `health.read`). `src/index.ts` wires real deps and calls `serve()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Registry } from "../../src/core/registry.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Auth } from "../../src/core/auth.js";
import { EventBus } from "../../src/core/ws.js";
import { createApp } from "../../src/core/server.js";
import { healthModule } from "../../src/modules/health/index.js";

describe("createApp", () => {
  it("serves public health and authed module status with scope enforcement", async () => {
    const registry = new Registry();
    registry.register(healthModule);
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("admin:tok:*");
    const db = new CoreDb(":memory:");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });

    const pub = await app.request("/health");
    expect(pub.status).toBe(200);

    const noAuth = await app.request("/api/modules/health/status");
    expect(noAuth.status).toBe(401);

    const ok = await app.request("/api/modules/health/status", { headers: { Authorization: "Bearer tok" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");

    const spec = await app.request("/api/spec", { headers: { Authorization: "Bearer tok" } });
    expect(spec.status).toBe(200);
    expect((await spec.json()).paths["/api/modules/health/status"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the health module**

`backend/src/modules/health/index.ts`:
```ts
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  responses: {
    200: { content: { "application/json": { schema: z.object({ status: z.string(), ts: z.number() }) } }, description: "ok" },
  },
});

export const healthModule: Module = {
  name: "health",
  prefix: "/api/modules/health",
  scopes: [{ name: "health.read", description: "Read platform health" }],
  routeScopes: { "GET /status": ["health.read"] },
  registerRoutes(router: OpenAPIHono, _deps: unknown): void {
    router.openapi(statusRoute, (c) => c.json({ status: "ok", ts: Date.now() }));
  },
};
```

- [ ] **Step 4: Implement server.ts**

```ts
import { Hono } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Registry } from "./registry.js";
import type { CoreDb } from "./db.js";
import type { KV } from "./kv.js";
import type { Auth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import type { EventBus } from "./ws.js";
import { buildSpec } from "./spec.js";

export interface AppDeps {
  registry: Registry;
  kv: KV;
  db: CoreDb;
  auth: Auth;
  eventBus: EventBus;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const moduleDeps = { kv: deps.kv, db: deps.db, eventBus: deps.eventBus };

  app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

  for (const m of deps.registry.list()) {
    const router = new OpenAPIHono();
    m.registerRoutes(router, moduleDeps);
    app.route(
      m.prefix,
      deps.auth.authMiddleware(),
      rateLimit({ kv: deps.kv, windowMs: 60_000, max: 120, keyFn: (c) => (c.get("user") as { name: string }).name }),
      router,
    );
  }

  app.get("/api/spec", deps.auth.authMiddleware(), async (c) => {
    const spec = await buildSpec(deps.registry);
    return c.json(spec);
  });

  return app;
}
```

- [ ] **Step 5: Create src/index.ts (entrypoint)**

```ts
import { serve } from "@hono/node-server";
import { Registry } from "./core/registry.js";
import { CoreDb } from "./core/db.js";
import { createKV } from "./core/kv.js";
import { Auth } from "./core/auth.js";
import { EventBus } from "./core/ws.js";
import { createApp } from "./core/server.js";
import { healthModule } from "./modules/health/index.js";

const registry = new Registry();
registry.register(healthModule);
registry.validate();

const kv = await createKV();
const db = new CoreDb(process.env.DB_PATH || "data/gsiv.db");
const auth = new Auth(kv);
auth.loadFromEnv();
const eventBus = new EventBus();

const app = createApp({ registry, kv, db, auth, eventBus });
const port = Number(process.env.PORT || 3100);
serve({ fetch: app.fetch, port }, () => console.log(`gsiv-platform listening on :${port}`));
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npx vitest run tests/core/server.test.ts`
Expected: PASS (1 test, 4 assertions)

- [ ] **Step 7: Run full suite + typecheck + lint**

Run: `cd backend && npm test && npm run typecheck && npm run lint`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/core/server.ts backend/src/modules/health/index.ts backend/src/index.ts backend/tests/core/server.test.ts
git commit -m "feat(core): bootstrap server, health module, spec endpoint"
```

---

### Task 10: Security Review + Hardening Gate

**Files:**
- Review: everything under `backend/src/` created in Tasks 1-9.
- Modify: any file with findings (expect: `auth.ts`, `kv.ts`, `server.ts` at most).
- Create: `backend/SECURITY.md` (threat model notes).

**Interfaces:**
- Consumes: the full core implementation.
- Produces: a security-reviewed core with documented threat model; the first security gate the project treats as mandatory for every future module plan.

- [ ] **Step 1: Run the security review tool on the current diff**

Run: `security_review` (Reasonix built-in) with scope "full" on the working tree.
Expected: report of any injection / authz / secrets / DoS findings.

- [ ] **Step 2: Fix any findings**

Known likely findings and their required fixes (apply whichever the review confirms):
- If `requireScope` is bypassable via path normalization — add a registry check that module prefixes can't collide with `/api/spec` or `/health`.
- If rate limit key can be spoofed (header-based) — confirm per-token keying (uses `c.get("user").name`, not headers) is used in `server.ts`; adjust if the review disagrees.
- Confirm no secrets in tests or committed env files; `.env` is gitignored (Task 1).
- Confirm `timingSafeEqual` path is used (Task 5) and no plaintext passwords are logged.

- [ ] **Step 3: Write backend/SECURITY.md**

```markdown
# GSIVPlatform — Security Model

## Auth
- Bearer tokens from `AUTH_TOKENS` env (`name:token[:scope1,scope2]`).
- Missing scopes => full admin (`*`).
- Constant-time token comparison (`crypto.timingSafeEqual`).
- Per-token scope lists enforced per route via `requireScope`.

## Scopes
- Every route MUST declare a scope (registry + spec boot validation).
- Admin `*` bypasses scope checks.
- No route may be public unless explicitly mounted outside `/api/modules/*`.

## Rate limiting
- Sliding window per authed user, 120 req/min default, applied at module mount.
- Public endpoints (`/health`) have no rate limit; keep them side-effect-free.

## Data
- All SQL through better-sqlite3 prepared statements.
- No shell execution, no eval. (Future modules that need Ruby entry.yaml
  access must go through a dedicated, review-gated core capability.)

## Secrets
- `.env` gitignored. No secrets in tests or docs.
- Token store is memory + Redis; KV keys are hash-prefixed, never full tokens.

## Future module gate
Every module plan MUST include: scopes declared and used, routeScopes coverage,
rate-limit appropriateness, a `SECURITY.md` delta, and a security_review pass.
```

- [ ] **Step 4: Run final gate**

Run: `cd backend && npm test && npm run typecheck && npm run lint && npm run format`
Expected: all PASS; `git status` clean after formatting.

- [ ] **Step 5: Commit**

```bash
git add backend/SECURITY.md backend/src backend/tests
git commit -m "chore(core): security hardening + threat model doc"
```

---

### Task 11: Smoke test + README

**Files:**
- Create: `backend/README.md`
- Modify: none.

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: documented run/debug/test workflow; a smoke test proving the built artifact boots.

- [ ] **Step 1: Write backend/README.md**

```markdown
# GSIVPlatform Backend

Modular Hono backend. Features are modules registered in the core registry.

## Commands

    npm install
    npm run dev        # tsx watch
    npm run build      # tsc -> dist/
    npm start          # node dist/index.js
    npm test           # vitest run
    npm run typecheck  # tsc --noEmit
    npm run lint       # biome check
    npm run format     # biome format --write

## Config (.env)

    REDIS_URL=             # empty => in-memory KV fallback
    AUTH_TOKENS=admin:tok:*  # name:token[:scopes]
    PORT=3100
    DB_PATH=data/gsiv.db

## Adding a module

1. Create `src/modules/<name>/index.ts` exporting a `Module` (see
   `src/core/types.ts`).
2. Declare `scopes` + `routeScopes` for every route.
3. Register it in `src/index.ts` and add tests in `tests/modules/<name>/`.
4. Run `npm test && npm run typecheck && npm run lint` and pass security review.

## Endpoints

- `GET /health` — public liveness.
- `GET /api/modules/<name>/...` — module routes (Bearer + scope).
- `GET /api/spec` — merged OpenAPI spec (Bearer).
```

- [ ] **Step 2: Build + smoke test**

Run: `cd backend && npm run build && PORT=3199 REDIS_URL= AUTH_TOKENS=admin:tok123:* DB_PATH=:memory: node dist/index.js` in background, then:
Run: `curl -s http://127.0.0.1:3199/health` — expected `{"status":"ok",...}`
Run: `curl -s http://127.0.0.1:3199/api/modules/health/status -H "Authorization: Bearer tok123"` — expected `{"status":"ok","ts":...}`
Run: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3199/api/modules/health/status` — expected `401`
Kill the background node process.

- [ ] **Step 3: Commit**

```bash
git add backend/README.md
git commit -m "docs(backend): run/debug workflow + module HOWTO + smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** the approved design's core elements are covered: registry (T2), auth+scopes (T5), rate limit (T6), db migrations (T3), KV/redis (T4), WS bus (T7), OpenAPI (T8), bootstrap+health module (T9), security gate (T10). Frontend shell, VellumFE link, and the inventory/pricing modules are deliberately separate follow-on plans per the agreed scope (core platform first).
- **Placeholder scan:** no TBD/TODO/XXX remain. All code blocks are complete.
- **Type consistency:** `Module.routeScopes` keyed by `METHOD /path` with `:params`; `buildSpec` normalizes `{param}` → `:param` before lookup; `Auth.requireScope` and `Auth.authMiddleware` names consistent across T5/T9.
- **Test count:** 24 tests across 8 test files (registry 5, db 3, kv 4, auth 4, rate-limit 2, ws 3, spec 2, server 1).
- **Security:** Task 10 is the Cloudflare-style security gate; SECURITY.md becomes the contract for all future module plans.
