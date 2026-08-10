import type Database from "better-sqlite3";
import type { CoreDb } from "../../core/db.js";

// ---------------------------------------------------------------------------
// Types (ported from sales-tracker)
// ---------------------------------------------------------------------------

export interface ScrapeResult {
  newItems: number;
  skipped: number;
  errors: number;
}

export interface Listing {
  id: number;
  gem_type: string;
  count: number;
  price_per_gem: number;
  total_price: number;
  character: string;
  shop: string;
  town: string | null;
  listed_date: string;
  removed_date: string | null;
  days_on_market: number | null;
  confirmed_sold: number;
}

export interface CreateListingInput {
  gem_type: string;
  count: number;
  price_per_gem: number;
  total_price: number;
  character: string;
  shop: string;
  town?: string;
}

export interface SalesFilter {
  q?: string;
  town?: string;
  shop?: string;
  min_cost?: number;
  max_cost?: number;
  min_enchant?: number;
  enhancive?: string;
  is_weapon?: boolean;
  is_armor?: boolean;
  is_jewelry?: boolean;
  days?: number;
  page?: number;
  limit?: number;
}

export interface GemTypeSummary {
  gem_type: string;
  jar_sales: number;
  individual_sales: number;
  market_price_per_gem: number | null;
  avg_implied_price: number;
  min_price: number;
  max_price: number;
  total_gems_sold: number;
  last_sale: string;
  first_sale: string;
  jars_per_week: number;
  roi_score: number;
}

export interface GemSale {
  id: number;
  name: string;
  gem_type: string;
  cost: number;
  town: string;
  shop: string;
  removed_date: string;
  estimated_count: number;
  implied_price_per_gem: number;
  confidence: number;
  market_price_per_gem: number | null;
}

// ---------------------------------------------------------------------------
// Gem-type helpers (ported from sales-tracker gems.ts)
// ---------------------------------------------------------------------------

const GEM_TYPE_EXCLUSIONS = new Set([
  "essences of fire",
  "some minor holy oil",
  "wormwoods",
  "frosted rhimar nuggets",
  "large platinum nuggets",
  "chunks of age-darkened ivory",
  "pristine sprite's hairs",
  "ayanad crystals",
  "s'ayanad crystals",
  "t'ayanad crystals",
]);

const ROUND_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];

function isExcluded(gemType: string): boolean {
  return GEM_TYPE_EXCLUSIONS.has(gemType.toLowerCase());
}

