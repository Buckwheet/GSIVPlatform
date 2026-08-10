# GSIVPlatform — Design System 02

**Status:** Design + CSS token reference (not a library implementation)
**Scope:** Every GSIVPlatform module page shares this visual language.
**Source of truth:** `docs/design/2026-08-10-modular-platform-design.md` (approved platform design) + Brief 02.
**Palette origin:** GSIVDashboard v1 `frontend/style.css` — ported verbatim, never reinvented.

---

## 1. What this is

A token-level design system for the GSIVPlatform dark dashboard:

- A **complete CSS custom-property token set** (surfaces, the sacred status colors, new neutral UI tokens, spacing / radius / type / z-index / shadow / motion / density).
- **13 component primitives** (Button, Input, Select, Badge, Card, Bar, StatusDot, Table, Tabs, Modal, Tooltip, Skeleton, Toast) specified as TypeScript prop sketches, anatomy, and states — so module pages compose consistently without a library dependency yet.
- **Two density presets** (comfortable for phones, compact for desktop power users).
- **A WCAG AA accessibility contract** with computed contrast matrices.

The output is **design + reference CSS only**. No framework, no dependency choices.

## 2. Files in this folder

| File | Contents |
|---|---|
| `README.md` | This index + how to use the system |
| `tokens.md` | Full token catalogue with rationale for every change from v1 |
| `primitives.md` | One section per primitive: props (TS), anatomy, states |
| `density.md` | Comfortable vs compact presets, token deltas, coarse-pointer safety |
| `accessibility.md` | WCAG AA contrast matrices, non-text 3:1 table, focus/keyboard/motion rules |
| `tokens.css` | Reference CSS with the final custom properties (not wired into the app yet) |

## 3. Core principles

1. **Dark-only.** No light theme. `--bg #14161b` is the identity.
2. **The status colors are sacred.** `hp / mana / spirit / mind / resource` (resource bars) and `good / bad / warn` (evaluative states) keep their v1 color meanings forever. Never remap them. `good == mind` and `bad == hp` in value by design — they are distinct *meanings* sharing a value.
3. **Monospace is the identity.** Consolas/Monaco at 14px base. No secondary font — a game-ops dashboard is data, not marketing.
4. **Accessible by default.** Every text color and every UI boundary is chosen to meet WCAG AA, including computed ratios. One deliberate visual change was required: interactive control boundaries use `--border-control` (see `tokens.md` §4 and `accessibility.md`).
5. **Density is a token choice, not a rewrite.** Two presets via CSS custom properties; compact is gated behind `pointer: fine`.
6. **This is a game-ops dashboard, not a SaaS marketing site.** No gradients, no glassmorphism, no rounded-16 marketing cards, no oversized hero type.

## 4. Sacred status semantics (do not change)

| Token | Value | Meaning | Usage |
|---|---|---|---|
| `--hp` | `#ff4040` | Hit points (red) | HP bar, HP text |
| `--mana` | `#4090ff` | Mana (blue) | Mana bar, mana text |
| `--spirit` | `#c040ff` | Spirit (purple) | Spirit bar, spirit text |
| `--mind` | `#33dd33` | Mind (green) | Mind bar, mind text |
| `--resource` | `#66d9ef` | Generic resource / concentration pool (cyan) | Resource bar, stream/rate meters |
| `--good` | `#33dd33` | Positive outcome / success / alive | Toasts, badges, verdicts |
| `--bad` | `#ff4040` | Negative outcome / error / dead | Toasts, badges, verdicts, destructive actions |
| `--warn` | `#ffd633` | Warning / attention | Toasts, badges, pending states |

Rules: a resource bar is *always* its own color; `good/bad/warn` never represent the five pools and the pools never represent success/error.

## 5. How to use the system

1. **Load tokens.** Copy `tokens.css` in as the design-token layer (custom properties only; it does not wire components).
2. **Pick a density.** Default is comfortable. Apply `data-density="compact"` on the root element for desktop power-user surfaces. Coarse pointers automatically fall back to comfortable (see `density.md`).
3. **Compose primitives.** Use the `gs-*` class contract in `primitives.md`. Component state (hover/active/disabled/focus-visible) is token-driven — primitives never hard-code colors.
4. **Check the contract.** `accessibility.md` before shipping: contrast, focus-visible on every interactive element, tap targets, reduced motion.
5. **Respect the sacred table** (§4) when adding module-specific statuses. New statuses may only *reuse* existing values — never invent new semantic hues.

## 6. Class naming convention

- Tokens: `--<category>-<name>`, e.g. `--space-3`, `--radius-md`, `--text-strong`.
- Components: `gs-<component>` with BEM-ish modifiers, e.g. `gs-btn`, `gs-btn--primary`, `gs-btn--md`.
- Density: set on the root element — `data-density="comfortable" | "compact"` (class `.gs-density-compact` is an equivalent alias).

## 7. Deliberate deviations from v1 (all justified in `tokens.md`)

| Change | Why |
|---|---|
| `--border-control #677086` for inputs/selects/control boundaries | v1 `--border #2a2e38` is ~1.3:1 — fails WCAG 1.4.11 non-text 3:1. This is the only *visible* color deviation. |
| `--text-strong`, `--muted-strong` added | v1 had one text color and one muted color; `--muted` is 4.2:1 on panels (fails AA normal text). |
| `--panel-hover`, `--input-bg`, `--focus`, `--overlay`, `--tooltip-bg`, `--skeleton-bg`, `--border-strong` added | Hover/raised/inset/focus/scrim surfaces a component kit needs; all in the same hue family. |
| Bar track radius 3px → 4px (`--radius-xs`) | Folded into the radius scale; visually identical. |
| Everything else | Ported verbatim: all 13 v1 colors, `--bar-track #0d0f13`, Consolas/Monaco 14px, 6–8px radii, 8px status dots, bar fill `width 0.5s ease`. |

## 8. Do / Don't

**Do** use tokens, use `--border-control` for any interactive boundary, pair every status color with text or an icon (never color alone), ship focus-visible everywhere, gate animations behind reduced motion.
**Don't** invent new semantic colors, remap the sacred statuses, introduce a sans-serif body font, create a light theme, hide interactive elements behind hover-only affordances, use motion as the only signal.

## 9. Relationship to the platform

Consumed by the React + Vite shell (`frontend/src/core`) and every module page (`frontend/src/pages/*`). Tokens.css is a reference layer to be wired by the shell, not part of any module. See the modular platform design (§7) for the frontend architecture.
