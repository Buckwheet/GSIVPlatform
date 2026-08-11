/**
 * Regenerates frontend/src/generated/modules.json from the backend registry.
 *
 * The registry is the single source of truth for modules (routing.md §1); this
 * script serializes it with the module factories instantiated with dummy deps —
 * the factories are pure metadata at call time and never touch stores until
 * registerRoutes runs. Run `npm run gen:manifest` from backend/; commit the
 * generated file so frontend builds don't need a backend.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeManifest } from "../src/core/manifest.js";
import { Registry } from "../src/core/registry.js";
import { createAccountsModule } from "../src/modules/accounts/index.js";
import { createAnalysisModule } from "../src/modules/analysis/index.js";
import { createCharactersModule } from "../src/modules/characters/index.js";
import { createConfigModule } from "../src/modules/config/index.js";
import { createGemsModule } from "../src/modules/gems/index.js";
import { createHealerModule } from "../src/modules/healer/index.js";
import { healthModule } from "../src/modules/health/index.js";
import { createInventoryModule } from "../src/modules/inventory/index.js";
import { createLogsModule } from "../src/modules/logs/index.js";
import { createPricingModule } from "../src/modules/pricing/index.js";

const registry = new Registry();
registry.register(healthModule);
registry.register(createLogsModule(undefined as never));
registry.register(createInventoryModule(undefined as never));
registry.register(createPricingModule(undefined as never, undefined as never));
registry.register(createGemsModule(undefined as never));
registry.register(createHealerModule(undefined as never));
registry.register(createCharactersModule(undefined as never));
registry.register(createAccountsModule(undefined as never, undefined as never));
registry.register(createConfigModule(undefined as never, undefined as never));
registry.register(createAnalysisModule(undefined as never, undefined as never));
registry.validate();

const manifest = serializeManifest(registry);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "src", "generated", "modules.json");
mkdirSync(dirname(out), { recursive: true });
// Atomic: write temp then rename so a mid-write crash never truncates the committed file.
const tmp = `${out}.tmp`;
writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
renameSync(tmp, out);
console.log(`wrote ${out} (${manifest.navItems.length} nav items, ${manifest.scopes.length} scopes)`);
