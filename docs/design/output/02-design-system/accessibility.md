# Design System 02 — Accessibility (`accessibility.md`)

The accessibility contract: computed WCAG 2.2 AA ratios for every text and UI color, non-text 3:1 table, focus/keyboard rules, tap targets, motion.

## 1. Text contrast — WCAG AA matrix

Relative-luminance method (WCAG 2.x formula), ratios rounded. **AA normal text = 4.5:1; AA large/bold (≥18.66px bold / ≥24px) = 3:1; AAA = 7:1.**

Surface luminances: `--bg #14161b` L≈0.0080 · `--panel #1c1f26` L≈0.0137 · `--input-bg #0f1116` L≈0.0056 · `--bar-track #0d0f13` L≈0.0047.

| Foreground | On `--bg` | On `--panel` | On `--input-bg` | On `--bar-track` | AA normal verdict |
|---|---|---|---|---|---|
| `--text` `#d8dee9` | 13.4 | 12.2 | 14.0 | 14.2 | ✅ PASS (AAA everywhere) |
| `--text-strong` `#e6edf7` | 15.4 | 14.0 | — | — | ✅ PASS (AAA) |
| `--muted` `#808080` | 4.6 | **4.2** | 4.8 | — | ⚠️ on `--panel` only: use for tertiary text at **large/bold** or swap to `--muted-strong` |
| `--muted-strong` `#a2aab8` | 7.7 | 7.0 | 8.1 | — | ✅ PASS (AAA) |
| `--hp` / `--bad` `#ff4040` | 5.2 | 4.8 | 5.5 | 5.5 | ✅ PASS |
| `--mana` `#4090ff` | 5.7 | 5.2 | 6.0 | 6.1 | ✅ PASS |
| `--spirit` `#c040ff` | 4.7 | **4.3** | 4.9 | 5.0 | ⚠️ on `--panel` only: AA-large/UI ✅; for normal text use on `--bg`, or bold |
| `--mind` / `--good` `#33dd33` | 9.9 | 9.1 | 10.4 | 10.5 | ✅ PASS (AAA) |
| `--resource` `#66d9ef` | 11.0 | 10.0 | 11.5 | 11.6 | ✅ PASS (AAA) |
| `--warn` `#ffd633` | 12.9 | 11.7 | 13.4 | 13.6 | ✅ PASS (AAA) |

**Inverse pairs** (dark text on colored fills — solid buttons/badges):

| Fill | Text `--bg #14161b` | Ratio | Verdict |
|---|---|---|---|
| `--text` (primary button) | dark | 13.4 | ✅ |
| `--hp` / `--bad` (danger) | dark | 5.2 | ✅ |
| `--mana` | dark | 5.7 | ✅ |
| `--spirit` | dark | 4.7 | ✅ |
| `--mind` / `--good` | dark | 9.9 | ✅ |
| `--resource` | dark | 11.0 | ✅ |
| `--warn` | dark | 12.9 | ✅ |

**Known limits and the rules they produce:**
1. `--muted` on `--panel` is 4.2:1 → **rule:** any text that must pass AA *normal* on a panel uses `--muted-strong`. `--muted` is reserved for tertiary text on `--bg`, large/bold text, or non-text labels (placeholders are fine at 4.8:1 on `--input-bg`).
2. `--spirit` on `--panel` is 4.3:1 → **rule:** spirit text on panels is only allowed at AA-large/bold or as a non-text element (dots, bars, borders). For normal-size spirit text, render it on `--bg`, or use bold.
3. `--focus` `#66d9ef` passes ≥10:1 on every surface, so the focus ring is never in question.

## 2. Non-text contrast — WCAG 1.4.11 (3:1)

Applies to component boundaries and graphical objects that carry information.

