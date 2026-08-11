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
    pricing
      .get()
      .prepare(
        `INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
       VALUES ('g4', 'a jar containing uncut emeralds', 'Ta''Vaalor', 'Erendiir', 24000, NULL, NULL, NULL, 'glass', 'jar', 0, 0, 0, '[]', '2026-07-26T00:00:00.000Z', '2026-07-26T01:00:00.000Z')`,
      )
      .run();
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
