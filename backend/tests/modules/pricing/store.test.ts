import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { PricingStore } from "../../../src/modules/pricing/store.js";
import { buildPricingFixture } from "../../fixtures/pricing-fixture.js";

describe("PricingStore", () => {
  let db: CoreDb;
  let store: PricingStore;

  beforeAll(() => {
    db = new CoreDb(":memory:");
    buildPricingFixture(db.get());
    store = new PricingStore(db);
  });

  afterAll(() => db.close());

  it("status reports last scraped + total sales", () => {
    const s = store.status();
    expect(s.total_sales).toBe(5);
    expect(s.last_scraped_at).toBe("2026-07-26T00:00:00.000Z");
  });

  it("searchSales filters by name and town", () => {
    const r = store.searchSales({ q: "emerald", town: "Ta'Vaalor" });
    expect(r.sales.length).toBe(3);
  });

  it("gemTypes aggregates jar sales by gem type", () => {
    const types = store.gemTypes();
    const emeralds = types.find((t) => t.gem_type === "uncut emeralds");
    expect(emeralds).toBeDefined();
    expect(emeralds?.jar_sales).toBe(2);
    expect(emeralds?.individual_sales).toBeGreaterThanOrEqual(1);
  });

  it("createListing inserts and returns the row", () => {
    const l = store.createListing({
      gem_type: "sapphires",
      count: 5,
      price_per_gem: 1000,
      total_price: 5000,
      character: "Neleourg",
      shop: "Erendiir",
      town: "Solhaven",
    });
    expect(l.id).toBeGreaterThan(0);
    expect(l.total_price).toBe(5000);
  });

  it("sellThroughStats computes for a shop", () => {
    const stats = store.sellThroughStats("Erendiir");
    expect(stats).not.toBeNull();
    expect(stats?.total_sold).toBe(1);
    expect(stats?.total_pending).toBe(2);
  });

  it("towns returns distinct towns", () => {
    const towns = store.towns();
    expect(towns).toContain("Ta'Vaalor");
    expect(towns).toContain("Solhaven");
  });

  it("estimateCount picks 20 for a 2x standard jar", () => {
    // 16000 / 20 = 800 per gem
    const { count, confidence } = store.estimateCount(16000, 800);
    expect(count).toBe(20);
    expect(confidence).toBeGreaterThan(0.9);
  });
});
