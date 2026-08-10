import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { PricingScraper } from "../../../src/modules/pricing/scraper.js";
import { PricingStore } from "../../../src/modules/pricing/store.js";
import { buildPricingFixture } from "../../fixtures/pricing-fixture.js";

function mockFetch(payload: unknown, status = 200, etag = '"abc123"') {
  return async () =>
    ({
      status,
      ok: status < 400,
      headers: { get: (name: string) => (name.toLowerCase() === "etag" ? etag : null) },
      json: async () => payload,
    }) as never;
}

describe("PricingScraper", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
    buildPricingFixture(db.get());
  });
  afterAll(() => db.close());

  it("inserts new items and reports counts", async () => {
    const store = new PricingStore(db);
    const payload = {
      "Ta'Vaalor": [
        {
          id: "n1",
          name: "a jar containing rubies",
          town: "Ta'Vaalor",
          last_seen_shop: "Erendiir",
          removed_date: "2026-07-28T00:00:00.000Z",
          details: { cost: 12000 },
        },
        {
          id: "g1",
          name: "a jar containing uncut emeralds",
          town: "Ta'Vaalor",
          last_seen_shop: "Erendiir",
          removed_date: "2026-07-28T00:00:00.000Z",
          details: { cost: 8000 },
        },
      ],
    };
    const scraper = new PricingScraper(store, mockFetch(payload) as never);
    const result = await scraper.scrapeRemoved();
    expect(result.newItems).toBe(1); // n1 new; g1 already exists (skipped)
    expect(result.skipped).toBe(1);
    expect(store.getScrapeState("etag")).toBe('"abc123"');
    expect(store.getScrapeState("last_scraped_at")).not.toBeNull();
  });

  it("short-circuits on 304", async () => {
    const store = new PricingStore(db);
    const scraper = new PricingScraper(store, mockFetch(null, 304) as never);
    const result = await scraper.scrapeRemoved();
    expect(result).toEqual({ newItems: 0, skipped: 0, errors: 0 });
  });

  it("matches a removed item to an unconfirmed listing", async () => {
    const store = new PricingStore(db);
    // Fixture has an unconfirmed listing: uncut emeralds 8000 (10 x 800) at Erendiir
    const payload = {
      "Ta'Vaalor": [
        {
          id: "m1",
          name: "a jar containing uncut emeralds",
          town: "Ta'Vaalor",
          last_seen_shop: "Erendiir",
          removed_date: "2026-07-30T00:00:00.000Z",
          details: { cost: 8000 },
        },
      ],
    };
    const scraper = new PricingScraper(store, mockFetch(payload) as never);
    await scraper.scrapeRemoved();
    const listings = store.getListings("Erendiir", 50, 0).listings;
    const matched = listings.find((l) => l.total_price === 8000);
    expect(matched?.confirmed_sold).toBe(1);
    expect(matched?.days_on_market).not.toBeNull();
  });
});
