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
    pricing
      .get()
      .prepare(
        `INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
       VALUES ('g9', 'a jar containing uncut emeralds', 'Ta''Vaalor', 'Erendiir', 32000, NULL, NULL, NULL, 'glass', 'jar', 0, 0, 0, '[]', '2026-07-27T00:00:00.000Z', '2026-07-27T01:00:00.000Z')`,
      )
      .run();
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
