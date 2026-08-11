import type { NavGroup, NavItem } from "./types";

// Data-driven nav model (docs/design/output/01-shell-and-nav/nav-ia.md).
export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", title: "Overview" },
  { id: "operations", title: "Operations" },
  { id: "market", title: "Market" },
  { id: "people", title: "People" },
  { id: "platform", title: "Platform" },
];

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", path: "/", title: "Dashboard", group: "overview", order: 10, icon: "◎", requiresScopes: [] },
  { id: "inventory", path: "/inventory", title: "Inventory", group: "operations", order: 10, icon: "🎒", requiresScopes: ["inventory.read"] },
  { id: "jars", path: "/jars", title: "Jars", group: "operations", order: 30, icon: "🫙", requiresScopes: ["gems.read"] },
  { id: "healer", path: "/healer", title: "Healer", group: "operations", order: 60, icon: "⛑️", requiresScopes: ["healer.read"] },
  { id: "pricing", path: "/pricing", title: "Pricing", group: "market", order: 10, icon: "🏷️", requiresScopes: ["pricing.read"] },
  { id: "characters", path: "/characters", title: "Characters", group: "people", order: 10, icon: "🧝", requiresScopes: ["characters.read"] },
  { id: "accounts", path: "/accounts", title: "Accounts", group: "people", order: 20, icon: "👥", requiresScopes: ["accounts.read"] },
  { id: "config", path: "/config", title: "Config", group: "platform", order: 20, icon: "⚙️", requiresScopes: ["config.read"] },
  { id: "analysis", path: "/analysis", title: "Analysis", group: "platform", order: 30, icon: "📊", requiresScopes: ["analysis.read"] },
];
