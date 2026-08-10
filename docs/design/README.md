# GSIVPlatform — Design Briefs

This folder contains **self-contained design briefs** that can be handed to a
separate design agent (e.g. Gemini Flash) to produce design work for
GSIVPlatform v2. Each brief is written to be actionable without any other
context — point the worker at this folder (or at one brief file) and give it
the output instructions at the bottom of each file.

## When to use this folder

The platform is being built greenfield. The core architecture is fixed (see
`../2026-08-10-modular-platform-design.md` — the approved platform design).
What is NOT yet designed, and what these briefs cover, is the **product surface**:
the React shell, the design system, and the module-page patterns.

## Folder layout

| File | Covers | Best used when |
|---|---|---|
| `briefs/01-shell-and-nav.md` | App shell, routing, nav, auth flow, VellumFE link | Before any frontend scaffolding |
| `briefs/02-design-system.md` | Theme tokens, component primitives, density | Before building components |
| `briefs/03-module-pages.md` | Page patterns per module, list/detail, states | Per-module, as each feature ports |
| `briefs/04-game-view.md` | BuckTV replacement UX via VellumFE deep-links | When the game viewer lands |

## How to run a design worker

1. Pick the brief file(s) that cover the current work.
2. Give the worker the path (or paste the file contents) plus the phrase:
   "Produce the design as Markdown in `docs/design/output/<brief-name>/` per the
   Deliverables section."
3. Have the worker read the approved platform design first
   (`docs/design/2026-08-10-modular-platform-design.md`) for architectural
   constraints — the briefs reference it.

## Reference material (read-only, for the worker)

- **Approved platform design:** `docs/design/2026-08-10-modular-platform-design.md`
- **v1 frontend (theme + behavior to port):** `D:\Code Projects\GSIVDashboard\frontend\`
- **v1 style.css tokens** (current dark theme — see brief 02 for the token list)
- **VellumFE (game viewer inspiration):** `D:\GSIV Development\VellumFE\` (GPL-3.0 — reference only, never copy code)

## Output convention

All worker output goes in `docs/design/output/<topic>/` with a `README.md`
index. Output is **design only** — no implementation code. If a worker writes
code, it must be marked clearly as "reference implementation" and kept out of
`backend/` and `frontend/` source trees.

## Output status

All four briefs have been executed by the design worker. Deliverables are in
`docs/design/output/`:

| Brief | Output dir | Files |
|---|---|---|
| 01 — Shell & Nav | `output/01-shell-and-nav/` | layout, routing, auth-flow, component-tree, nav-ia, game-view-ux, states + README |
| 02 — Design System | `output/02-design-system/` | tokens.md, primitives.md, density.md, accessibility.md, tokens.css + README |
| 03 — Module Pages | `output/03-module-pages/` | patterns, ws-data-pattern, scope-driven-ui, page-map + README |
| 04 — Game View | `output/04-game-view/` | entry-points, deep-link-contract, states, flow + README |

The design system (02) is the foundation — adopt `tokens.css` first when the
React frontend starts.
