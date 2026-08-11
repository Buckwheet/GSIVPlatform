export type Scope = string;

export interface NavItem {
  id: string;
  path: string;
  title: string;
  group: string;
  order: number;
  icon: string;
  requiresScopes: Scope[];
  load: () => Promise<unknown>; // lazy page import (static import fn, see core/manifest.ts)
  external?: boolean;
}

export interface NavGroup {
  id: string;
  title: string;
}

export interface CharacterRow {
  account: string;
  char_name: string;
  game_code: string;
  managed: boolean;
  unit: string;
  active: boolean;
  sub: string;
  uptime: number | null;
}
