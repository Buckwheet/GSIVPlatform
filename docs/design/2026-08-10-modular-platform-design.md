# GSIVPlatform — Greenfield Modular Platform Design

**Date:** 2026-08-10
**Status:** Approved (design), awaiting implementation plan
**Supersedes:** GSIVDashboard v1 architecture (kept as reference, never migrated)

## 1. Why this exists

GSIVDashboard v1 grew feature-by-feature into a ~1,640-line `index.ts` with ~80
routes across 13 unrelated domains, a vanilla-JS frontend with 4 diverged copies
of auth/esc/fetch boilerplate, and a second project (sales-tracker) on the same
server with uncommitted source. Rather than refactor that accretion, we build a
**greenfield v2** ("GSIVPlatform") with a clean modular architecture and port
features into it over time. v1 stays running and is used as a reference
implementation.

## 2. Locked decisions

| # | Decision |
|---|---|
| 1 | Greenfield: brand-new repo, old repo kept as reference, features ported over time |
| 2 | Single monorepo (backend + frontend + deploy) |
| 3 | Core platform first, then feature modules |
| 4 | Compile-time modules + central registry |
| 5 | Module-per-prefix `/api/modules/<name>/*` + OpenAPI spec + typed frontend client |
| 6 | Full module: routes + store + WS events + page |
| 7 | Module-declared scopes + per-token permissions |
| 8 | React + Vite frontend |
| 9 | VellumFE = separate service replacing BuckTV (GPL-3.0 isolated; dashboard stays private) |
| 10 | Sales-tracker folded in as the `pricing` module |

## 3. Repository layout

```
GSIVPlatform/
├── backend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── registry.ts      # central registry — only file a new feature touches
│   │   │   ├── auth.ts          # token→scopes; per-route requireScope()
│   │   │   ├── rate-limit.ts    # sliding window (local Redis)
│   │   │   ├── db.ts            # SQLite handle + per-module migrations
│   │   │   ├── redis.ts         # local Redis handle
│   │   │   ├── ws.ts            # typed event bus (state, streams, module events)
│   │   │   ├── spec.ts          # OpenAPI 3 generator from registry
│   │   │   └── server.ts        # bootstrap: load core → mount modules → serve
│   │   └── modules/
│   │       ├── health/          # built-in: /health, /api/modules/health
│   │       ├── inventory/       # port #1
│   │       ├── pricing/         # port #2 (sales-tracker)
│   │       ├── gems/            # jar pipeline
│   │       ├── bounty/  jars/  queue/  healer/
│   │       ├── characters/  accounts/  entry/
│   │       ├── config/  analysis/
│   │       └── ...
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── core/            # shell: auth, typed api client, ws hook, nav, error boundary
│   │   └── pages/           # one per module
│   └── package.json
├── deploy/                  # Caddy, systemd, env templates
└── docs/                    # design docs, module HOWTO
```

## 4. Module contract

```ts
interface Module {
  name: string;                 // "inventory"
  prefix: string;               // "/api/modules/inventory"
  scopes: Scope[];              // [{ name: "inventory.read", desc }]
  registerRoutes(app, deps): void; // deps = { db, redis, ws, auth, spec }
  wsEvents?: Record<string, (msg, ctx) => void>;
  onLoad?(deps): void;          // startup hooks, seed data
  onUnload?(deps): void;
}
```

Registry boot validation (fail-fast, non-negotiable):
- No duplicate module names or prefixes.
- Every declared scope is used by at least one route.
- Every route declares a scope (no route without a scope — kills the
  accidental-public-route class: v1's `/api/metrics`, `/api/server`).
- Every route is documented for the spec generator (spec cannot silently
  miss a route).

Modules never import each other's internals. They interoperate only via the
API and WS events.

## 5. API & OpenAPI

- Each module mounts at `/api/modules/<name>/*`.
- `core/spec.ts` generates an OpenAPI 3 spec from the registry (via
  `@hono/zod-openapi`: route zod schemas in, spec out).
- Frontend generates typed API clients from the spec
  (openapi-typescript + thin fetch wrapper). Route changes break the build
  instead of failing at runtime.
- **Core routes that Lich depends on** (`/api/publish`, `/api/commands`,
  `/api/stream`, `/api/status`) live in core — NOT modules — and keep their
  v1 URLs so Lich scripts keep working during the port.

## 6. Auth & permissions

- Tokens stored in local Redis, each with a scope list (v1 kept them in an
  env-var map with no scoping — this is the fix).
- `requireScope("module.verb")` middleware per route; admin token gets `*`.
- Scope naming: `<module>.<verb>` (`bounty.read`, `jars.write`, `admin`).
- Routes without a declared scope fail registry boot validation (see §4).
- v1 tokens imported once at v2 cutover.

## 7. Frontend

- React + Vite shell: auth context, typed API client (from spec), WS hook,
  nav, error boundary, dark theme (port v1's CSS).
- One page per module (InventoryPage, PricingPage, ...). VellumFE deep-link
  in nav for live game viewing.
- Deploy: `npm run build` → Caddy static + SPA fallback.

## 8. Data & migration

- `core/db.ts` runs per-module migrations; tables namespaced
  (`inventory_*`, `pricing_*`).
- v1's `inv.db3` and sales-tracker SQLite are opened **read-only in place**
  by the first read-only modules (same trick v1's `invdb.ts` uses), then
  optionally copied into v2 schema later.
- Feature porting order:
  1. Core platform (registry, auth, rate-limit, db, redis, ws, spec, server)
  2. `inventory` (read-only, zero risk)
  3. `pricing` (sales-tracker: sales search, gem intelligence,
     price-recommendation, listings, scraper job)
  4. `gems` (jar pipeline — depends on pricing via API)
  5. `bounty`, `jars`, `queue`
  6. `healer`
  7. `characters` / `managed`
  8. `accounts` / `entry` (TOTP + password mgmt — most sensitive, last)
  9. `config` / `go2` / `eherbs`
  10. `analysis` / `ai`
  11. Cleanup: retire v1 routes, port 3200, `sales.phylactery.ovh`, BuckTV

## 9. VellumFE (separate service)

- Runs headless on the server as its own process/port; its phone-web
  frontend replaces BuckTV for live game viewing.
- GPL-3.0 stays isolated to the VellumFE process; no code imported into
  GSIVPlatform, so the platform license remains private.
- v2 nav links to it (per-character deep links).

## 10. Testing

- Core invariants (tested once, keep the platform honest): registry
  validation, scope enforcement, spec completeness.
- Per-module: `store.test.ts` + `routes.test.ts` (vitest + Hono app with
  module mounted).
- Module HOWTO in `docs/` — what a new feature must provide to be accepted.

## 11. Old repo disposition

- v1 stays as reference implementation (bug-for-bug behavior, edge cases) —
  treated as a spec, never deleted.
- As features are fully ported and v1 routes for them go unused, v1 stops
  serving those domains; eventually v1 is archived read-only.

## 12. Open items

- `sales-tracker` has no git remote — create one as a safety net before
  mining it for the `pricing` module.
- VellumFE fork upstream-sync policy (Nisugi's project) — confirm before
  relying on it.
- Server migration plan for the eventual v2 cutover (Caddy, systemd,
  token import) written when core lands.
