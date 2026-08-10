import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createPricingModule } from "../../../src/modules/pricing/index.js";
import { PricingScraper } from "../../../src/modules/pricing/scraper.js";
import { PricingStore } from "../../../src/modules/pricing/store.js";
import { buildPricingFixture } from "../../fixtures/pricing-fixture.js";

describe("pricing module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
    buildPricingFixture(db.get());
  });
  afterAll(() => db.close());

  function makeApp(tokensEnv: string) {
    const store = new PricingStore(db);
    const scraper = new PricingScraper(store, async () => ({ status: 304 }) as never);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createPricingModule(store, scraper));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/pricing/sales");
    expect(res.status).toBe(401);
  });

  it("denies read routes without pricing.read (403)", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/pricing/sales", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });

  it("GET /sales returns rows for a pricing.read token", async () => {
    const app = makeApp("limited:tok:pricing.read");
    const res = await app.request("/api/modules/pricing/sales?town=Ta'Vaalor", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; sales: unknown[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.sales.length).toBeGreaterThan(0);
  });

  it("denies POST /listings without pricing.write (403)", async () => {
    const app = makeApp("limited:tok:pricing.read");
    const res = await app.request("/api/modules/pricing/listings", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({
        gem_type: "rubies",
        count: 5,
        price_per_gem: 1000,
        total_price: 5000,
        character: "Fisternar",
        shop: "Erendiir",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /listings works with pricing.write (201)", async () => {
    const app = makeApp("limited:tok:pricing.write");
    const res = await app.request("/api/modules/pricing/listings", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({
        gem_type: "rubies",
        count: 5,
        price_per_gem: 1000,
        total_price: 5000,
        character: "Fisternar",
        shop: "Erendiir",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("denies POST /scrape without pricing.scrape (403)", async () => {
    const app = makeApp("limited:tok:pricing.read");
    const res = await app.request("/api/modules/pricing/scrape", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(403);
  });

  it("exposes pricing routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/pricing/sales"]).toBeDefined();
    expect(spec.paths["/api/modules/pricing/gems/price-recommendation"]).toBeDefined();
  });
});
