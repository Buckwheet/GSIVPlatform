# Design Brief 02 — Design System

## Context

GSIVPlatform greenfield rewrite of GSIVDashboard (Gemstone IV service
dashboard). Read the approved design
`docs/design/2026-08-10-modular-platform-design.md` and brief 01 (shell) for
context. This brief defines the **visual language** every module page shares.

## Existing v1 theme (source of truth to port — do not invent a new palette)

From `D:\Code Projects\GSIVDashboard\frontend\style.css`:

```css
:root {
  --bg: #14161b;        --panel: #1c1f26;    --border: #2a2e38;
  --text: #d8dee9;      --muted: #808080;
  --hp: #ff4040;        --mana: #4090ff;     --spirit: #c040ff;
  --mind: #33dd33;      --resource: #66d9ef;
  --good: #33dd33;      --bad: #ff4040;      --warn: #ffd633;
}
```

Font: `'Consolas', 'Monaco', monospace`, 14px base. Border-radius 6-8px,
panels on `--panel` with `--border` outlines. Status dots are 8px circles.
Bar tracks `#0d0f13` with 3px radius, fills transition `width 0.5s ease`.

## Goal

Turn these ad-hoc values into a real **design system**: tokens, primitives,
and a component kit that module pages compose. Same dark identity, but
consistent, accessible, and pleasant — not "terminal default".

## Requirements

1. **Token set**: define a complete CSS custom-property set: colors (semantic:
   bg/panel/border/text/muted + status: hp/mana/spirit/mind/resource/good/bad/
   warn + any new ones you justify), spacing scale, radius scale, font stack
   (keep monospace as the base identity; justify any secondary font),
   type scale, z-index scale, shadow/depth, motion (transitions/durations).
2. **Status semantics**: resource bars (HP/mana/spirit) and status indicators
   must keep their color meaning — never remap those colors.
3. **Primitives**: define the base components: Button (variants), Input, Select,
   Badge/Tag, Card/Panel, Bar (resource bar), StatusDot, Table, Tabs,
   Modal/Dialog, Tooltip, Skeleton, Toast. For each: API sketch (props),
   anatomy, and states (default/hover/active/disabled/focus).
4. **Density**: two density presets (comfortable for phone, compact for
   desktop power users) with the token changes each implies.
5. **Accessibility**: contrast ratios for all text-on-bg combos (WCAG AA),
   focus-visible styling, minimum tap targets (44px), reduced-motion
   consideration.
6. **Dark-only**: no light theme required. Do NOT introduce color meaning
   beyond the existing game semantics.

## Constraints

- Output is **design + CSS token reference**, not a library implementation.
  No dependency choices. Component API sketches in TypeScript type form are
  fine.
- Keep the identity: this is a game-ops dashboard, not a SaaS marketing site.

## Deliverables (Markdown in `docs/design/output/02-design-system/`)

1. `README.md` — index + how to use the system.
2. `tokens.md` — the full token table with rationale for changes from v1.
3. `primitives.md` — one section per primitive (props, anatomy, states).
4. `density.md` — the two density presets.
5. `accessibility.md` — contrast table, focus, motion notes.
6. `tokens.css` — a reference CSS file with the final custom properties
   (reference only, not wired into the app yet).
