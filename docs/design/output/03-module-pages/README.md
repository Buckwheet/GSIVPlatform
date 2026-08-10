# Module Page Patterns — GSIVPlatform

**Brief:** `docs/design/briefs/03-module-pages.md`
**Status:** Design (output for review)
**Scope:** Reusable page patterns for the 9 module pages + Dashboard landing, plus the shared WS live-data hook and scope-driven UI rules.

Every module page in GSIVPlatform is a **composition of these patterns** — no page is designed from scratch. The patterns sit on top of the shell (brief 01) and the design system (brief 02): pages use shell primitives (`Skeleton`, `Card`, `Button`, `Bar`, `StatusDot`, `Modal`, `Toast`, `Tabs`, `Table`, `Input`, `Select`) and render inside the persistent shell layout.

Companion outputs: `../01-shell-and-nav/` (shell, nav, auth, global states), `../02-design-system/` (tokens, primitives).

---

## Files

| File | Contents |
|---|---|
| `README.md` | This index + the pattern selection table for all modules. |
| `patterns.md` | The 6 page patterns: anatomy, states, mobile behavior, actions placement. |
| `ws-data-pattern.md` | The single shared WS live-data hook pattern: subscribe, buffering, reconnect, stale indicator. |
| `scope-driven-ui.md` | How pages render per allowed scopes; read-only pages never show write affordances. |
| `page-map.md` | Per-module mapping: chosen pattern(s), key endpoints, deviations. |

---

## Pattern selection table

| Module page | Primary pattern | Composed with | Live (WS)? | Write actions |
|---|---|---|---|---|
| Dashboard (landing) | 4 — Dashboard/Overview | — | Yes (character strip, alerts) | No |
| Inventory | 1 — List/Search | read-only Detail (modal) | No | No |
| Pricing | 1 — List/Search | 6 — History/Trends | Optional (job events) | Yes (run scraper) |
| Gems/Jars | 3 — Live status board | 2 — Detail (single jar) | Yes | Yes (claim/clear) |
| Bounty | 3 — Live status board | 6 — History/Trends | Yes | Yes (complete/remove) |
| Healer | 3 — Live status board | — | Yes | Yes (accept/complete) |
| Characters | 1 — List/Search | live status columns | Optional (status WS) | Yes (start/stop/restart) |
| Accounts | 1 — List/Search | 2 — Detail + 5 — Form/Edit (TOTP) | No | Yes (scan, entry.yaml) |
| Config | 5 — Form/Edit | — | No | Yes (save) |
| Analysis | 6 — History/Trends | 2 — Detail + 5 — Form/Edit | Yes (run progress) | Yes (run/upload) |

Full detail per module (endpoints, scopes, deviations): `page-map.md`.

---

## Non-negotiable rules (every page)

1. **Mandatory states:** loading skeleton, empty state, error + retry, stale-data indicator (WS-fed pages), auth/401 redirect (shell handles the redirect; pages render a "session expired" inline state while it happens). See `patterns.md` §Cross-cutting states.
2. **One action-placement rule per pattern.** Actions are never scattered; each pattern defines where primary/secondary/destructive actions live.
3. **One WS subscription pattern.** WS-fed pages use `useWsData` / `useWsEvent` from `frontend/src/core` — never their own socket (`ws-data-pattern.md`).
4. **Scope-driven UI.** A page renders exactly the affordances its token's scopes allow. Read-only pages never show write affordances — not even disabled buttons (`scope-driven-ui.md`).
5. **Charts are lightweight:** canvas or inline SVG only; no heavy chart-library assumption (requirement from brief 03).
6. **Compose, don't invent.** If a page needs a behavior no pattern covers, that is a *new pattern proposal*, not a one-off exception. Deviations are recorded in `page-map.md`.

---

## Reading order

1. `patterns.md` — the six patterns.
2. `ws-data-pattern.md` — the live-data hook.
3. `scope-driven-ui.md` — scope-aware rendering.
4. `page-map.md` — per-module mapping.
