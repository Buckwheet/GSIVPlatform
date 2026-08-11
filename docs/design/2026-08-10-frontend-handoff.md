# Frontend Design Handoff — for Gemini (Antigravity)

You are restyling the GSIVPlatform frontend. The app WORKS — data, auth, WS — but the
current UI is functional-first and visually plain. Your job is the design pass. Do NOT
change the data layer, routing, auth/scope gating, or the WS wiring.

## Start here (in order)
1. `frontend/README.md` — how to run (backend + `npm run dev`)
2. `frontend/src/design/tokens.css` — the design tokens (ALREADY adopted; color/spacing/type)
3. `docs/design/output/02-design-system/primitives.md` — **the component kit to implement**:
   13 primitives (button, input, select, table, card, status-dot, bar, modal, empty-state,
   skeleton, toast, form-field, toolbar). Token-driven, BEM `gs-` prefixes,
   `:focus-visible` rings, density-aware. **Build this kit first** (`src/components/`),
   then rebuild every page with it.
4. `docs/design/output/02-design-system/density.md` — comfortable (default) / compact
   (`pointer: fine`) presets; `accessibility.md` — contrast + focus + labels.

## What exists today (functional, needs styling)
| Page | File | Notes |
|---|---|---|
| Token gate | `src/shell/TokenGate.tsx` | the login screen — make it feel like a product |
| Shell (nav/sidebar/topbar) | `src/shell/AppShell.tsx` | scope-gated nav from `src/core/manifest.ts` |
| Dashboard | `src/pages/dashboard/` | live tiles |
| Characters | `src/pages/characters/` | table + start/stop/restart |
| Jars | `src/pages/jars/` | board + queue, **live via WS** |
| Healer | `src/pages/healer/` | board + registry, **live via WS** |
| Accounts | `src/pages/accounts/` | list, scan, TOTP setup (QR), TOTP-gated entry form |
| Config | `src/pages/config/` | char selector + go2/eherbs JSON editors |
| Analysis | `src/pages/analysis/` | status, run/loop, .log upload, output |
| Inventory | `src/pages/inventory/` | read-only search table |
| Pricing | `src/pages/pricing/` | sales table + scrape job |

Shared styles: `frontend/src/styles.css` (ad-hoc `.btn`, `.data-table`, etc. — replace with the kit).

## Hard constraints (do not break)
- **Scope gating**: pages render only when `can(auth, [scope])`; write buttons hide without
  the write scope. Keep `src/core/auth.ts` + `can()` behavior identical.
- **WS live updates**: `useWsEvents(["jars_update", ...], handler)` must keep working
  (live boards). `src/core/ws.ts` unchanged.
- **Token flow**: TokenGate → `GET /api/me` → scopes stored. Keep it.
- **Endpoints**: page data calls match the real module routes (inventory `/search`,
  pricing `/scrape` + `pricing.scrape` scope, etc.). Don't invent endpoints.
- Keep every page **functional** after the restyle — a button that no longer submits is a regression.

## Design intent
Dark, dense-but-comfortable ops dashboard (v1 palette in tokens.css). Status colors are
sacred (`--good`/`--bad`/`--warn`/`--hp`/`--mana`/`--spirit`/`--mind` — never remap).
Priority pages to make shine: **Token gate, Dashboard, Characters, Jars** (the ones people
look at daily). Empty/error/loading states on every data region (skeleton per design).

## Definition of done
- `src/components/` primitive kit per primitives.md (all 13), used by every page
- `npm run build` (tsc + vite) clean; pages still work (auth, WS, endpoints)
- No endpoint/scope/WS regressions; `docs/design/output/02-design-system/*` honored
