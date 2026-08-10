import type { NavGroup, NavItem } from "./types";

// Data-driven nav model (docs/design/output/01-shell-and-nav/nav-ia.md).
// Only modules with a page are listed; pages land incrementally (Phase B).

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", title: "Overview" },
  { id: "operations", title: "Operations" },
  { id: "market", title: "Market" },
  { id: "people", title: "People" },
  { id: "platform", title: "Platform" },
];

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", path: "/", title: "Dashboard", group: "overview", order: 10, icon: "◎", requiresScopes: [] },
  { id: "characters", path: "/characters", title: "Characters", group: "people", order: 10, icon: "🧝", requiresScopes: ["characters.read"] },
  { id: "analysis", path: "/analysis", title: "Analysis", group: "platform", order: 30, icon: "📊", requiresScopes: ["analysis.read"] },
];
