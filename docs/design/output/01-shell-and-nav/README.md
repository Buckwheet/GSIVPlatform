# GSIVPlatform — Brief 01: App Shell & Navigation

**Status:** Proposed
**Date:** 2026-08-10
**Scope:** Frontend application shell for GSIVPlatform v2 (React 18+ / Vite / TypeScript strict)
**Parent design:** [`2026-08-10-modular-platform-design.md`](../../2026-08-10-modular-platform-design.md) (approved)

## What this design covers

The persistent application shell that every GSIVPlatform page lives inside:
authentication, registry-driven navigation, responsive layout, the global
status strip, the VellumFE deep-link affordance, and shell-level
loading / empty / error / offline behavior. It deliberately stops at the
shell — module page content is specified by later briefs — so every module
page inherits the same frame and only owns its content region.

## Deliverables

| File | Focus | Key decisions |
|---|---|---|
| [`layout.md`](./layout.md) | Persistent shell anatomy, desktop + mobile | Header / status strip / nav / content; 240 px rail, drawer on mobile |
| [`routing.md`](./routing.md) | Route table + registry-driven route generation | `createBrowserRouter` generated from a single module manifest; scope-gated routes; SPA fallback |
| [`auth-flow.md`](./auth-flow.md) | Token login → WS → 401 → reauth | One auth context; Bearer token; `auth:invalidated` bus event |
| [`component-tree.md`](./component-tree.md) | React component tree, props, responsibilities | Thin provider pyramid; shared `PageState` primitives |
| [`nav-ia.md`](./nav-ia.md) | Nav IA: groups, labels, icons, active states | 5 groups, 14 items, data-driven ordering, scope visibility |
| [`game-view-ux.md`](./game-view-ux.md) | VellumFE deep-link UX + fallback | Link-only (never iframe); `/watch` hub + per-character Watch button |
| [`states.md`](./states.md) | Loading / empty / error / offline | Reusable `PageState` primitives; offline = degraded-but-usable shell |

## Design tenets

1. **One source of truth.** The backend module registry is the only place a
   feature is added. It serializes to a JSON module manifest consumed at build
   time by the frontend. Adding a module to the backend automatically produces
   its nav item, route, and scope checks — there is no second list to maintain.
2. **The shell is a product, not scaffolding.** Navigation, status, and error
   handling are owned by the shell, shared by every module, and consistent on
   desktop and phone.
3. **Modules are black boxes.** The shell knows a module only through its
   manifest entry (name, path, scopes, nav metadata). No shell code imports a
   module's internals; modules interoperate via API and WS events only.
4. **Degrade, don't break.** Any module, the WS, or the API can be down; the
   shell stays navigable, shows the truth, and offers retry.
5. **Dark, game-appropriate.** v1 token set is ported (brief 02); no light
   theme.

## Reading order

1. `layout.md` — the frame everything else fills.
2. `routing.md` — how the registry becomes routes and nav.
3. `auth-flow.md` — the only thing that happens before the frame appears.
4. `component-tree.md` — how the frame is built.
5. `nav-ia.md` — what the frame says and how it says it.
6. `game-view-ux.md` — the one cross-service affordance.
7. `states.md` — how the frame behaves when the world misbehaves.

## Open questions (for later briefs)

- Token storage: `localStorage` chosen (see `auth-flow.md` §4) — confirm no
  org policy forbids it on managed devices.
- VellumFE base URL discovery: single configured origin vs. per-character
  subdomain — confirm with the VellumFE operator (parent design §12 open item).
- Whether `entry` and `config` should later become tabs of one "Admin" page;
  this design keeps them standalone because the registry treats each module
  as one nav item by default.
- Per-user drag-to-reorder nav is out of scope for v2.0; ordering is a
  registry/manifest decision.
