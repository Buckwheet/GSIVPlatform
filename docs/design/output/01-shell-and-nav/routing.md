# Routing

## 1. Principle: routes fall out of the registry

The backend registry (single source of truth) is serialized to a JSON
**module manifest**; the frontend consumes it at build time to generate both
the route table and the nav model. One file, two outputs:

```
backend/src/core/registry.ts
        │  serialize (spec.ts / registry.ts)
        ▼
frontend/src/generated/modules.json     ← regenerated on build, committed
        │
        ├──► src/core/nav.ts      (NavItem[])    → nav-ia.md
        └──► src/core/router.ts   (RouteObject[]) → this doc
```

Validation mirrors the backend's fail-fast rules: duplicate paths, a nav item
without a page, a page without a scope — build error, not runtime surprise.

## 2. Manifest schema (what the shell reads)

```ts
// frontend/src/core/types.ts
export type Scope = string; // e.g. "inventory.read"

export interface NavItem {
  id: string;                 // "inventory"
  path: string;               // "/inventory"
  title: string;              // "Inventory"
  group: NavGroupId;          // "operations"
  order: number;              // sort within group
  icon: string;               // emoji or svg token
  requiresScopes: Scope[];    // all must be held to see/enable the item
  load: () => Promise<unknown>; // lazy page import (real static import fn)
}

export interface ModuleManifest {
  version: number;
  core: { apiBase: string; wsUrl: string; vellum: VellumInfo };
  navGroups: NavGroup[];      // ordered
  navItems: NavItem[];        // core + module items, already ordered
  scopes: Scope[];            // every scope a token can hold
}
```

Every module page module exports one default component and participates via
its manifest entry — adding `pages/<name>/index.tsx` plus one line in the
registry is the whole cost of a new nav item.

## 3. Route table

### Shell-owned routes (core, always present)

| Path | Component | Scope gate | Notes |
|---|---|---|---|
| `/login` | `LoginView` | none (public) | outside the shell |
| `/` | `DashboardPage` | any `*.read` | overview; feeds + status |
| `/watch` | `WatchHubPage` | `characters.read` | VellumFE gateway (game-view-ux.md) |
| `*` | `NotFoundPage` | none | 404 inside the shell frame |

### Module routes (derived from the manifest)

| Path | Page | Module | Scope gate | Notes |
|---|---|---|---|---|
| `/inventory` | `InventoryPage` | inventory | `inventory.read` | port #1 |
| `/pricing` | `PricingPage` | pricing | `pricing.read` | sales-tracker |
| `/gems` | `GemsPage` | gems | `gems.read` | jar pipeline |
| `/bounty` | `BountyPage` | bounty | `bounty.read` | |
| `/jars` | `JarsPage` | jars | `jars.read` | |
| `/queue` | `QueuePage` | queue | `queue.read` | script/command queue |
| `/healer` | `HealerPage` | healer | `healer.read` | |
| `/characters` | `CharactersPage` | characters | `characters.read` | list |
| `/characters/:charId` | `CharacterDetailPage` | characters | `characters.read` | nested level |
| `/accounts` | `AccountsPage` | accounts | `accounts.read` | admin surface |
| `/entry` | `EntryPage` | entry | `entry.read` | TOTP / passwords — most sensitive |
| `/config` | `ConfigPage` | config | `config.read` | platform config |
| `/analysis` | `AnalysisPage` | analysis | `analysis.read` | insights |

Nested route example (characters owns a detail level):

```
/characters          → list
/characters/:charId  → detail (nav keeps /characters active; page shows back affordance)
```

## 4. Route generation

```ts
// frontend/src/core/router.ts
import { createBrowserRouter } from "react-router-dom";
import { manifest } from "../generated/modules.json";

const moduleRoutes = manifest.navItems.map((item) => ({
  path: item.path.replace(/^\//, ""),
  element: <LazyRoute load={item.load} fallback={<PageLoading />} />,
}));

export const router = createBrowserRouter([
  { path: "/login", element: <LoginView /> },
  {
    path: "/",
    element: <Shell />,            // header + status strip + nav + <Outlet/>
    children: [
      { index: true, element: <DashboardPage /> },        // "/"
      { path: "watch", element: <WatchHubPage /> },
      ...moduleRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
```

Notes:

- **Static imports only.** `item.load` is a real import function captured in
  the generated manifest (`() => import("../pages/inventory")`) so Vite
  code-splits each module page; no dynamic `import(variable)`.
- `LazyRoute` wraps `React.lazy` in `Suspense` with the shared `PageLoading`.
- The shell subtree is wrapped by `AppErrorBoundary`, so a module page crash
  never blanks the shell (states.md §6).

## 5. Scope gating

- Nav visibility: item hidden when the token lacks a required scope
  (nav-ia.md §6).
- Route access: `RequireScope` renders `AccessDenied` (403 view — distinct
  from 404) when a valid token lacks the scope; missing token redirects to
  `/login?next=<path>`.
- Parity with the backend: hiding a nav item never replaces API enforcement;
  the API is always the authority.

```tsx
function RequireScope({ scopes, children }: { scopes: Scope[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!scopes.every((s) => can(s))) return <AccessDenied required={scopes} />;
  return children;
}
```

## 6. 404 handling

- Unknown path inside the shell → `NotFoundPage` (keeps the shell frame; nav
  stays usable) with a "Go to Dashboard" action.
- Unknown path that would be a module still being ported → same 404 with a
  hint: "This module hasn't been ported yet."
- SPA fallback: Caddy `try_files {path} /index.html` — every deep link
  (including `/characters/:charId`) loads the shell, which re-resolves the
  route. Lich-era core URLs (`/api/publish`, `/api/commands`, `/api/stream`,
  `/api/status`) are backend routes and never hit the SPA fallback.

## 7. URL conventions

- App routes: lowercase, kebab-case, no trailing slash.
- Query params: `?next=` (post-login redirect), `?char=` (Watch deep-link
  target), `?tab=` (in-page tabs).
- BrowserRouter — v1's `#/` habit is not carried over.
