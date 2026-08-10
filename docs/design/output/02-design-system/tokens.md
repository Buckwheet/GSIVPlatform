# Design System 02 — Token Catalogue (`tokens.md`)

The complete CSS custom-property set. Values are final and duplicated in the reference file `tokens.css`. Every token has a rationale; every change from v1 is called out.

## 1. Naming convention

- `--<category>-<name>` for tokens.
- v1 token names are kept **verbatim** (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--hp`, …) so a direct port of v1 CSS keeps working.
- New tokens follow the same flat style: `--panel-hover`, `--border-control`, `--text-strong`, …
- Scale tokens: `--space-*`, `--radius-*`, `--font-size-*`, `--z-*`, `--shadow-*`, `--duration-*`, `--ease-*`.

## 2. Color — v1 palette (source of truth, ported verbatim)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#14161b` | App background |
| `--panel` | `#1c1f26` | Panels, cards, table chrome |
| `--border` | `#2a2e38` | Decorative border (panels, dividers) |
| `--text` | `#d8dee9` | Primary text |
| `--muted` | `#808080` | Tertiary text / metadata |

These five are unchanged from v1. Rationale: the palette is the approved identity; changing it would break the "port, don't invent" rule.

## 3. Color — sacred status (never remap)

| Token | Value | Meaning |
|---|---|---|
| `--hp` | `#ff4040` | Hit points (resource bar) |
| `--mana` | `#4090ff` | Mana (resource bar) |
| `--spirit` | `#c040ff` | Spirit (resource bar) |
| `--mind` | `#33dd33` | Mind (resource bar) |
| `--resource` | `#66d9ef` | Generic resource pool / concentration |
| `--good` | `#33dd33` | Success / positive verdict (value = `--mind`) |
| `--bad` | `#ff4040` | Failure / negative verdict (value = `--hp`) |
| `--warn` | `#ffd633` | Warning / attention |

All eight are v1 values, unchanged. `good`/`bad` intentionally share values with `mind`/`hp` but are **separate tokens with separate meanings** — a success toast and a mind bar are both green, but never interchangeable in code. The brief's rule: resource-bar colors must keep their meaning; these tokens encode that.

## 4. Color — new neutral UI tokens (justified additions)

| Token | Value | Rationale |
|---|---|---|
| `--text-strong` | `#e6edf7` | Headings / emphasis tier. v1 had a single text color — flat hierarchy. Lighter than `--text`, 15.4:1 on `--bg`. |
| `--muted-strong` | `#a2aab8` | **Needed for AA:** v1 `--muted #808080` is 4.2:1 on `--panel` (< 4.5). `--muted` stays for tertiary text on `--bg` (4.6:1); `--muted-strong` (7.0:1 on panels) is the secondary-text tier on panels and controls. |
| `--panel-hover` | `#232833` | Hover / raised / selected surface over `--panel` (table rows, cards, ghost buttons). Same hue family, 1px-step lighter. |
| `--input-bg` | `#0f1116` | Inset control fill. Reads as "field", slightly deeper than `--bg`, so inputs are visibly embedded in panels. |
| `--bar-track` | `#0d0f13` | v1 bar track, kept verbatim. Darkest surface. |
| `--tooltip-bg` | `#0d0f13` | Popover fill — reuses the bar-track value; dark tooltips read as "above" the UI. |
| `--skeleton-bg` | `#262b35` | Loading-placeholder fill, mid-way between `--panel` and `--border`. |
| `--border-strong` | `#3c4454` | Emphasis border (hover on secondary controls, focused-adjacent states). |
| `--border-control` | `#677086` | **Needed for AA (WCAG 1.4.11):** interactive control boundaries (inputs, selects, secondary button outlines) must be ≥3:1 against their background. v1 `--border` is ~1.3:1. `#677086` is 3.8:1 on `--input-bg`, 3.3:1 on `--panel`, 3.7:1 on `--bg`. This is the **only visible deviation from v1** and it is intentional. |
| `--overlay` | `rgba(8, 10, 13, 0.72)` | Modal scrim — a dark overlay keeps focus on the dialog without inventing a hue. |
| `--focus` | `#66d9ef` | Keyboard focus ring. Reuses `--resource`'s value: it is a *functional affordance*, not a data color, and it passes ≥3:1 on every surface in the system. Documented swap option: `--mana` also passes if cyan ever reads as "resource" in context. |
| `--tint-<status>` | `color-mix(in srgb, <status> 14%, var(--panel))` | Badge/tinted-surface fills for the eight statuses (e.g. `--tint-warn`). Derived, never hand-picked. |

### Why these and no more

Every addition is a *surface role* (hover, inset, scrim, popover, placeholder, control boundary, focus), not a new semantic color. No new hues are introduced — the neutral ramp stays neutral and the status ramp is untouched.

## 5. Spacing — 4px grid

| Token | Value |
|---|---|
| `--space-0` … `--space-9` | `0, 4, 8, 12, 16, 20, 24, 32, 48, 64px` |

4px grid chosen because v1 was already 4–8px granularity in practice and the dashboard is dense. All padding/gap decisions use these steps.

## 6. Radius

| Token | Value | Used for |
|---|---|---|
| `--radius-xs` | `4px` | Bar tracks, tiny chips. *(v1 bars were 3px — folded into the scale, visually identical.)* |
| `--radius-sm` | `6px` | Small controls, tooltips, badges |
| `--radius-md` | `8px` | Panels, cards, buttons, inputs — v1's 6–8px range |
| `--radius-full` | `999px` | Pills, status dots (8px circles) |

## 7. Type — monospace identity

| Token | Value | Rationale |
|---|---|---|
| `--font-mono` | `"Consolas","Monaco","Menlo","Lucida Console","DejaVu Sans Mono",monospace` | v1 stack, extended with standard mono fallbacks. |
| `--font-size-md` | `14px` | Base (v1). |
| `--font-size-xs/sm` | `11px / 12px` | Captions, table cells, metadata. **11px is the floor** for any text that must carry meaning (all still ≥4.5:1 in `accessibility.md`). |
| `--font-size-lg/xl/2xl/3xl` | `16 / 18 / 22 / 28px` | Section titles → page titles. Deliberately restrained (≈1.15–1.2 ratio, not a marketing scale). |
| `--leading-tight/normal/relaxed` | `1.25 / 1.5 / 1.65` | Monospace needs generous line-height. |
| `--font-weight-normal/bold` | `400 / 700` | Monospace has two weights; do not fake more. |
| `--letter-spacing-tight` | `-0.02em` | Large titles only. |
| `--letter-spacing-label` | `0.08em` | Uppercase micro-labels ("STATUS", "MODULE"). |

**Secondary font — none.** Rationale: a game-ops dashboard is numbers, logs, and state. Monospace aligns columns, tabulates numerics, scans like a game client, and keeps the terminal identity the brief asks to preserve. A proportional font would add noise without adding information. (CJK/system glyph fallback happens inside the browser's font fallback chain — no separate family token is exposed.)

## 8. Z-index scale

| Token | Value |
|---|---|
| `--z-sticky` | `10` | Sticky table headers, sticky bar rows |
| `--z-dropdown` | `20` | Select popups, menus |
| `--z-tooltip` | `30` | Tooltips |
| `--z-overlay` | `40` | Modal scrim |
| `--z-modal` | `50` | Modal dialogs |
| `--z-toast` | `60` | Toasts (always on top of modals) |

## 9. Shadow / depth

| Token | Value | Used for |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,.30)` | Small raised chips |
| `--shadow-sm` | `0 2px 4px rgba(0,0,0,.35)` | Hovered cards |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,.45)` | Dropdowns, tooltips |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,.55)` | Modals |
| `--shadow-focus` | `0 0 0 2px var(--bg), 0 0 0 4px var(--focus)` | Focus ring as box-shadow (for elements that clip `outline`) |
| `--shadow-inset` | `inset 0 1px 2px rgba(0,0,0,.40)` | Inset fields |

Depth strategy: dark UIs lift with borders + soft black shadows; there is no colored glow except the focus ring.

## 10. Motion

| Token | Value | Rationale |
|---|---|---|
| `--duration-fast` | `100ms` | Hover tints, dot pulses |
| `--duration-normal` | `200ms` | Standard appear/fade |
| `--duration-slow` | `400ms` | Modal/dropdown transitions |
| `--duration-bar` | `500ms` | **v1 bar fill (`width 0.5s ease`) — preserved exactly.** |
| `--ease-out` | `cubic-bezier(0,0,0.2,1)` | Entrances |
| `--ease-in` | `cubic-bezier(0.4,0,1,1)` | Exits |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | Default |
| `--ease-bar` | `cubic-bezier(0.25,0.1,0.25,1)` | `= CSS ease` (v1 bar feel) |

All animation is opacity/transform/width only (cheap, no layout thrash). All durations ≤500ms. Reduced-motion rules in `accessibility.md` and `tokens.css`.

## 11. Component geometry & density

| Token | Comfortable (default) | Compact | Notes |
|---|---|---|---|
| `--control-height` | `40px` | `32px` | Buttons, inputs, selects |
| `--control-pad-x` | `12px` | `8px` | |
| `--control-pad-y` | `8px` | `4px` | |
| `--control-gap` | `8px` | `6px` | Label/icon-to-control gap |
| `--table-row-pad-y` | `10px` | `6px` | |
| `--table-cell-pad-x` | `12px` | `8px` | |
| `--card-pad` | `16px` | `12px` | |
| `--card-gap` | `16px` | `12px` | Title↔body gap |
| `--section-gap` | `24px` | `16px` | Between page sections |
| `--stack-gap` | `12px` | `8px` | Default vertical rhythm |
| `--tap-target-min` | `44px` | `32px` | See `density.md` for the coarse-pointer override |
| `--bar-height` | `10px` | `8px` | Resource bars |
| `--dot-size` | `8px` | `8px` | **Status dots never resize** (v1) |

Full rationale and the coarse-pointer safety rule: `density.md`.

## 12. Changes from v1 — complete list

**Ported verbatim:** all 13 colors, `--bar-track #0d0f13`, Consolas/Monaco 14px base, 6–8px radius feel, 8px status dots, bar fill `width 0.5s ease`.

**Changed with rationale:**
1. `--border-control #677086` — interactive boundaries now meet WCAG 1.4.11 (v1 border is 1.3:1). Only visible change.
2. Added `--text-strong` — heading/emphasis tier.
3. Added `--muted-strong` — AA-compliant secondary text on panels.
4. Added `--panel-hover`, `--input-bg`, `--focus`, `--overlay`, `--tooltip-bg`, `--skeleton-bg`, `--border-strong` — surface roles a component kit needs.
5. Added `--tint-*` derived fills for badges.
6. Bar track radius 3px → `--radius-xs` 4px.
7. Spacing, radius, type, z-index, shadow, motion, density formalized into scales (values unchanged in spirit; previously implicit).
