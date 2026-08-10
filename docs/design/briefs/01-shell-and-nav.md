# Design Brief 01 — App Shell & Navigation

## Context

GSIVPlatform is a greenfield rewrite of GSIVDashboard (Gemstone IV service
dashboard). Backend is modular: each feature is a self-contained module
(routes + store + WS events + page) registered in a central registry, exposing
`/api/modules/<name>/*`, documented via OpenAPI, with a typed React client.
Read the approved design: `docs/design/2026-08-10-modular-platform-design.md`.

This brief covers the **application shell** — the first thing users see.

## Goal

Design the React app shell for a monitoring + control dashboard that runs on
desktop and mobile browsers. It must feel like a *product*, not a set of
tacked-on pages (that is the v1 failure we are fixing).

## Requirements

1. **Auth flow**: token-based (Bearer). Shell handles login (token entry),
   token persistence, 401 handling, logout. One auth context shared app-wide.
2. **Navigation**: modules are the nav items. Known modules (from the design):
   Dashboard/Overview, Inventory, Pricing (sales), Gems/Jars, Bounty, Healer,
   Characters, Accounts, Config, Analysis, Game View (VellumFE link).
   Nav must be **data-driven from the module registry** (new module = new nav
   item automatically), not hardcoded.
3. **Layout**: persistent shell (nav + header) with per-module page content.
   Works at desktop widths and narrow phone widths (hamburger/collapsible).
4. **Global status strip**: connection status (WS), character online state,
   game server up/down — a compact always-visible strip, not per-page.
5. **VellumFE integration point**: a nav entry / per-character "watch" action
   that deep-links to the VellumFE web viewer (separate service). Design the
   UX affordance, not the viewer itself.
6. **Error handling**: error boundary, loading states, empty states, retry —
   at the shell level so every page inherits them.
7. **Theme**: dark, game-appropriate (v1 tokens in brief 02). No light theme
   required.

## Constraints

- React 18+, Vite, TypeScript strict.
- No component library dependency unless the design justifies one (prefer
  primitives from brief 02).
- React Router (or similar) for routing; routes derived from the registry.
- Accessibility: keyboard navigable nav, focus states, aria-current.

## Deliverables (Markdown in `docs/design/output/01-shell-and-nav/`)

1. `README.md` — index of the design.
2. `layout.md` — shell layout diagram (ASCII or Mermaid): header, nav, status
   strip, content region; desktop + mobile variants.
3. `routing.md` — route table derived from the module list; how the registry
   drives it; nested route structure; 404 handling.
4. `auth-flow.md` — sequence of login → token → WS connect → 401 → reauth.
5. `component-tree.md` — the shell's React component tree with props and
   responsibilities per component.
6. `nav-ia.md` — information architecture: nav grouping, labels, ordering,
   icons (emoji or inline SVG), active states.
7. `game-view-ux.md` — the VellumFE deep-link UX (nav entry, per-char watch
   button, fallback when viewer is down).
8. `states.md` — loading/empty/error/offline states for the shell.

Keep each file focused; total output should be readable in one sitting.
