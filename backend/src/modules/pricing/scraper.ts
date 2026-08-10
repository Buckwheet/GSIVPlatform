import type { PricingStore, ScrapeResult } from "./store.js";

const TRACKED_SHOPS = new Set(["Erendiir"]);
const REMOVED_URL = "https://shops.elanthia.online/data/removed_items.json";

export interface RemovedPayload {
  [town: string]: {
    id: string;
    name: string;
    details?: {
      cost?: number;
      enchant?: number | null;
      worn?: string | null;
      wear_location?: string | null;
      material?: string | null;
      item_type?: string | null;
      is_weapon?: boolean;
      is_armor?: boolean;
      is_jewelry?: boolean;
      enhancives?: unknown[];
      [key: string]: unknown;
    };
    removed_date: string;
    last_seen_shop: string;
    town: string;
  }[];
}

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export class PricingScraper {
  constructor(
    private store: PricingStore,
    private fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private url: string = REMOVED_URL,
  ) {}

  async scrapeRemoved(): Promise<ScrapeResult> {
    const db = this.store;
    const storedEtag = db.getScrapeState("etag");
    const headers: Record<string, string> = {};
    if (storedEtag) headers["If-None-Match"] = storedEtag;

    const res = await this.fetchImpl(this.url, { headers });

    if (res.status === 304) {
      return { newItems: 0, skipped: 0, errors: 0 };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const newEtag = res.headers.get("etag");
    if (newEtag) db.setScrapeState("etag", newEtag);

    const payload = (await res.json()) as RemovedPayload;
    const now = new Date().toISOString();

    let newItems = 0;
    let skipped = 0;
    let errors = 0;

    const allItems = Object.values(payload).flat();
    for (const item of allItems) {
      try {
        const d = item.details ?? {};
        const changes = db.insertSale({
          item_id: item.id,
          name: item.name,
          town: item.town,
          shop: item.last_seen_shop,
          cost: d.cost ?? null,
          enchant: d.enchant ?? null,
          worn: d.worn ?? null,
          wear_location: d.wear_location ?? null,
          material: d.material ?? null,
          item_type: d.item_type ?? null,
          is_weapon: Boolean(d.is_weapon),
          is_armor: Boolean(d.is_armor),
          is_jewelry: Boolean(d.is_jewelry),
          enhancives: JSON.stringify(d.enhancives ?? []),
          removed_date: item.removed_date,
        });
        if (changes > 0) {
          newItems++;
          if (TRACKED_SHOPS.has(item.last_seen_shop) && d.cost) {
            db.tryMatchListing(item.last_seen_shop, item.name, d.cost, item.removed_date);
          }
        } else {
          skipped++;
        }
      } catch {
        errors++;
      }
    }

    db.setScrapeState("last_scraped_at", now);
    return { newItems, skipped, errors };
  }
}
