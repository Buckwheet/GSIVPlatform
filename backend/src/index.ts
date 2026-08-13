import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { AnalysisFiles } from "./core/analysis-files.js";
import { Auth } from "./core/auth.js";
import { ConfigFiles } from "./core/config-files.js";
import { CoreDb } from "./core/db.js";
import { EntryYaml } from "./core/entry-yaml.js";
import { EventLog } from "./core/event-log.js";
import { InvDb } from "./core/inv-db.js";
import { createKV } from "./core/kv.js";
import { LichDb } from "./core/lich-db.js";
import { Registry } from "./core/registry.js";
import { Ruby } from "./core/ruby.js";
import { ScanRunner } from "./core/scan-runner.js";
import { ScriptRunner } from "./core/script-runner.js";
import { createApp } from "./core/server.js";
import { Sge } from "./core/sge.js";
import { Systemd } from "./core/systemd.js";
import { Totp } from "./core/totp.js";
import { EventBus } from "./core/ws.js";
import { createWsBridge } from "./core/ws-bridge.js";
import { createAccountsModule } from "./modules/accounts/index.js";
import { AccountsStore } from "./modules/accounts/store.js";
import { createAnalysisModule } from "./modules/analysis/index.js";
import { createCharactersModule } from "./modules/characters/index.js";
import { CharactersStore } from "./modules/characters/store.js";
import { createConfigModule } from "./modules/config/index.js";
import { createGameviewModule } from "./modules/gameview/index.js";
import { createGemsModule } from "./modules/gems/index.js";
import { GemsStore } from "./modules/gems/store.js";
import { createHealerModule } from "./modules/healer/index.js";
import { HealerStore } from "./modules/healer/store.js";
import { healthModule } from "./modules/health/index.js";
import { createInventoryModule } from "./modules/inventory/index.js";
import { InventoryDbError, InventoryStore } from "./modules/inventory/store.js";
import { createLichModule } from "./modules/lich/index.js";
import { LichStore } from "./modules/lich/store.js";
import { createLogsModule } from "./modules/logs/index.js";
import { createPricingModule } from "./modules/pricing/index.js";
import { PricingScraper } from "./modules/pricing/scraper.js";
import { PricingStore } from "./modules/pricing/store.js";
import { createScansModule } from "./modules/scans/index.js";
import { ScansStore } from "./modules/scans/store.js";
import { createYourShopsModule } from "./modules/your-shops/index.js";
import { YourShopsStore } from "./modules/your-shops/store.js";

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

// Your Shops: user's shop sales + alerts; reads pricing.db read-only.
const yourShopsDb = new CoreDb(process.env.YOURSHOPS_DB_PATH || "data/yourshops.db");
const yourShopsStore = new YourShopsStore(yourShopsDb);
yourShopsStore.seedDefaultIfEmpty();
registry.register(createYourShopsModule(yourShopsStore, pricingDb));

const kv = await createKV();

const eventBus = new EventBus();

// Gems (jar pipeline) is KV-backed operational state — always available.
const gemsStore = new GemsStore(kv);
registry.register(createGemsModule(gemsStore));

// Healer service is KV-backed operational state — always available.
const healerStore = new HealerStore(kv);
registry.register(createHealerModule(healerStore));

// Characters: entry.yaml + systemd control go through the review-gated core capabilities.
const charactersStore = new CharactersStore(kv, new EntryYaml(), new Systemd());
await charactersStore.seedManagedIfEmpty();
registry.register(createCharactersModule(charactersStore));

// Lich channel (publisher state, command dispatch, watchdog, premium) - KV-backed, always available.
const lichStore = new LichStore(kv);
registry.register(createLichModule(lichStore));

// Accounts: TOTP-gated entry.yaml mgmt + SGE scan via review-gated capabilities.
const db = new CoreDb(process.env.DB_PATH || "data/gsiv.db");
const eventLog = new EventLog(db);
registry.register(createLogsModule(eventLog));
registry.register(
  createGameviewModule({
    baseUrl: process.env.VELLUM_BASE_URL,
    streamDomain: process.env.VELLUM_STREAM_DOMAIN,
    streams: process.env.VELLUM_STREAMS,
    token: process.env.VELLUM_TOKEN,
    systemd: new Systemd(),
  }),
);
const accountsStore = new AccountsStore(db, new EntryYaml(), new Ruby(), new Sge(), new InvDb());
const totp = new Totp();
registry.register(createAccountsModule(accountsStore, totp));

// Scans: invdb scan orchestrator (5 concurrent accounts) via review-gated capabilities.
const scanRunner = new ScanRunner({
  systemd: new Systemd(),
  invDb: new InvDb(),
  sendScript: async (char, script) => {
    await lichStore.pushCommand(char, "scan", script);
  },
  isOnline: async (char) => {
    const state = await lichStore.status(char);
    return lichStore.isOnline(state);
  },
});
const scansStore = new ScansStore(
  db,
  new EntryYaml(),
  scanRunner,
  (type, payload) => eventBus.emit(type, payload),
  (type, char, detail, source) => eventLog.log(type, char, detail, source),
  {
    skipAccounts: (process.env.SCAN_SKIP_ACCOUNTS ?? "UNFOCUSEDPIE")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    classifier: accountsStore,
  },
);
registry.register(createScansModule(scansStore));

// Config: lich.db3 (go2/eherbs) + lich config dirs via review-gated capabilities.
const entryDir = dirname(process.env.ENTRY_YAML_PATH || "/opt/gs4sd/lich5/data/entry.yaml");
const configFiles = new ConfigFiles({
  gsivDir: process.env.GSIV_DATA_DIR || join(entryDir, "GSIV"),
  gstDir: join(entryDir, "GST"),
});
registry.register(createConfigModule(new LichDb(), configFiles));

// Analysis: data/log dirs + fixed server scripts via review-gated capabilities.
const analysisFiles = new AnalysisFiles({
  dataDir: process.env.ANALYSIS_DATA_DIR || "/opt/gs4sd/data",
  logDir: process.env.LICH_LOG_DIR || "/opt/gs4sd/lich5/logs",
});
registry.register(createAnalysisModule(analysisFiles, new ScriptRunner()));

registry.validate();
const auth = new Auth(kv);
auth.loadFromEnv();
const app = createApp({ registry, kv, db, auth, eventBus });
const port = Number(process.env.PORT || 3100);
const server = serve({ fetch: app.fetch, port }, () => console.log(`gsiv-platform listening on :${port}`));
createWsBridge(server, auth, eventBus);
eventLog.log("server_start", null, "gsiv-platform started");