function extractGemType(name: string): string | null {
  const m = name.match(/containing\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function estimateCount(price: number, pricePerGem: number): { count: number; confidence: number } {
  const naive = price / pricePerGem;
  const STANDARD_COUNTS = [10, 20];

  let bestCount = 10;
  let standardErr = Infinity;
  for (const c of STANDARD_COUNTS) {
    const err = Math.abs(price / c - pricePerGem);
    if (err < standardErr) {
      standardErr = err;
      bestCount = c;
    }
  }

  const standardDeviation = standardErr / pricePerGem;

  if (standardDeviation > 0.2) {
    let minError = standardErr;
    for (const c of ROUND_COUNTS) {
      const err = Math.abs(price / c - pricePerGem);
      if (err < minError) {
        minError = err;
        bestCount = c;
      }
    }
    for (let c = Math.max(1, Math.floor(naive) - 2); c <= Math.min(100, Math.ceil(naive) + 2); c++) {
      const err = Math.abs(price / c - pricePerGem);
      if (err < minError) {
        minError = err;
        bestCount = c;
      }
    }
  }

  const deviation = Math.abs(price / bestCount - pricePerGem) / pricePerGem;
  return { count: bestCount, confidence: Math.max(0, 1 - deviation) };
}

// ---------------------------------------------------------------------------
// PricingStore
// ---------------------------------------------------------------------------

export class PricingStore {
  private db: Database.Database;

  constructor(db: CoreDb) {
    this.db = db.get();
    db.migrate("pricing", [
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
    ]);
  }

  // --- helpers exposed for testing ---
  estimateCount(price: number, pricePerGem: number): { count: number; confidence: number } {
    return estimateCount(price, pricePerGem);
  }

  // --- status / towns ---
  status(): { last_scraped_at: string | null; total_sales: number } {
    const last =
      (
        this.db.prepare("SELECT value FROM scrape_state WHERE key = 'last_scraped_at'").get() as
          | { value: string }
          | undefined
      )?.value ?? null;
    const total = (this.db.prepare("SELECT COUNT(*) as n FROM sales").get() as { n: number }).n;
    return { last_scraped_at: last, total_sales: total };
  }

  towns(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT town FROM sales ORDER BY town").all() as { town: string }[];
    return rows.map((r) => r.town);
  }

  // --- sales search (ported from v1 /api/sales) ---
  searchSales(f: SalesFilter): { total: number; page: number; limit: number; sales: Record<string, unknown>[] } {
    const wheres: string[] = [];
    const params: (string | number)[] = [];

    if (f.q) {
      wheres.push("name LIKE ?");
      params.push(`%${f.q}%`);
    }
    if (f.town) {
      wheres.push("town = ?");
      params.push(f.town);
    }
    if (f.shop) {
      wheres.push("shop = ?");
      params.push(f.shop);
    }
    if (f.min_cost !== undefined) {
      wheres.push("cost >= ?");
      params.push(f.min_cost);
    }
    if (f.max_cost !== undefined) {
      wheres.push("cost <= ?");
      params.push(f.max_cost);
    }
    if (f.min_enchant !== undefined) {
      wheres.push("enchant >= ?");
      params.push(f.min_enchant);
    }
    if (f.enhancive) {
      wheres.push("enhancives LIKE ?");
      params.push(`%${f.enhancive}%`);
    }
    if (f.is_weapon) wheres.push("is_weapon = 1");
    if (f.is_armor) wheres.push("is_armor = 1");
    if (f.is_jewelry) wheres.push("is_jewelry = 1");
    if (f.days) {
      const cutoff = new Date(Date.now() - f.days * 86400_000).toISOString();
      wheres.push("removed_date >= ?");
      params.push(cutoff);
    }

    const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    const page = Math.max(1, f.page || 1);
    const limit = Math.min(200, Math.max(1, f.limit || 50));
    const offset = (page - 1) * limit;

    const sales = this.db
      .prepare(`SELECT * FROM sales ${where} ORDER BY removed_date DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM sales ${where}`).get(...params) as { n: number }).n;

    return { total, page, limit, sales };
  }

  // --- gem market price helpers (ported from v1 gems.ts) ---
  private getMarketPrice(gemType: string): number | null {
    const typeLower = gemType.toLowerCase();
    const singular = typeLower.replace(/s$/, "").replace(/es$/, "");
    const candidates = [typeLower, singular].flatMap((t) => [`an ${t}`, `a ${t}`]);

    for (const candidate of candidates) {
      const rows = this.db
        .prepare(
          `SELECT cost FROM sales
           WHERE LOWER(name) = ? AND name NOT LIKE '%containing%' AND name NOT LIKE '%jar%'
             AND name NOT LIKE '%bottle%' AND cost < 100000
           ORDER BY cost`,
        )
        .all(candidate) as { cost: number }[];
      if (rows.length) return rows[Math.floor(rows.length / 2)].cost;
    }

    const words = singular.split(" ").filter((w) => w.length > 3);
    if (words.length) {
      const likeClause = words.map(() => `LOWER(name) LIKE ?`).join(" AND ");
      const params = words.map((w) => `%${w}%`);
      const rows = this.db
        .prepare(
          `SELECT cost FROM sales
           WHERE ${likeClause} AND name NOT LIKE '%containing%' AND name NOT LIKE '%jar%'
             AND name NOT LIKE '%bottle%' AND cost < 100000
           ORDER BY cost`,
        )
        .all(...params) as { cost: number }[];
      if (rows.length) return rows[Math.floor(rows.length / 2)].cost;
    }
    return null;
  }

  private inferPerGemPrice(jarPrice: number): number {
    const COMMON_RATES = [
      1000, 1500, 1800, 2000, 2500, 2900, 3000, 3500, 4000, 5000, 6500, 6750, 7000, 8500, 9000, 10000, 12000,
    ];
    const STANDARD_COUNTS = [10, 20];
    const EXTENDED_COUNTS = [5, 25, 50, 100, 15, 12, 8, 9, 7, 6, 30, 4, 3, 40, 75, 2, 1];

    const bestForCount = (count: number): { rate: number; err: number } => {
      const implied = jarPrice / count;
      let nearestRate = COMMON_RATES[0];
      let nearestDist = Math.abs(implied - COMMON_RATES[0]);
      for (const r of COMMON_RATES) {
        const d = Math.abs(implied - r);
        if (d < nearestDist) {
          nearestDist = d;
          nearestRate = r;
        }
      }
      return { rate: nearestRate, err: Math.abs(jarPrice - count * nearestRate) };
    };

    let bestRate = 2000;
    let bestErr = Infinity;
    for (const count of STANDARD_COUNTS) {
      const { rate, err } = bestForCount(count);
      if (err < bestErr) {
        bestErr = err;
        bestRate = rate;
      }
    }
    if (bestErr / jarPrice < 0.15) return bestRate;

    for (const count of EXTENDED_COUNTS) {
      const { rate, err } = bestForCount(count);
      if (err < bestErr) {
        bestErr = err;
        bestRate = rate;
      }
      if (bestErr === 0) break;
    }
    return bestRate;
  }

  private weekStart(dateStr: string): string {
    const d = new Date(dateStr);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  }

  gemTypes(): GemTypeSummary[] {
    const jarSales = this.db
      .prepare(
        `SELECT id, name, cost, town, shop, removed_date FROM sales
         WHERE name LIKE '%containing %' ORDER BY removed_date DESC`,
      )
      .all() as { id: number; name: string; cost: number; town: string; shop: string; removed_date: string }[];

    const byType = new Map<string, typeof jarSales>();
    for (const sale of jarSales) {
      const gt = extractGemType(sale.name);
      if (!gt || isExcluded(gt)) continue;
      if (!byType.has(gt)) byType.set(gt, []);
      const bucket = byType.get(gt);
      if (bucket) bucket.push(sale);
    }

    const summaries: GemTypeSummary[] = [];
    for (const [gem_type, sales] of byType) {
      const rawMarketPrice = this.getMarketPrice(gem_type);
      const marketPrice = (() => {
        if (!rawMarketPrice) return null;
        const feasible = sales.filter((s) => Math.round(s.cost / rawMarketPrice) >= 1).length;
        return feasible >= sales.length * 0.5 ? rawMarketPrice : null;
      })();

      let totalGems = 0;
      const impliedPrices: number[] = [];
      let individualCount = 0;

      for (const sale of sales) {
        const ref = marketPrice ?? this.inferPerGemPrice(sale.cost);
        const { count } = estimateCount(sale.cost, ref);
        totalGems += count;
        impliedPrices.push(sale.cost / count);
      }
      if (marketPrice !== null) {
        const typeLower = gem_type.toLowerCase();
        const singular = typeLower.replace(/s$/, "").replace(/es$/, "");
        for (const prefix of ["an", "a"]) {
          const n = (
            this.db
              .prepare(
                `SELECT COUNT(*) as n FROM sales WHERE LOWER(name) = ? AND name NOT LIKE '%containing%'
                 AND name NOT LIKE '%jar%' AND name NOT LIKE '%bottle%'`,
              )
              .get(`${prefix} ${singular}`) as { n: number }
          ).n;
          individualCount += n;
        }
      }

      const avgImplied = impliedPrices.reduce((a, b) => a + b, 0) / impliedPrices.length;
      const costs = sales.map((s) => s.cost);
      const first_sale = sales[sales.length - 1].removed_date;
      const last_sale = sales[0].removed_date;
      const spanDays = Math.max(7, (Date.now() - new Date(first_sale).getTime()) / 86400000);
      const jars_per_week = Math.round((sales.length / (spanDays / 7)) * 10) / 10;
      const rate = marketPrice ?? Math.round(avgImplied);
      const roi_score = Math.round(jars_per_week * rate);

      summaries.push({
        gem_type,
        jar_sales: sales.length,
        individual_sales: individualCount,
        market_price_per_gem: marketPrice,
        avg_implied_price: Math.round(avgImplied),
        min_price: Math.min(...costs),
        max_price: Math.max(...costs),
        total_gems_sold: totalGems,
        last_sale,
        first_sale,
        jars_per_week,
        roi_score,
      });
    }

    return summaries.sort((a, b) => b.jar_sales - a.jar_sales);
  }

  gemSales(gemType?: string, limit = 100, offset = 0): { sales: GemSale[]; total: number } {
    const whereClause = gemType
      ? `WHERE name LIKE '%containing %' AND name LIKE '%${gemType.replace(/'/g, "''")}%'`
      : `WHERE name LIKE '%containing %'`;

    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM sales ${whereClause}`).get() as { n: number }).n;
    const rows = this.db
      .prepare(
        `SELECT id, name, cost, town, shop, removed_date FROM sales ${whereClause}
         ORDER BY removed_date DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as {
      id: number;
      name: string;
      cost: number;
      town: string;
      shop: string;
      removed_date: string;
    }[];

    const gemTypes = new Set(rows.map((r) => extractGemType(r.name)).filter(Boolean) as string[]);
    const marketPriceCache = new Map<string, number | null>();
    for (const gt of gemTypes) marketPriceCache.set(gt, this.getMarketPrice(gt));

    const sales: GemSale[] = rows
      .filter((row) => {
        const gt = extractGemType(row.name);
        return !gt || !isExcluded(gt);
      })
      .map((row) => {
        const gem_type = extractGemType(row.name) ?? "";
        const marketPrice = marketPriceCache.get(gem_type) ?? null;
        const refPrice = marketPrice ?? this.inferPerGemPrice(row.cost);
        const { count, confidence } = estimateCount(row.cost, refPrice);
        return {
          id: row.id,
          name: row.name,
          gem_type,
          cost: row.cost,
          town: row.town,
          shop: row.shop,
          removed_date: row.removed_date,
          estimated_count: count,
          implied_price_per_gem: Math.round(row.cost / count),
          confidence,
          market_price_per_gem: marketPrice,
        };
      });

    return { sales, total };
  }

  gemIntelligence(gemType: string): Record<string, unknown> {
    const rows = this.db
      .prepare(
        `SELECT id, name, cost, town, shop, removed_date FROM sales
         WHERE name LIKE ? ORDER BY removed_date DESC`,
      )
      .all(`%containing ${gemType}%`) as {
      id: number;
      name: string;
      cost: number;
      town: string;
      shop: string;
      removed_date: string;
    }[];

    const rawMarket = this.getMarketPrice(gemType);
    const marketPrice = (() => {
      if (!rawMarket || !rows.length) return null;
      const feasible = rows.filter((r) => Math.round(r.cost / rawMarket) >= 1).length;
      return feasible >= rows.length * 0.5 ? rawMarket : null;
    })();

    interface PS {
      cost: number;
      town: string;
      shop: string;
      removed_date: string;
      count: number;
      per_gem: number;
    }
    const processed: PS[] = rows.map((row) => {
      const ref = marketPrice ?? this.inferPerGemPrice(row.cost);
      const { count } = estimateCount(row.cost, ref);
      return {
        cost: row.cost,
        town: row.town,
        shop: row.shop,
        removed_date: row.removed_date,
        count,
        per_gem: Math.round(row.cost / count),
      };
    });

    if (!processed.length) {
      return {
        gem_type: gemType,
        summary: {
          market_price: null,
          total_jars: 0,
          total_gems: 0,
          price_trend: "stable",
          last_sale: null,
          velocity_days: null,
          avg_per_gem_30d: null,
        },
        weekly_trends: [],
        jar_size_distribution: [],
        top_shops: [],
        town_breakdown: [],
        price_distribution: [],
        strategy: {
          undercut_price: null,
          optimal_jar_size: 10,
          best_town: null,
          competition_level: "low",
          floor_price: null,
        },
      };
    }

    const weekMap = new Map<string, { gems: number; jars: number; prices: number[] }>();
    for (const s of processed) {
      const key = this.weekStart(s.removed_date);
      if (!weekMap.has(key)) weekMap.set(key, { gems: 0, jars: 0, prices: [] });
      const w = weekMap.get(key);
      if (!w) continue;
      w.gems += s.count;
      w.jars++;
      w.prices.push(s.per_gem);
    }
    const weekly_trends = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, d]) => ({
        week,
        avg_per_gem: Math.round(d.prices.reduce((a, b) => a + b, 0) / d.prices.length),
        jars_sold: d.jars,
        gems_sold: d.gems,
      }));

    const sizeMap = new Map<number, number>();
    for (const s of processed) sizeMap.set(s.count, (sizeMap.get(s.count) || 0) + 1);
    const jar_size_distribution = [...sizeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([count, frequency]) => ({ count, frequency }));

    const shopMap = new Map<string, { town: string; sales: number; prices: number[]; last_seen: string }>();
    for (const s of processed) {
      const key = `${s.shop}||${s.town}`;
      if (!shopMap.has(key)) shopMap.set(key, { town: s.town, sales: 0, prices: [], last_seen: s.removed_date });
      const v = shopMap.get(key);
      if (!v) continue;
      v.sales++;
      v.prices.push(s.per_gem);
      if (s.removed_date > v.last_seen) v.last_seen = s.removed_date;
    }
    const top_shops = [...shopMap.entries()]
      .map(([key, v]) => ({
        shop: key.split("||")[0],
        town: v.town,
        sales: v.sales,
        avg_per_gem: Math.round(v.prices.reduce((a, b) => a + b, 0) / v.prices.length),
        last_seen: v.last_seen,
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    const townMap = new Map<string, number>();
    for (const s of processed) townMap.set(s.town, (townMap.get(s.town) || 0) + 1);
    const town_breakdown = [...townMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([town, sales]) => ({ town, sales, pct: Math.round((sales / processed.length) * 100) }));

    const prices = processed.map((s) => s.per_gem);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const rawBucket = Math.round((maxP - minP) / 8 / 500) * 500;
    const bucketSize = Math.max(500, rawBucket) || 1000;
    const bucketMap = new Map<number, number>();
    for (const p of prices) {
      const b = Math.floor(p / bucketSize) * bucketSize;
      bucketMap.set(b, (bucketMap.get(b) || 0) + 1);
    }
    const price_distribution = [...bucketMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, count]) => ({ floor, ceiling: floor + bucketSize, count }));

    let price_trend: "rising" | "falling" | "stable" = "stable";
    if (weekly_trends.length >= 4) {
      const r = weekly_trends.slice(-4).map((w) => w.avg_per_gem);
      const o = weekly_trends.slice(-8, -4).map((w) => w.avg_per_gem);
      if (o.length >= 2) {
        const rAvg = r.reduce((a, b) => a + b, 0) / r.length;
        const oAvg = o.reduce((a, b) => a + b, 0) / o.length;
        const chg = (rAvg - oAvg) / oAvg;
        if (chg > 0.05) price_trend = "rising";
        else if (chg < -0.05) price_trend = "falling";
      }
    }

    let velocity_days: number | null = null;
    if (processed.length >= 2) {
      const dates = processed.map((s) => new Date(s.removed_date).getTime()).sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < Math.min(dates.length, 31); i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
      velocity_days = Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
    }

    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const r30 = processed.filter((s) => s.removed_date >= cutoff30);
    const avg_per_gem_30d = r30.length ? Math.round(r30.reduce((a, s) => a + s.per_gem, 0) / r30.length) : null;

    const recent20 = processed.slice(0, 20);
    const floorPrice = recent20.length ? Math.min(...recent20.map((s) => s.per_gem)) : null;
    const undercut_price = floorPrice ? Math.max(Math.round((floorPrice * 0.95) / 100) * 100, 100) : null;

    return {
      gem_type: gemType,
      summary: {
        market_price: marketPrice,
        total_jars: processed.length,
        total_gems: processed.reduce((a, s) => a + s.count, 0),
        price_trend,
        last_sale: processed[0]?.removed_date ?? null,
        velocity_days,
        avg_per_gem_30d,
      },
      weekly_trends,
      jar_size_distribution,
      top_shops,
      town_breakdown,
      price_distribution,
      strategy: {
        undercut_price,
        optimal_jar_size: jar_size_distribution[0]?.count ?? 10,
        best_town: town_breakdown[0]?.town ?? null,
        competition_level: top_shops.length >= 6 ? "high" : top_shops.length >= 3 ? "medium" : "low",
        floor_price: floorPrice,
      },
    };
  }

  priceRecommendation(gemType: string, count: number): Record<string, unknown> {
    const now = Date.now();
    const rows = this.db
      .prepare(
        `SELECT cost, removed_date, shop FROM sales
         WHERE name LIKE ? ORDER BY removed_date DESC LIMIT 200`,
      )
      .all(`%containing ${gemType}%`) as { cost: number; removed_date: string; shop: string }[];

    const marketPrice = this.getMarketPrice(gemType);

    const weighted: { price: number; weight: number; removed_date: string }[] = [];
    for (const row of rows) {
      const ref = marketPrice ?? this.inferPerGemPrice(row.cost);
      const { count: estCount } = estimateCount(row.cost, ref);
      const perGem = Math.round(row.cost / estCount);
      const ageMs = now - new Date(row.removed_date).getTime();
      const ageDays = ageMs / 86400000;
      const weight = ageDays <= 7 ? 3 : ageDays <= 30 ? 2 : 1;
      weighted.push({ price: perGem, weight, removed_date: row.removed_date });
    }

    if (!weighted.length) {
      return {
        gem_type: gemType,
        count,
        price_per_gem: 0,
        total_price: 0,
        confidence: "low",
        basis: "no data",
        sample_size: 0,
        trend: "stable",
        last_sale: null,
      };
    }

    const expanded = weighted.flatMap((w) => Array(w.weight).fill(w.price) as number[]);
    expanded.sort((a, b) => a - b);
    const median = expanded[Math.floor(expanded.length / 2)];

    const recent7 = weighted
      .filter((w) => now - new Date(w.removed_date).getTime() <= 7 * 86400000)
      .map((w) => w.price);
    const recent30 = weighted
      .filter((w) => now - new Date(w.removed_date).getTime() <= 30 * 86400000)
      .map((w) => w.price);
    let trend: "rising" | "falling" | "stable" = "stable";
    if (recent7.length >= 2 && recent30.length >= 2) {
      const med7 = [...recent7].sort((a, b) => a - b)[Math.floor(recent7.length / 2)];
      const med30 = [...recent30].sort((a, b) => a - b)[Math.floor(recent30.length / 2)];
      const delta = (med7 - med30) / med30;
      if (delta > 0.05) trend = "rising";
      else if (delta < -0.05) trend = "falling";
    }

    const prices = weighted.map((w) => w.price);
    const spread = (Math.max(...prices) - Math.min(...prices)) / median;
    const sampleSize = weighted.length;
    let confidence: "high" | "medium" | "low";
    if (sampleSize >= 5 && spread < 0.3) confidence = "high";
    else if (sampleSize >= 3 && spread < 0.6) confidence = "medium";
    else confidence = "low";

    const recentShops = new Set(
      rows
        .filter((r) => now - new Date(r.removed_date).getTime() <= 30 * 86400000)
        .map((r) => r.shop)
        .filter(Boolean),
    );
    const competitionLevel = recentShops.size >= 6 ? "high" : recentShops.size >= 3 ? "medium" : "low";

    const recent20Prices = weighted
      .slice(0, 20)
      .map((w) => w.price)
      .sort((a, b) => a - b);
    const p20idx = Math.floor(recent20Prices.length * 0.2);
    const floorPrice = recent20Prices.length ? recent20Prices[p20idx] : null;

    const undercutPrice = floorPrice ? Math.max(Math.round((floorPrice * 0.98) / 100) * 100, 100) : null;

    let recommendedPrice: number;
    let basis: string;
    if (competitionLevel === "high" && trend !== "rising" && undercutPrice) {
      recommendedPrice = undercutPrice;
      basis = `undercut (${recentShops.size} competitors, ${trend} trend, floor ${floorPrice})`;
    } else if (competitionLevel === "high" && trend === "rising" && floorPrice) {
      recommendedPrice = Math.round(floorPrice / 100) * 100;
      basis = `floor price (${recentShops.size} competitors, rising trend)`;
    } else {
      recommendedPrice = Math.round(median / 100) * 100;
      basis = `weighted median of ${sampleSize} jar sales (${competitionLevel} competition)`;
    }

    return {
      gem_type: gemType,
      count,
      price_per_gem: recommendedPrice,
      total_price: recommendedPrice * count,
      confidence,
      basis,
      sample_size: sampleSize,
      trend,
      last_sale: weighted[0]?.removed_date ?? null,
    };
  }

  // --- listings (ported from v1 listings.ts) ---
  createListing(input: CreateListingInput): Listing {
    const listed_date = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO listings (gem_type, count, price_per_gem, total_price, character, shop, town, listed_date)
         VALUES (@gem_type, @count, @price_per_gem, @total_price, @character, @shop, @town, @listed_date)`,
      )
      .run({ ...input, town: input.town ?? null, listed_date });
    return this.db.prepare(`SELECT * FROM listings WHERE id = ?`).get(result.lastInsertRowid) as Listing;
  }

  getListings(shop?: string, limit = 100, offset = 0): { listings: Listing[]; total: number } {
    const where = shop ? `WHERE shop = ?` : "";
    const params = shop ? [shop] : [];
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM listings ${where}`).get(...params) as { n: number }).n;
    const listings = this.db
      .prepare(`SELECT * FROM listings ${where} ORDER BY listed_date DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Listing[];
    return { listings, total };
  }

  sellThroughStats(shop: string): Record<string, unknown> | null {
    const now = Date.now();
    const all = this.db
      .prepare(`SELECT * FROM listings WHERE shop = ? ORDER BY listed_date DESC`)
      .all(shop) as Listing[];
    if (!all.length) return null;

    const sold = all.filter(
      (l): l is Listing & { removed_date: string; days_on_market: number | null } =>
        l.confirmed_sold === 1 && l.removed_date !== null,
    );
    const unsold = all.filter((l) => !l.confirmed_sold);

    const domValues = sold.map((l) => l.days_on_market).filter((d): d is number => d !== null);
    const avgDom = domValues.length ? domValues.reduce((a, b) => a + b, 0) / domValues.length : null;
    const medDom = domValues.length ? [...domValues].sort((a, b) => a - b)[Math.floor(domValues.length / 2)] : null;

    const ms30 = 30 * 86400000;
    const sold30d = sold.filter((l) => now - new Date(l.removed_date).getTime() <= ms30).length;
    const sellRate30d = +(sold30d / (30 / 7)).toFixed(1);
    const soldAvgPpg = sold.length ? Math.round(sold.reduce((a, l) => a + l.price_per_gem, 0) / sold.length) : null;

    const weekMap = new Map<string, { sold: number; revenue: number }>();
    for (const l of sold) {
      const d = new Date(l.removed_date);
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
      const w = d.toISOString().slice(0, 10);
      if (!weekMap.has(w)) weekMap.set(w, { sold: 0, revenue: 0 });
      const weekEntry = weekMap.get(w);
      if (!weekEntry) continue;
      weekEntry.sold++;
      const weekEntry2 = weekMap.get(w);
      if (!weekEntry2) continue;
      weekEntry2.revenue += l.total_price;
    }
    const weekly = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v }));

    const cutoff2w = now - 14 * 86400000;
    const cutoff4w = now - 28 * 86400000;
    const last2w = sold.filter((l) => new Date(l.removed_date).getTime() >= cutoff2w).length;
    const prev2w = sold.filter((l) => {
      const t = new Date(l.removed_date).getTime();
      return t >= cutoff4w && t < cutoff2w;
    }).length;
    const velocitySignal =
      prev2w === 0 ? "new" : last2w > prev2w * 1.1 ? "up" : last2w < prev2w * 0.9 ? "down" : "flat";

    return {
      total_listed: all.length,
      total_sold: sold.length,
      total_pending: unsold.length,
      sell_rate_30d: sellRate30d,
      avg_days_on_market: avgDom !== null ? +avgDom.toFixed(1) : null,
      median_days_on_market: medDom !== null ? +medDom.toFixed(1) : null,
      avg_price_per_gem_sold: soldAvgPpg,
      velocity_signal: velocitySignal,
      last2w_sold: last2w,
      prev2w_sold: prev2w,
      weekly,
    };
  }

  /** Scraper support: store ETag / last-scraped timestamp. */
  setScrapeState(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO scrape_state (key, value) VALUES (?, ?)").run(key, value);
  }

  getScrapeState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM scrape_state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  /** Scraper support: INSERT OR IGNORE a removed sale; returns 1 if new. */
  insertSale(sale: {
    item_id: string;
    name: string;
    town: string;
    shop: string;
    cost: number | null;
    enchant: number | null;
    worn: string | null;
    wear_location: string | null;
    material: string | null;
    item_type: string | null;
    is_weapon: boolean;
    is_armor: boolean;
    is_jewelry: boolean;
    enhancives: string;
    removed_date: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO sales
         (item_id, name, town, shop, cost, enchant, worn, wear_location, material, item_type,
          is_weapon, is_armor, is_jewelry, enhancives, removed_date, scraped_at)
         VALUES (@item_id, @name, @town, @shop, @cost, @enchant, @worn, @wear_location, @material, @item_type,
          @is_weapon, @is_armor, @is_jewelry, @enhancives, @removed_date, @scraped_at)`,
      )
      .run({
        ...sale,
        is_weapon: sale.is_weapon ? 1 : 0,
        is_armor: sale.is_armor ? 1 : 0,
        is_jewelry: sale.is_jewelry ? 1 : 0,
        scraped_at: new Date().toISOString(),
      });
    return result.changes;
  }

  /** Scraper support: match a removed item to an unconfirmed listing (v1 tryMatchListing). */
  tryMatchListing(shop: string, itemName: string, totalPrice: number, removedDate: string): boolean {
    const m = itemName.match(/containing\s+(.+)$/i);
    if (!m) return false;
    const gemType = m[1].trim();
    const listing = this.db
      .prepare(
        `SELECT * FROM listings
         WHERE shop = ? AND gem_type = ? AND total_price = ? AND confirmed_sold = 0
         ORDER BY listed_date ASC LIMIT 1`,
      )
      .get(shop, gemType, totalPrice) as Listing | undefined;
    if (!listing) return false;

    const listedMs = new Date(listing.listed_date).getTime();
    const removedMs = new Date(removedDate).getTime();
    const daysOnMarket = Math.max(0, (removedMs - listedMs) / 86400000);
    this.db
      .prepare(`UPDATE listings SET confirmed_sold = 1, removed_date = ?, days_on_market = ? WHERE id = ?`)
      .run(removedDate, +daysOnMarket.toFixed(2), listing.id);
    return true;
  }
}
