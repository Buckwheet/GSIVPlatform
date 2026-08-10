import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createInventoryModule } from "../../../src/modules/inventory/index.js";
import { InventoryStore } from "../../../src/modules/inventory/store.js";
import { buildInvFixture } from "../../fixtures/inv-fixture.js";

describe("inventory module routes", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gsiv-inv-routes-"));
    dbPath = join(dir, "inv.db3");
    const db = buildInvFixture();
    db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
    db.close();
  });

  const stores: InventoryStore[] = [];

  afterAll(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string) {
    const store = new InventoryStore(dbPath);
    stores.push(store);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createInventoryModule(store));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    const db = new CoreDb(":memory:");
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/inventory/summary");
    expect(res.status).toBe(401);
  });

  it("denies without inventory.read scope (403)", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/inventory/summary", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });

  it("returns summary for admin", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/inventory/summary", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { characters: number; items: number; totalSilver: number };
    expect(body.characters).toBe(2);
    expect(body.items).toBe(5);
  });

  it("returns search results", async () => {
    const app = makeApp("limited:tok:inventory.read");
    const res = await app.request("/api/modules/inventory/search?q=sapphire", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: string }[];
    expect(body.length).toBe(1);
    expect(body[0].item).toBe("sapphire");
  });

  it("exposes inventory routes in the OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/inventory/summary"]).toBeDefined();
    expect(spec.paths["/api/modules/inventory/search"]).toBeDefined();
  });
});
