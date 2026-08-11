import { describe, expect, it } from "vitest";
import { ManifestError, type ModuleManifest, NAV_GROUPS, serializeManifest } from "../../src/core/manifest.js";
import { Registry } from "../../src/core/registry.js";
import { createAccountsModule } from "../../src/modules/accounts/index.js";
import { createAnalysisModule } from "../../src/modules/analysis/index.js";
import { createCharactersModule } from "../../src/modules/characters/index.js";
import { createConfigModule } from "../../src/modules/config/index.js";
import { createGemsModule } from "../../src/modules/gems/index.js";
import { createHealerModule } from "../../src/modules/healer/index.js";
import { healthModule } from "../../src/modules/health/index.js";
import { createInventoryModule } from "../../src/modules/inventory/index.js";
import { createPricingModule } from "../../src/modules/pricing/index.js";

/** Same registry wiring the generator script uses: dummy deps, metadata only. */
function fullRegistry(): Registry {
  const registry = new Registry();
  registry.register(healthModule);
  registry.register(createInventoryModule(undefined as never));
  registry.register(createPricingModule(undefined as never, undefined as never));
  registry.register(createGemsModule(undefined as never));
  registry.register(createHealerModule(undefined as never));
  registry.register(createCharactersModule(undefined as never));
  registry.register(createAccountsModule(undefined as never, undefined as never));
  registry.register(createConfigModule(undefined as never, undefined as never));
  registry.register(createAnalysisModule(undefined as never, undefined as never));
  registry.validate();
  return registry;
}

describe("serializeManifest", () => {
  it("emits nav items for every module with nav metadata, derived from the registry", () => {
    const m = serializeManifest(fullRegistry());
    const ids = m.navItems.map((i) => i.id);
    expect(ids).toEqual(["inventory", "gems", "healer", "pricing", "characters", "accounts", "config", "analysis"]);
    const gems = m.navItems.find((i) => i.id === "gems");
    expect(gems).toBeDefined();
    expect(gems).toMatchObject({
      path: "/jars",
      title: "Jars",
      group: "operations",
      icon: "🫙",
      requiresScopes: ["gems.read"],
    });
  });

  it("excludes API-only modules without nav metadata (health)", () => {
    const m = serializeManifest(fullRegistry());
    expect(m.navItems.some((i) => i.id === "health")).toBe(false);
  });

  it("lists every declared scope across modules", () => {
    const m = serializeManifest(fullRegistry());
    expect(m.scopes).toContain("health.read");
    expect(m.scopes).toContain("pricing.write");
    expect(m.scopes).toContain("characters.write");
  });

  it("derives requiresScopes from the module's .read scopes only", () => {
    const m = serializeManifest(fullRegistry());
    const pricing = m.navItems.find((i) => i.id === "pricing");
    expect(pricing).toBeDefined();
    expect(pricing?.requiresScopes).toEqual(["pricing.read"]);
  });

  it("orders nav items by group then order, matching NAV_GROUPS", () => {
    const m = serializeManifest(fullRegistry());
    const groups = m.navItems.map((i) => i.group);
    const rank = (g: string) => NAV_GROUPS.findIndex((x) => x.id === g);
    for (let i = 1; i < groups.length; i++) {
      const a = rank(groups[i - 1]);
      const b = rank(groups[i]);
      expect(a).toBeLessThanOrEqual(b);
    }
    const ops = m.navItems.filter((i) => i.group === "operations").map((i) => i.order);
    expect(ops).toEqual([...ops].sort((x, y) => x - y));
  });

  it("rejects a duplicate frontend path", () => {
    const registry = new Registry();
    const m: ModuleManifest = { version: 1, navGroups: [...NAV_GROUPS], navItems: [], scopes: [] };
    registry.register({
      name: "a",
      prefix: "/api/modules/a",
      scopes: [{ name: "a.read", description: "" }],
      routeScopes: { "GET /x": ["a.read"] },
      nav: { path: "/dup", title: "A", group: "operations", order: 1, icon: "a" },
      registerRoutes: () => {},
    });
    registry.register({
      name: "b",
      prefix: "/api/modules/b",
      scopes: [{ name: "b.read", description: "" }],
      routeScopes: { "GET /x": ["b.read"] },
      nav: { path: "/dup", title: "B", group: "operations", order: 2, icon: "b" },
      registerRoutes: () => {},
    });
    expect(() => serializeManifest(registry)).toThrow(ManifestError);
    void m;
  });

  it("rejects nav metadata referencing an unknown group", () => {
    const registry = new Registry();
    registry.register({
      name: "a",
      prefix: "/api/modules/a",
      scopes: [{ name: "a.read", description: "" }],
      routeScopes: { "GET /x": ["a.read"] },
      nav: { path: "/a", title: "A", group: "nope", order: 1, icon: "a" },
      registerRoutes: () => {},
    });
    expect(() => serializeManifest(registry)).toThrow(/known group/);
  });

  it("rejects nav.path '/' (reserved for the dashboard)", () => {
    const registry = new Registry();
    registry.register({
      name: "a",
      prefix: "/api/modules/a",
      scopes: [{ name: "a.read", description: "" }],
      routeScopes: { "GET /x": ["a.read"] },
      nav: { path: "/", title: "A", group: "operations", order: 1, icon: "a" },
      registerRoutes: () => {},
    });
    expect(() => serializeManifest(registry)).toThrow(/reserved for the dashboard/);
  });

  it("rejects a GET route gated by a non-.read scope (page would 403)", () => {
    const registry = new Registry();
    registry.register({
      name: "a",
      prefix: "/api/modules/a",
      scopes: [
        { name: "a.read", description: "" },
        { name: "a.write", description: "" },
      ],
      routeScopes: { "GET /x": ["a.write"] },
      nav: { path: "/a", title: "A", group: "operations", order: 1, icon: "a" },
      registerRoutes: () => {},
    });
    expect(() => serializeManifest(registry)).toThrow(/non-read scope/);
  });

  it("rejects a module with nav but no .read scope (page must be gateable)", () => {
    const registry = new Registry();
    registry.register({
      name: "a",
      prefix: "/api/modules/a",
      scopes: [{ name: "a.write", description: "" }],
      routeScopes: { "POST /x": ["a.write"] },
      nav: { path: "/a", title: "A", group: "operations", order: 1, icon: "a" },
      registerRoutes: () => {},
    });
    expect(() => serializeManifest(registry)).toThrow(/\.read scope/);
  });
});
