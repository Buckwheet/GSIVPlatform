/**
 * One-off (repeatable) import of the old sales-tracker DB into the v2 pricing
 * DB. The schemas are column-for-column identical; this copies `sales`
 * (UNIQUE item_id — INSERT OR IGNORE makes it idempotent), `listings`
 * (composite existence check), and sets `scrape_state.last_scraped_at` to the
 * newest scraped_at. Run on the server with plain node:
 *
 *   node scripts/import-sales.mjs [--dry-run] [OLD_DB] [NEW_DB]
 *
 * Defaults: OLD=/opt/sales-tracker/data/sales.db
 *           NEW=$PRICING_DB_PATH or /opt/gsiv-platform/backend/data/pricing.db
 */

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

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

const SALES_COLS = [
  "item_id",
  "name",
  "town",
  "shop",
  "cost",
  "enchant",
  "worn",
  "wear_location",
  "material",
  "item_type",
  "is_weapon",
  "is_armor",
  "is_jewelry",
  "enhancives",
  "removed_date",
  "scraped_at",
];
const LISTING_COLS = [
  "gem_type",
  "count",
  "price_per_gem",
  "total_price",
  "character",
  "shop",
  "town",
  "listed_date",
  "removed_date",
  "days_on_market",
  "confirmed_sold",
];

export function importSalesDb(oldPath, newPath, { dryRun = false } = {}) {
  if (!existsSync(oldPath)) throw new Error(`old sales DB not found: ${oldPath}`);

  const oldDb = new Database(oldPath, { readonly: true });
  const newDb = new Database(newPath);
  for (const sql of PRICING_DDL) newDb.exec(sql);

  const result = { salesInserted: 0, listingsInserted: 0, lastScrapedAt: null };

  newDb.exec("BEGIN");
  try {
    // --- sales: INSERT OR IGNORE (UNIQUE item_id) ---
    const insertSale = newDb.prepare(
      `INSERT OR IGNORE INTO sales (${SALES_COLS.join(", ")}) VALUES (${SALES_COLS.map((c) => `@${c}`).join(", ")})`,
    );
    const sel = oldDb.prepare(`SELECT ${SALES_COLS.join(", ")} FROM sales`);
    for (const row of sel.iterate()) {
      result.salesInserted += insertSale.run(row).changes;
    }

    // --- listings: no unique key, so check (gem_type, character, listed_date) ---
    const existsListing = newDb.prepare(
      "SELECT 1 FROM listings WHERE gem_type = ? AND character = ? AND listed_date = ?",
    );
    const insertListing = newDb.prepare(
      `INSERT INTO listings (${LISTING_COLS.join(", ")}) VALUES (${LISTING_COLS.map((c) => `@${c}`).join(", ")})`,
    );
    const selL = oldDb.prepare(`SELECT ${LISTING_COLS.join(", ")} FROM listings`);
    for (const row of selL.iterate()) {
      if (existsListing.get(row.gem_type, row.character, row.listed_date)) continue;
      result.listingsInserted += insertListing.run(row).changes;
    }

    // --- scrape_state.last_scraped_at = newest scraped_at ---
    result.lastScrapedAt = oldDb.prepare("SELECT MAX(scraped_at) m FROM sales").get().m ?? null;
    if (result.lastScrapedAt) {
      newDb
        .prepare(
          "INSERT INTO scrape_state (key, value) VALUES ('last_scraped_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(result.lastScrapedAt);
    }

    if (dryRun) newDb.exec("ROLLBACK");
    else newDb.exec("COMMIT");
  } catch (err) {
    newDb.exec("ROLLBACK");
    oldDb.close();
    newDb.close();
    throw err;
  }

  oldDb.close();
  newDb.close();
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const rest = process.argv.filter((a) => a !== "--dry-run");
  const oldPath = rest[2] ?? "/opt/sales-tracker/data/sales.db";
  const newPath = rest[3] ?? process.env.PRICING_DB_PATH ?? "/opt/gsiv-platform/backend/data/pricing.db";
  console.log(`${dryRun ? "DRY-RUN" : "IMPORT"} ${oldPath} -> ${newPath}`);
  const res = importSalesDb(oldPath, newPath, { dryRun });
  console.log(JSON.stringify(res));
}
