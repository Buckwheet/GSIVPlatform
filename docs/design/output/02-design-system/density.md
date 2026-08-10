# Design System 02 — Density Presets (`density.md`)

Two density presets, both pure token deltas on the same component kit:

- **Comfortable** — default; tuned for touch (phones, tablets); WCAG 2.5.8 target size (44px).
- **Compact** — desktop power users; more rows per screen; only ever applied under `pointer: fine`.

## 1. Token deltas

| Token | Comfortable (default) | Compact |
|---|---|---|
| `--density` | `comfortable` | `compact` |
| `--control-height` | `40px` | `32px` |
| `--control-pad-x` | `12px` | `8px` |
| `--control-pad-y` | `8px` | `4px` |
| `--control-gap` | `8px` | `6px` |
| `--table-row-pad-y` | `10px` | `6px` |
| `--table-cell-pad-x` | `12px` | `8px` |
| `--card-pad` | `16px` | `12px` |
| `--card-gap` | `16px` | `12px` |
| `--section-gap` | `24px` | `16px` |
| `--stack-gap` | `12px` | `8px` |
| `--bar-height` | `10px` | `8px` |
| `--tap-target-min` | `44px` | `32px` *(overridden — see §4)* |

**What never changes between densities:** all colors, the sacred status set, font sizes (`--font-size-*`), line heights, radii, z-index, shadow, motion, focus ring, `--dot-size` (8px status dots stay 8px — v1).

Rationale for keeping type constant: compact density is about **information density**, not legibility. Shrinking 14px text to fit more rows would trade away the AA contract for no real gain.

## 2. When to use which

| Context | Preset |
|---|---|
| Default for all new UI | Comfortable |
| Phones / tablets / any coarse pointer | Comfortable (enforced, §4) |
| Desktop power-user surfaces: dense tables, inventory lists, pricing grids, queue/jar management | Compact |
| Anything a user touches | Comfortable |

Mix within a page is allowed for **tables** (`Table` accepts a `density` prop) — a compact table inside an otherwise comfortable page is the one sanctioned exception, because tables are the highest-density content and stay keyboard/mouse operable.

## 3. Implementation

```html
<!-- whole app -->
<html data-density="compact">
<!-- or equivalent class -->
<div class="gs-density-compact">…</div>
```

```css
/* tokens.css defines both blocks; components read the tokens, not the preset */
.gs-density-compact, [data-density="compact"] {
  --control-height: 32px;
  --control-pad-x: 8px;
  …
}
```

Components implement **no size logic** — they consume `--control-*`, `--table-*`, `--card-*` tokens. Switching density is a single attribute change, verified by a visual diff.

## 4. Coarse-pointer safety (mandatory)

Compact presumes a precise pointer (mouse/trackpad). Touch and pen break that assumption:

- Hit targets at 32px fail WCAG 2.5.8 (24px minimum is only an AA floor; 44px is the target for touch) and are ergonomically poor.
- Therefore compact is **gated**: the tokens.css safety rule forces comfortable values whenever `pointer: coarse` is detected, regardless of the attribute.

```css
@media (pointer: coarse) {
  .gs-density-compact, [data-density="compact"] {
    --density: comfortable;
    --control-height: 40px;
    --control-pad-x: 12px;
    --control-pad-y: 8px;
    --control-gap: 8px;
    --table-row-pad-y: 10px;
    --table-cell-pad-x: 12px;
    --card-pad: 16px;
    --card-gap: 16px;
    --section-gap: 24px;
    --stack-gap: 12px;
    --bar-height: 10px;
    --tap-target-min: 44px;
  }
}
```

This covers hybrid devices (touch laptops) automatically: the moment the primary input is coarse, the page renders comfortable.

## 5. Verification checklist

1. Toggle `data-density` and diff: only geometry tokens change.
2. On a touch emulator, compact surfaces render comfortable (the media query fires).
3. No element's text, color, or focus treatment changed between presets.
4. Tables at compact density still show full labels (no truncation that hides meaning).
