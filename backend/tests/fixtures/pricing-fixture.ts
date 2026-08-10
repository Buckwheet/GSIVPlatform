import Database from "better-sqlite3";

/** In-memory pricing DB replica with the sales-tracker schema + seed data. */
export function buildPricingFixture(db?: Database.Database): Database.Database {
  const target = db ?? new Database(":memory:");
  db = target;
  db.exec(`
    CREATE TABLE scrape_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL, name TEXT NOT NULL, town TEXT NOT NULL, shop TEXT NOT NULL,
      cost INTEGER, enchant INTEGER, worn TEXT, wear_location TEXT, material TEXT, item_type TEXT,
      is_weapon INTEGER NOT NULL DEFAULT 0, is_armor INTEGER NOT NULL DEFAULT 0, is_jewelry INTEGER NOT NULL DEFAULT 0,
      enhancives TEXT NOT NULL DEFAULT '[]', removed_date TEXT NOT NULL, scraped_at TEXT NOT NULL,
      UNIQUE(item_id)
    );
    CREATE INDEX idx_sales_name ON sales(name);
    CREATE INDEX idx_sales_town ON sales(town);
    CREATE TABLE listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gem_type TEXT NOT NULL, count INTEGER NOT NULL, price_per_gem INTEGER NOT NULL, total_price INTEGER NOT NULL,
      character TEXT NOT NULL, shop TEXT NOT NULL, town TEXT, listed_date TEXT NOT NULL, removed_date TEXT,
      days_on_market REAL, confirmed_sold INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_listings_gem_type ON listings(gem_type);
  `);

  const insSale = db.prepare(
    `INSERT INTO sales (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type, is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // 3 gem jars (Erendiir shop, "containing X" names)
  insSale.run(
    "g1",
    "a jar containing uncut emeralds",
    "Ta'Vaalor",
    "Erendiir",
    8000,
    null,
    null,
    null,
    "glass",
    "jar",
    0,
    0,
    0,
    "[]",
    "2026-07-20T00:00:00.000Z",
    "2026-07-20T01:00:00.000Z",
  );
  insSale.run(
    "g2",
    "a jar containing uncut emeralds",
    "Ta'Vaalor",
    "Erendiir",
    16000,
    null,
    null,
    null,
    "glass",
    "jar",
    0,
    0,
    0,
    "[]",
    "2026-07-25T00:00:00.000Z",
    "2026-07-25T01:00:00.000Z",
  );
  insSale.run(
    "g3",
    "a jar containing sapphires",
    "Solhaven",
    "Erendiir",
    5000,
    null,
    null,
    null,
    "glass",
    "jar",
    0,
    0,
    0,
    "[]",
    "2026-07-22T00:00:00.000Z",
    "2026-07-22T01:00:00.000Z",
  );
  // 2 individual gem sales
  insSale.run(
    "i1",
    "an uncut emerald",
    "Ta'Vaalor",
    "Some Shop",
    300,
    null,
    null,
    null,
    "gem",
    "gem",
    0,
    0,
    0,
    "[]",
    "2026-07-21T00:00:00.000Z",
    "2026-07-21T01:00:00.000Z",
  );
  insSale.run(
    "i2",
    "a sapphire",
    "Solhaven",
    "Another Shop",
    250,
    null,
    null,
    null,
    "gem",
    "gem",
    0,
    0,
    0,
    "[]",
    "2026-07-23T00:00:00.000Z",
    "2026-07-23T01:00:00.000Z",
  );

  const insListing = db.prepare(
    `INSERT INTO listings (gem_type, count, price_per_gem, total_price, character, shop, town, listed_date, removed_date, days_on_market, confirmed_sold)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  insListing.run(
    "uncut emeralds",
    10,
    800,
    8000,
    "Fisternar",
    "Erendiir",
    "Ta'Vaalor",
    "2026-07-18T00:00:00.000Z",
    null,
    null,
    0,
  );
  insListing.run(
    "uncut emeralds",
    20,
    800,
    16000,
    "Fisternar",
    "Erendiir",
    "Ta'Vaalor",
    "2026-07-24T00:00:00.000Z",
    "2026-07-25T00:00:00.000Z",
    1.2,
    1,
  );

  db.prepare("INSERT INTO scrape_state (key, value) VALUES ('last_scraped_at', ?)").run("2026-07-26T00:00:00.000Z");

  return db;
}
