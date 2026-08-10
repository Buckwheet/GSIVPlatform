import { serve } from "@hono/node-server";
import { Auth } from "./core/auth.js";
import { CoreDb } from "./core/db.js";
import { createKV } from "./core/kv.js";
import { Registry } from "./core/registry.js";
import { createApp } from "./core/server.js";
import { EventBus } from "./core/ws.js";
import { createGemsModule } from "./modules/gems/index.js";
import { GemsStore } from "./modules/gems/store.js";
import { createHealerModule } from "./modules/healer/index.js";
import { HealerStore } from "./modules/healer/store.js";
import { healthModule } from "./modules/health/index.js";
import { createInventoryModule } from "./modules/inventory/index.js";
import { InventoryDbError, InventoryStore } from "./modules/inventory/store.js";
import { createPricingModule } from "./modules/pricing/index.js";
import { PricingScraper } from "./modules/pricing/scraper.js";
import { PricingStore } from "./modules/pricing/store.js";

const registry = new Registry();
registry.register(healthModule);

// Inventory is optional: skip only when the DB file is missing; any other
// open failure (permission, corruption, bad path) is a real error and must crash.
try {
  const inventoryStore = new InventoryStore();
  registry.register(createInventoryModule(inventoryStore));
} catch (err) {
  if (err instanceof InventoryDbError && /no such file|unable to open database file/i.test(err.message)) {
    console.warn(`inventory module skipped: ${err.message}`);
  } else {
    throw err;
  }
}

// Pricing is a core service: DB open failure is fatal (unlike optional inventory).
const pricingDb = new CoreDb(process.env.PRICING_DB_PATH || "data/pricing.db");
const pricingStore = new PricingStore(pricingDb);
const pricingScraper = new PricingScraper(pricingStore);
registry.register(createPricingModule(pricingStore, pricingScraper));

const kv = await createKV();

// Gems (jar pipeline) is KV-backed operational state — always available.
const gemsStore = new GemsStore(kv);
registry.register(createGemsModule(gemsStore));

// Healer service is KV-backed operational state — always available.
const healerStore = new HealerStore(kv);
registry.register(createHealerModule(healerStore));

registry.validate();

const db = new CoreDb(process.env.DB_PATH || "data/gsiv.db");
const auth = new Auth(kv);
auth.loadFromEnv();
const eventBus = new EventBus();

const app = createApp({ registry, kv, db, auth, eventBus });
const port = Number(process.env.PORT || 3100);
serve({ fetch: app.fetch, port }, () => console.log(`gsiv-platform listening on :${port}`));