| Element | Colors compared | Ratio | Verdict |
|---|---|---|---|
| Input/Select boundary | `--border-control` vs `--input-bg` | 3.8 | ✅ |
| Input/Select boundary vs page | `--border-control` vs `--bg` | 3.7 | ✅ |
| Secondary button boundary | `--border-control` vs `--panel` | 3.3 | ✅ |
| Focus ring | `--focus` vs any surface | ≥10.0 | ✅ |
| Bar fill — `--hp` | `--hp` vs `--bar-track` | 5.5 | ✅ |
| Bar fill — `--mana` | `--mana` vs `--bar-track` | 6.1 | ✅ |
| Bar fill — `--spirit` | `--spirit` vs `--bar-track` | 5.0 | ✅ |
| Bar fill — `--mind` | `--mind` vs `--bar-track` | 10.5 | ✅ |
| Bar fill — `--resource` | `--resource` vs `--bar-track` | 11.6 | ✅ |
| Status dot (worst case) | `--spirit` vs `--panel` | 4.3 | ✅ |
| Solid badge fill (worst case) | `--spirit` vs `--bg` | 4.7 | ✅ |
| Toast tone accent (worst case) | `--spirit` vs `--panel` | 4.3 | ✅ |
| Tabs active underline | `--text` vs `--panel` | 12.2 | ✅ |
| Skeleton blocks | placeholder, no information yet | — | ✅ exempt |
| Decorative `--border` `#2a2e38` | vs `--panel` / `--bg` | ≈1.3 | ⚠️ exempt as decorative separation; **not** used for interactive boundaries. Card content grouping that must be machine-verifiable should use `--border-strong` or `--panel-hover`. |

**Rule:** `--border` is decorative only. Every *interactive* boundary uses `--border-control`; every state change uses a full-spectrum cue (color + shape + text), never color alone.

## 3. Focus

1. **Never remove outlines.** Keyboard focus is `:focus-visible` → `outline: 2px solid var(--focus); outline-offset: 2px`.
2. Elements that clip outlines (scroll containers, `overflow:hidden`, radius-full) use `box-shadow: var(--shadow-focus)` (2px bg gap + 4px ring).
3. Mouse clicks do **not** paint the ring (`:focus-visible` handles this); keyboard and assistive tech always do.
4. Every interactive element is keyboard-reachable; tab order follows visual layout; the shell provides a skip-to-content link.
5. Focusable-in-scroll elements (dropdown menus, toasts) keep the trigger's context: focus returns where it left.

## 4. Keyboard behavior (per primitive)

| Primitive | Keyboard contract |
|---|---|
| Button / Input / Select | Native semantics; Enter/Space for buttons |
| Badge (dismissible) | Close is a real button |
| Card (interactive) | Renders as button semantics or `tabIndex=0` + `role="button"`; Enter/Space |
| Table | Sortable headers are buttons; interactive rows focusable, Enter/Space activates |
| Tabs | WAI-ARIA tabs: ←/→ (or ↑/↓) move selection, Home/End jump, roving tabindex |
| Modal | Focus moves in on open; focus trap; Esc closes; focus restored to trigger on close |
| Tooltip | Trigger focus shows tip (hover is never the only path) |
| Toast | Close/action focusable; `bad` toasts use `role="alert"` |

## 5. Tap targets

- Coarse pointers: **44×44 CSS px minimum** (WCAG 2.5.8 AA; 2.5.5 AAA target) — that is the comfortable default (`--tap-target-min: 44px`).
- Compact density (32px controls) only under `pointer: fine`; `@media (pointer: coarse)` forces comfortable values (`density.md` §4).
- Inline text links are the WCAG-sanctioned exception to target size; every other control honors it.
- No two targets closer than 8px (`--control-gap`).

## 6. Motion

- All animation is opacity / transform / width, ≤500ms (`--duration-*`).
- `prefers-reduced-motion: reduce` (in `tokens.css`): durations collapse (`--duration-fast/normal/bar: 0ms`, `--duration-slow: 100ms`), continuous animations stop (status-dot pulse → solid; skeleton shimmer → static), bar fills jump to value instantly, modals fade without slide, tooltips fade without slide.
- Motion is never the only information channel: a pulsing dot always has text, an animated bar always has a numeric label.

## 7. Not color alone

Status is always carried by color **plus** text or icon: StatusDot has a label, Bar has a numeric label, Badge tinted variant uses a dot + `--text-strong` label, Toast has text and a tone icon. This covers protanopia/deuteranopia (the red/green pairs `--hp/--mind`, `--good/--bad` share values and are *only* distinguished by label or position — never by hue alone).

## 8. Text size floor

`--font-size-xs` = 11px is the floor for meaningful text, and only for short labels/numbers (all ≥4.5:1). Nothing meaningful renders below 11px. Density never changes font sizes.
