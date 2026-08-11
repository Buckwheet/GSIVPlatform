import type { ComponentType } from "react";
import type { AuthState } from "./auth";
import type { NavGroup, NavItem } from "./types";
import raw from "../generated/modules.json";

if (raw.version !== 1) {
  throw new Error(`manifest: modules.json version ${raw.version} not supported — regenerate with cd backend && npm run gen:manifest`);
}

// Registry-driven nav model. The DATA comes from the backend registry via
// frontend/src/generated/modules.json (regenerated with `cd backend && npm run
// gen:manifest`, committed). This file only adds what JSON cannot carry: the
// static page-import functions, so Vite code-splits each module page. Adding a
// module page = one nav line in the backend registry + one loader here.
const LOADERS: Record<string, () => Promise<{ default: ComponentType<{ auth: AuthState }> }>> = {
  inventory: () => import("../pages/inventory"),
  pricing: () => import("../pages/pricing"),
  gems: () => import("../pages/jars"), // module "gems" serves route /jars
  healer: () => import("../pages/healer"),
  characters: () => import("../pages/characters"),
  accounts: () => import("../pages/accounts"),
  config: () => import("../pages/config"),
  analysis: () => import("../pages/analysis"),
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

