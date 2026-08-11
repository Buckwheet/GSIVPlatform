import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importSalesDb } from "../scripts/import-sales.mjs";

const PRICING_DDL = [
  `CREATE TABLE IF NOT EXISTS scrape_state (key TEXT PRIMARY KEY, value TEXT);`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL, name TEXT NOT NULL, town TEXT NOT NULL, shop TEXT NOT NULL,
    cost INTEGER, enchant INTEGER, worn TEXT, wear_location TEXT, material TEXT, item_type TEXT,
    is_weapon INTEGER NOT NULL DEFAULT 0, is_armor INTEGER NOT NULL DEFAULT 0, is_jewelry INTEGER NOT NULL DEFAULT 0,
    enhancives TEXT NOT NULL DEFAULT '[]', removed_date TEXT NOT NULL, scraped_at TEXT NOT NULL,
    UNIQUE(item_id)
  );`,
  `CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gem_type TEXT NOT NULL, count INTEGER NOT NULL, price_per_gem INTEGER NOT NULL, total_price INTEGER NOT NULL,
    character TEXT NOT NULL, shop TEXT NOT NULL, town TEXT, listed_date TEXT NOT NULL, removed_date TEXT,
    days_on_market REAL, confirmed_sold INTEGER NOT NULL DEFAULT 0
  );`,
];

let dir;
let oldPath;
let newPath;
let freshPath;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sales-import-"));
  oldPath = join(dir, "old.db");
  newPath = join(dir, "new.db");
  freshPath = join(dir, "fresh.db");

  const oldDb = new Database(oldPath);
  for (const sql of PRICING_DDL) oldDb.exec(sql);
  const ins =
    oldDb.prepare(`INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
    VALUES (@item_id, @name, @town, @shop, @cost, @enchant, @worn, @wear_location, @material, @item_type, @is_weapon, @is_armor, @is_jewelry, @enhancives, @removed_date, @scraped_at)`);
  ins.run({
    item_id: "1",
    name: "a runestaff",
    town: "Zul Logoth",
    shop: "Althaz",
    cost: 2000000,
    enchant: 18,
    worn: null,
    wear_location: null,
    material: "villswood",
    item_type: "weapon",
    is_weapon: 1,
    is_armor: 0,
    is_jewelry: 0,
    enhancives: "[]",
    removed_date: "2026-05-01T00:00:00Z",
    scraped_at: "2026-05-01T01:00:00Z",
  });
  ins.run({
    item_id: "2",
    name: "a gem",
    town: "Icemule",
    shop: "Erendiir",
    cost: 500,
    enchant: null,
    worn: null,
    wear_location: null,
    material: "gem",
    item_type: "gemstone",
    is_weapon: 0,
    is_armor: 0,
    is_jewelry: 1,
    enhancives: "[]",
    removed_date: "2026-06-01T00:00:00Z",
    scraped_at: "2026-06-01T01:00:00Z",
  });
  oldDb
    .prepare(`INSERT INTO listings (gem_type, count, price_per_gem, total_price, character, shop, town, listed_date, removed_date, days_on_market, confirmed_sold)
    VALUES ('uncut diamonds', 20, 7800, 156000, 'Karkith', 'Erendiir', 'Icemule Trace', '2026-05-03T21:50:29.913Z', null, 12.42, 1)`)
    .run();
  oldDb.prepare(`INSERT INTO scrape_state (key, value) VALUES ('etag', 'W/"abc"')`).run();
  oldDb.close();

  const newDb = new Database(newPath);
  for (const sql of PRICING_DDL) newDb.exec(sql);
  // pre-existing row with the same item_id as old's row "1" — must be skipped, not duplicated
  newDb
    .prepare(`INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
    VALUES ('1', 'a runestaff', 'Zul Logoth', 'Althaz', 999, 1, null, null, 'villswood', 'weapon', 1, 0, 0, '[]', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')`)
    .run();
  newDb.close();

  const freshDb = new Database(freshPath);
  for (const sql of PRICING_DDL) freshDb.exec(sql);
  freshDb.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function counts(db) {
  return {
    sales: db.prepare("SELECT COUNT(*) n FROM sales").get().n,
    listings: db.prepare("SELECT COUNT(*) n FROM listings").get().n,
    lastScrapedAt: db.prepare("SELECT value FROM scrape_state WHERE key='last_scraped_at'").get()?.value ?? null,
  };
}

describe("importSalesDb", () => {
  it("copies old rows into the new DB, skipping duplicate item_ids, and sets last_scraped_at", () => {
    const res = importSalesDb(oldPath, newPath);
    expect(res.salesInserted).toBe(1); // old has 2, one already present
    expect(res.listingsInserted).toBe(1);
    expect(res.lastScrapedAt).toBe("2026-06-01T01:00:00Z");
    const db = new Database(newPath, { readonly: true });
    expect(counts(db)).toEqual({ sales: 2, listings: 1, lastScrapedAt: "2026-06-01T01:00:00Z" });
    db.close();
  });

  it("is idempotent — a second run inserts nothing", () => {
    const res = importSalesDb(oldPath, newPath);
    expect(res.salesInserted).toBe(0);
    expect(res.listingsInserted).toBe(0);
  });

  it("dry-run reports what would be inserted but writes nothing", () => {
    const res = importSalesDb(oldPath, freshPath, { dryRun: true });
    expect(res.salesInserted).toBe(2);
    expect(res.listingsInserted).toBe(1);
    const db = new Database(freshPath, { readonly: true });
    expect(counts(db)).toEqual({ sales: 0, listings: 0, lastScrapedAt: null });
    db.close();
  });
});
