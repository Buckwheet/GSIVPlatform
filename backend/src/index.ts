import { serve } from "@hono/node-server";
import { Auth } from "./core/auth.js";
import { CoreDb } from "./core/db.js";
import { createKV } from "./core/kv.js";
import { Registry } from "./core/registry.js";
import { createApp } from "./core/server.js";
import { EventBus } from "./core/ws.js";
import { healthModule } from "./modules/health/index.js";
import { createInventoryModule } from "./modules/inventory/index.js";
import { InventoryDbError, InventoryStore } from "./modules/inventory/store.js";

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

registry.validate();

const kv = await createKV();
const db = new CoreDb(process.env.DB_PATH || "data/gsiv.db");
const auth = new Auth(kv);
auth.loadFromEnv();
const eventBus = new EventBus();

const app = createApp({ registry, kv, db, auth, eventBus });
const port = Number(process.env.PORT || 3100);
serve({ fetch: app.fetch, port }, () => console.log(`gsiv-platform listening on :${port}`));
