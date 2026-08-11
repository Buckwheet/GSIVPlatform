import type { Registry } from "./registry.js";

/**
 * Module manifest: the backend registry serialized for the frontend shell
 * (docs/design/output/01-shell-and-nav/routing.md). The frontend consumes
 * `frontend/src/generated/modules.json` (regenerated via `npm run gen:manifest`)
 * to build its nav model and route table. Validation mirrors the registry's
 * fail-fast rules — a bad nav entry is a build error, not a runtime surprise.
 */

export class ManifestError extends Error {}

/** Ordered nav groups (see nav-ia.md). "overview" holds the shell-owned dashboard item. */
export const NAV_GROUPS = [
  { id: "overview", title: "Overview" },
  { id: "operations", title: "Operations" },
  { id: "market", title: "Market" },
  { id: "people", title: "People" },
  { id: "platform", title: "Platform" },
] as const;

const NAV_GROUP_IDS = new Set<string>(NAV_GROUPS.map((g) => g.id));

export interface ManifestNavItem {
  id: string; // module name
  path: string; // frontend route, e.g. "/jars"
  title: string;
  group: string;
  order: number;
  icon: string;
  requiresScopes: string[]; // every scope a token must hold to see the page
}

export interface ModuleManifest {
  version: number;
  navGroups: { id: string; title: string }[];
  navItems: ManifestNavItem[]; // ordered by group then order
  scopes: string[]; // every scope a token can hold
}

export function serializeManifest(registry: Registry): ModuleManifest {
  const navItems: ManifestNavItem[] = [];
  const seenPaths = new Set<string>();

  for (const m of registry.list()) {
    if (!m.nav) continue; // API-only module (health): no page, no nav item
    if (!NAV_GROUP_IDS.has(m.nav.group)) {
      throw new ManifestError(`${m.name}: nav.group '${m.nav.group}' is not a known group`);
    }
    const requiresScopes = m.scopes.filter((s) => s.name.endsWith(".read")).map((s) => s.name);
    if (requiresScopes.length === 0) {
      throw new ManifestError(`${m.name}: nav requires at least one .read scope to gate the page`);
    }
    // Frontend gates nav with every-of; backend auth is any-of. Every GET route must be
    // gateable by the page's read scopes, else the page shows but its data 403s.
    for (const [key, scopes] of Object.entries(m.routeScopes)) {
      if (!key.startsWith("GET ")) continue;
      for (const scope of scopes) {
        if (!requiresScopes.includes(scope)) {
          throw new ManifestError(
            `${m.name}: GET route ${key} gated by non-read scope '${scope}' — not gateable by the page`,
          );
        }
      }
    }
    const path = m.nav.path.startsWith("/") ? m.nav.path : `/${m.nav.path}`;
    if (path === "/") {
      throw new ManifestError(`${m.name}: nav.path '/' is reserved for the dashboard`);
    }
    if (seenPaths.has(path)) {
      throw new ManifestError(`duplicate nav path: ${path}`);
    }
    seenPaths.add(path);
    navItems.push({
      id: m.name,
      path,
      title: m.nav.title,
      group: m.nav.group,
      order: m.nav.order,
      icon: m.nav.icon,
      requiresScopes,
    });
  }

  navItems.sort((a, b) => {
    const ga = NAV_GROUPS.findIndex((g) => g.id === a.group);
    const gb = NAV_GROUPS.findIndex((g) => g.id === b.group);
    return ga !== gb ? ga - gb : a.order - b.order;
  });

  const scopes = registry.list().flatMap((m) => m.scopes.map((s) => s.name));
  return { version: 1, navGroups: [...NAV_GROUPS], navItems, scopes };
}
