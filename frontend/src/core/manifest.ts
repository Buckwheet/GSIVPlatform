import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { AuthState } from "./auth";
import type { NavGroup, NavItem } from "./types";
import raw from "../generated/modules.json";

if (raw.version !== 1) {
  throw new Error(`manifest: modules.json version ${raw.version} not supported — regenerate with cd backend && npm run gen:manifest`);
}

type PageProps = { auth: AuthState };
type PageModule = { default: ComponentType<PageProps> };

// Registry-driven nav model. The DATA comes from the backend registry via
// frontend/src/generated/modules.json (regenerated with `cd backend && npm run
// gen:manifest`, committed). This file only adds what JSON cannot carry: the
// static page-import functions, so Vite code-splits each module page. Adding a
// module page = one nav line in the backend registry + one loader here.
const LOADERS: Record<string, () => Promise<PageModule>> = {
  inventory: () => import("../pages/inventory"),
  pricing: () => import("../pages/pricing"),
  gems: () => import("../pages/jars"), // module "gems" serves route /jars
  healer: () => import("../pages/healer"),
  characters: () => import("../pages/characters"),
  accounts: () => import("../pages/accounts"),
  config: () => import("../pages/config"),
  analysis: () => import("../pages/analysis"),
  scans: () => import("../pages/scans"),
  "your-shops": () => import("../pages/your-shops"),
};

/**
 * One lazy component per page, created ONCE at module scope. lazy() must not be
 * called during render — a fresh lazy component every render makes Suspense
 * re-suspend forever and the page never mounts (regression fixed 2026-08-11).
 */
export const NAV_COMPONENTS: Record<string, LazyExoticComponent<ComponentType<PageProps>>> = {
  dashboard: lazy(() => import("../pages/dashboard")),
  inventory: lazy(LOADERS.inventory),
  lookup: lazy(() => import("../pages/lookup")),
  pricing: lazy(LOADERS.pricing),
  gems: lazy(LOADERS.gems),
  healer: lazy(LOADERS.healer),
  characters: lazy(LOADERS.characters),
  accounts: lazy(LOADERS.accounts),
  config: lazy(LOADERS.config),
  analysis: lazy(LOADERS.analysis),
  scans: lazy(LOADERS.scans),
  "your-shops": lazy(LOADERS["your-shops"]),
};

export const NAV_GROUPS: NavGroup[] = raw.navGroups;

// Shell-owned items (not backend modules): the dashboard is a core route.
const CORE_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    path: "/",
    title: "Dashboard",
    group: "overview",
    order: 10,
    icon: "◎",
    requiresScopes: [],
    load: () => import("../pages/dashboard"),
  },
  {
    id: "lookup",
    path: "/lookup",
    title: "Lookup",
    group: "operations",
    order: 20,
    icon: "🔎",
    requiresScopes: ["inventory.read"],
    load: () => import("../pages/lookup"),
  },
];

export const NAV_ITEMS: NavItem[] = [
  ...CORE_ITEMS,
  ...raw.navItems.map((item) => {
    const load = LOADERS[item.id];
    if (!load) {
      // Fail-fast: a module registered in the backend with a page must have a
      // loader here — build error, not a dead nav item at runtime.
      throw new Error(`manifest: module '${item.id}' has no page loader (add one in core/manifest.ts)`);
    }
    return { ...item, load };
  }),
];

// Fail-fast: every nav item (incl. shell-owned dashboard) must have a lazy
// component, else the route renders nothing and the app appears dead.
for (const item of NAV_ITEMS) {
  if (!NAV_COMPONENTS[item.id]) {
    throw new Error(`manifest: no lazy component registered for nav item '${item.id}'`);
  }
}

