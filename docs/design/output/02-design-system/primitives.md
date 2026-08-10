# Design System 02 — Component Primitives (`primitives.md`)

13 primitives. Each section: **Role**, **Props (TypeScript)**, **Anatomy**, **States**, **A11y notes**.

Conventions:
- Class prefix `gs-`, BEM-style modifiers (`gs-btn--primary`).
- Components are **token-driven**: they never hard-code colors, radii, or spacing.
- All interactive elements get `:focus-visible` per `accessibility.md`.
- Density is inherited from `--control-*` / `--table-*` / `--card-*` tokens (see `density.md`), so primitives have **no size prop except `sm/md` where a deliberate smaller control is wanted**.

---

## 1. Button

**Role:** trigger an action. Variants map to action weight, not color meaning.

```ts
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';                 // md = comfortable, sm = compact-friendly

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;                      // default 'secondary'
  size?: ButtonSize;                            // default 'md'
  type?: 'button' | 'submit' | 'reset';         // default 'button'
  disabled?: boolean;
  loading?: boolean;                            // shows spinner, blocks clicks
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;                           // required for icon-only buttons
  title?: string;                               // native tooltip only; else <Tooltip>
  dataTestid?: string;
}
```

**Anatomy**

```
┌──────────────────────────┐
│ [spinner]  Save changes  │   <button class="gs-btn gs-btn--secondary gs-btn--md">
└──────────────────────────┘
```
Elements: `button.gs-btn` (single element; icons and spinner are inline children). Height from `--control-height`, padding `--control-pad-*`, radius `--radius-sm`, font `--font-size-md`, weight `--font-weight-bold`.

Variant mapping:
| Variant | Resting | Hover | Active |
|---|---|---|---|
| `primary` | bg `--text`, color `--bg` | bg `--text-strong` | brightness 0.94 |
| `secondary` | bg `--panel`, border `--border-control`, color `--text` | border `--border-strong`, bg `--panel-hover` | bg `--panel-hover`, brightness 0.96 |
| `ghost` | transparent, no border, color `--text` | bg `--panel-hover` | bg `--panel` |
| `danger` | bg `--bad`, color `--bg` (5.2:1) | brightness 1.1 | brightness 0.94 |

**States**
| State | Appearance / behavior |
|---|---|
| default | Per variant table above |
| hover | Per variant table above (cursor: pointer) |
| active | Pressed (per variant table) |
| focus-visible | `outline: 2px solid var(--focus); outline-offset: 2px` |
| disabled | `opacity: 0.5; cursor: not-allowed`; no hover/active changes |
| loading | Spinner replaces icon (not label); `aria-busy="true"`; clicks blocked |

**A11y:** native `<button>`; icon-only buttons require `ariaLabel`; `danger` uses dark text on red because white-on-red is only 3.3:1; loading never removes the label from the a11y tree.

---

## 2. Input

**Role:** single-line text/number entry.

```ts
interface InputProps {
  id: string;
  label?: string;                               // visible label; else aria-label
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'search' | 'password' | 'email';
  placeholder?: string;
  prefix?: string;                              // e.g. "$", "lvl", "%"
  suffix?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;                            // error styling
  errorText?: string;                           // shown when invalid
  hint?: string;                                // always-visible helper text
  autoFocus?: boolean;
}
```

**Anatomy**

```
  LEVEL            <label class="gs-input__label" for="gs-lvl">LEVEL</label>
┌───────────────┐
│ lvl ▏ 42     │   <div class="gs-input"><span class="gs-input__prefix">lvl</span>
└───────────────┘        <input id="gs-lvl" class="gs-input__control" ...>
  Must be ≥ 1         <p class="gs-input__hint">…</p> | <p class="gs-input__error">…</p></div>
```
Control fill `--input-bg`, border `--border-control` (≥3:1), radius `--radius-sm`, inset shadow `--shadow-inset`, text `--text`, placeholder `--muted`, prefix/suffix `--muted-strong`.

**States**
| State | Appearance / behavior |
|---|---|
| default | As above |
| hover | Border mixes toward `--focus`: `color-mix(in srgb, var(--focus) 40%, var(--border-control))` |
| focus-visible | Border `--focus` + `outline: 2px solid var(--focus); outline-offset: 0` (ring inside to avoid clipping) |
| disabled | `opacity: 0.6`, no focus, `cursor: not-allowed` |
| readOnly | Normal look, no focus ring emphasis, not in tab order as editable |
| invalid | Border `--bad`, error text `--bad` (4.8:1 on panel), `aria-invalid="true"` |

**A11y:** label or `aria-label` required; `aria-describedby` connects hint/error; error state is *never* color-only (error text is always present); 44px hit target in comfortable density.

---

## 3. Select

**Role:** choose one option from a closed list. Native select (no custom popup) in v1 styling.

```ts
interface SelectOption { value: string; label: string; disabled?: boolean }

interface SelectProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;                         // rendered as a disabled empty option
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  errorText?: string;
  hint?: string;
}
```

**Anatomy**

```
  TARGET ▾          <label class="gs-select__label">TARGET</label>
┌──────────────┐    <div class="gs-select">
│ orc warchief ▾│       <select class="gs-select__control">…</select>
└──────────────┘       <span class="gs-select__chevron" aria-hidden="true">▾</span>
                     </div>
```
Same fill/border/radius tokens as Input. Chevron is decorative (`aria-hidden`), drawn with CSS/`▾` — never an extra tab stop.

**States:** identical to Input (default/hover/focus-visible/disabled/invalid). `option:disabled` renders muted.

**A11y:** native `<select>` gives keyboard + screen-reader behavior for free; label required; invalid state carries `aria-invalid` + error text (not color-only).

---

## 4. Badge / Tag

**Role:** compact status or category label. Color comes only from the sacred status set.

```ts
type BadgeColor = 'neutral' | 'hp' | 'mana' | 'spirit' | 'mind' | 'resource' | 'good' | 'bad' | 'warn';
type BadgeVariant = 'tinted' | 'solid' | 'outline';

interface BadgeProps {
  label: React.ReactNode;
  color?: BadgeColor;                           // default 'neutral'
  variant?: BadgeVariant;                       // default 'tinted'
  dot?: boolean;                                // leading 8px status dot
  dismissible?: boolean;
  onDismiss?: () => void;                       // required if dismissible
  title?: string;
}
```

**Anatomy**

```
• CASTING  ×      <span class="gs-badge gs-badge--tinted gs-badge--warn">
                   <span class="gs-badge__dot">…</span>
                   <span class="gs-badge__label">CASTING</span>
                   <button class="gs-badge__dismiss">×</button>
                 </span>
```

Variant rules (chosen for contrast — see `accessibility.md`):
| Variant | Background | Text | Border | Dot |
|---|---|---|---|---|
| `tinted` (default) | `--tint-<color>` | `--text-strong` | `--border` | status color |
| `solid` | status color | `--bg` (dark; worst case 4.7:1) | same | none |
| `outline` | transparent | status color if ≥4.5:1, else `--text-strong` | status color | optional |
| `neutral` | `--panel` | `--text-strong` | `--border-control` | none |

*Note: `--spirit` text on `--panel` is 4.3:1 (<4.5) and tinted spirit fills drop below 3:1 — that's why tinted badges use `--text-strong` + a colored dot instead of colored text.*

**States:** static by default; `dismissible` adds a real `<button>` with default/hover/focus-visible states and 24px hit area (acceptable: close affordance inside a larger control — still keep ≥24px per WCAG exception for inline). `neutral` is the fallback for category tags with no status meaning.

**A11y:** dot is decorative when a text label exists; for icon-only usage add `title`/aria-label; color is never the sole channel.

---

## 5. Card / Panel

**Role:** content grouping on `--panel` with `--border` outline (v1 panels).

```ts
interface CardProps {
  title?: React.ReactNode;
  headerActions?: React.ReactNode;              // top-right actions
  children: React.ReactNode;
  footer?: React.ReactNode;
  interactive?: boolean;                        // clickable card
  onClick?: () => void;
  padding?: 'default' | 'compact' | 'none';
  ariaLabel?: string;
}
```

**Anatomy**

```
┌─────────────────────────────┐
│ TITLE                [acts] │   <section class="gs-card">
│ ─────────────────────────── │     <header class="gs-card__header">…
│   body…                     │     <div class="gs-card__body">…
│ ─────────────────────────── │     <footer class="gs-card__footer">…
│ footer                      │   </section>
└─────────────────────────────┘
```
Fill `--panel`, border `--border`, radius `--radius-md`, padding `--card-pad`, header/footer gap `--card-gap`. Title uses `--text-strong`; section headers use `--font-size-md`, weight bold, `--letter-spacing-label` optional.

**States**
| State | Appearance / behavior |
|---|---|
| default | As above |
| hover (interactive) | bg `--panel-hover`, border `--border-strong`, `--shadow-sm` |
| focus-visible (interactive) | outline `--focus` (or `--shadow-focus` if card clips) |
| active (interactive) | bg `--panel-hover`, translateY(0), brightness 0.98 |
| disabled | N/A — cards don't disable |

**A11y:** `interactive` renders as a real button/`tabIndex=0`+`role="button"` wrapper with full focus/keyboard handling; static cards use `section`+`aria-label` only when they have a semantic name.

---

## 6. Bar (resource bar)

**Role:** the sacred resource bars (HP / mana / spirit / mind / resource). Colors are non-negotiable.

```ts
type BarColor = 'hp' | 'mana' | 'spirit' | 'mind' | 'resource';

interface BarProps {
  value: number;                                // current
  max?: number;                                 // default 100
  color: BarColor;
  label?: string;                               // visible text, e.g. "128 / 240"
  size?: 'sm' | 'md';                           // md = comfortable height, sm = compact
  animated?: boolean;                           // default true (reduced-motion aware)
  ariaLabel?: string;                           // e.g. "Hit points 128 of 240"
}
```

**Anatomy**

```
┌──────────────────────────────────────┐
│ ████████████░░░░░░░░  128 / 240    │   <div class="gs-bar gs-bar--hp" role="meter"
└──────────────────────────────────────┘          aria-valuenow="128" aria-valuemin="0"
```
`track` bg `--bar-track #0d0f13` (v1), radius `--radius-xs`, height `--bar-height`; `fill` bg `--color` (the BarColor), width `%`, transition `width var(--duration-bar) var(--ease-bar)` (v1's `width 0.5s ease`). Label right-aligned, `--muted-strong`.

**States**
| State | Appearance / behavior |
|---|---|
| default | Fill at `value/max` width |
| animated | Fill animates on mount/update over 500ms |
| reduced-motion | Fill jumps instantly (`--duration-bar: 0ms` in `tokens.css`) |
| low/critical | Supplied by *color* choice (caller picks `--warn`/`--bad` semantics) — the primitive never remaps colors itself |

**A11y:** `role="meter"` with `aria-valuenow/min/max` (or `progressbar` for indefinite); the numeric `label` means the bar is never color/position-only; fills are ≥3:1 against the track for every color (5.0–11.6:1, see `accessibility.md`).

---

## 7. StatusDot

**Role:** 8px status indicator. Colors come only from the sacred status set.

```ts
type StatusColor = 'hp' | 'mana' | 'spirit' | 'mind' | 'resource' | 'good' | 'bad' | 'warn';

interface StatusDotProps {
  color: StatusColor;
  label: string;                                // REQUIRED — visible or aria text
  pulse?: boolean;                              // "live" indicator animation
  size?: 'sm' | 'md';                           // md = 8px (v1 default), sm = 6px
  title?: string;
}
```

**Anatomy**

```
● HEALTHY     <span class="gs-dot"><span class="gs-dot__core gs-dot--good">…</span> HEALTHY</span>
```
Core: `--dot-size` 8px circle, `--radius-full`, bg status color. Pulse = expanding box-shadow ring (opacity only, gated by reduced motion).

**States:** static; `pulse` when live (e.g. connected WS stream); reduced-motion turns pulse off (dot stays solid).

**A11y:** the `label` is mandatory — a bare colored dot fails "not color alone". If the text is visually hidden, provide `aria-label` on a `role="status"` container.

---

## 8. Table

**Role:** dense data display — the heart of a game-ops dashboard.

```ts
interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  sortable?: boolean;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  ariaLabel: string;                            // REQUIRED
  density?: 'comfortable' | 'compact';          // default: inherit page density
  stickyHeader?: boolean;
  maxHeight?: string;                           // with stickyHeader, scrolls body
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
}
```

**Anatomy**

```
┌ ITEM     QTY  PRICE ┐  <table class="gs-table gs-table--sticky">
│ broadsword 3 1.2m   │    <thead><tr><th>…</th></tr></thead>
│ …                    │    <tbody><tr>…</tr></tbody>
└──────────────────────┘
```
Header bg `--panel` (opaque when sticky), text `--muted-strong` bold, uppercase label tracking; cells `--font-size-sm`, row padding `--table-row-pad-y`/`--table-cell-pad-x`; row hover bg `--panel-hover`; zebra optional `color-mix(in srgb, var(--text) 2%, var(--bg))`; numeric cells `text-align: right` (monospace aligns beautifully); row borders `--border` at 1px.

**States**
| State | Appearance / behavior |
|---|---|
| header default | `--muted-strong` bold |
| header hover (sortable) | `--text-strong`; sort arrow appears |
| row hover | bg `--panel-hover` |
| row selected | bg `color-mix(in srgb, var(--focus) 10%, var(--panel))` + left 2px `--focus` bar |
| row focus-visible (interactive) | outline `--focus` |
| empty | `emptyState` in a centered cell (never an empty grid) |

**A11y:** `ariaLabel` required; real `<th scope>`; sortable headers are `<button>`s (keyboard sortable); `onRowClick` rows are keyboard-focusable with Enter/Space; sticky header keeps `aria` semantics (use `position: sticky` on `th`, not a second table).

---

## 9. Tabs

**Role:** switch between sibling panels of one module page.

```ts
interface Tab { id: string; label: React.ReactNode; disabled?: boolean }

interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'underline' | 'pill';               // default 'underline'
  ariaLabel?: string;                           // REQUIRED (tablist name)
}
```

**Anatomy**

```
┌ INVENTORY │ PRICING │ GEMS ┐   <div class="gs-tabs" role="tablist">
└─────────────────────────────┘    <button role="tab" aria-selected="true" …>
                                  <div role="tabpanel">…
```
Underline variant: text `--muted-strong`, active `--text-strong` + 2px `--text` underline. Pill variant: active bg `--panel-hover` + `--border-control`. Container border-bottom `--border`.

**States**
| State | Appearance / behavior |
|---|---|
| default | Per variant |
| hover | `--text-strong` |
| active (selected) | Underline / pill per variant; `aria-selected="true"` |
| focus-visible | outline `--focus` |
| disabled | `--muted` at 0.5, not selectable, skipped in arrow nav |

**A11y:** WAI-ARIA tabs pattern — `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`; **arrow-key navigation** with roving `tabindex`; Home/End jump; panels get `tabIndex={0}` when focus must move into them.

---

## 10. Modal / Dialog

**Role:** focused, blocking task (confirm, edit form).

```ts
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;                     // action row (buttons)
  size?: 'sm' | 'md' | 'lg';                    // md default
  closeOnBackdrop?: boolean;                    // default true
  closeOnEsc?: boolean;                         // default true
  initialFocusRef?: React.RefObject<HTMLElement>;
}
```

**Anatomy**

```
╔══════════════════════╗
║ TITLE            ✕   ║   <div class="gs-modal" role="dialog" aria-modal="true"
║ body (scrollable)    ║        aria-labelledby="…">
║ ───────────────────  ║   <div class="gs-modal__scrim">  (--overlay, z 40)
║ [Cancel] [Confirm]   ║   <div class="gs-modal__dialog"> (--panel, --radius-md, z 50)
╚══════════════════════╝
```
Scrim `--overlay rgba(8,10,13,0.72)`; dialog bg `--panel`, border `--border`, `--shadow-lg`, radius `--radius-md`, max-width per size (sm 360 / md 480 / lg 720px). Body scrolls independently.

**States / behavior**
| State | Behavior |
|---|---|
| open | Scrim fades (`--duration-normal`), dialog fades+slightslides (`--duration-slow`) |
| focus | Focus moves into dialog on open; trap inside; restore to trigger on close |
| Esc | Closes (if `closeOnEsc`) |
| backdrop click | Closes (if `closeOnBackdrop`) |
| reduced-motion | Fade only, no slide |

**A11y:** `role="dialog"` + `aria-modal="true"` + labelled by title; focus trap; focus restore; body scroll locked; close button has `aria-label="Close"`; never two modals stacked without a documented reason.

---

## 11. Tooltip

**Role:** supplementary explanation on hover/focus. Never required to complete a task.

```ts
interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;                    // trigger (focusable or tabIndex=0)
  placement?: 'top' | 'bottom' | 'left' | 'right'; // default 'top'
  delayMs?: number;                             // default 400
  disabled?: boolean;
}
```

**Anatomy**

```
       content          <span class="gs-tooltip"> (wrapper)
  ┌──────────────┐
  │ some detail  │         trigger → on hover/focus-visible shows
  └──────────────┘
        ▲                    tip bg --tooltip-bg, border --border, radius --radius-sm,
      [trigger]              --shadow-md, text --text-strong (12:1)
```

**States**
| State | Behavior |
|---|---|
| hidden | Not in DOM / invisible; not focusable |
| hover (pointer) | Shows after 400ms |
| focus-visible (keyboard) | Shows on trigger focus — **required** for keyboard parity |
| disabled | Never shows |
| reduced-motion | Fade only, no slide |

**A11y:** triggered by both hover and keyboard focus (WCAG 1.4.13 — content is hoverable, dismissible via Esc, and not persistent-then-hidden); tip text is exposed to AT via `role="tooltip"` + `aria-describedby` on the trigger. Tooltips must not be the only place an essential value appears.

---

## 12. Skeleton

**Role:** loading placeholder. Decorative by definition — exempt from non-text contrast (it carries no information yet).

```ts
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  variant?: 'text' | 'circle' | 'bar' | 'block'; // default 'block'
  lines?: number;                               // for variant 'text'
}
```

**Anatomy**

```
▁▁▁▁▁▁▁▁  text lines: <div class="gs-skeleton gs-skeleton--text" aria-hidden="true">
▁▁▁▁▁▁▁▁              <span class="gs-skeleton__line" style="width:…">…
```
Fill `--skeleton-bg`, radius from variant (text `--radius-xs`, circle `--radius-full`, bar `--radius-xs`); shimmer = moving highlight `linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)` over `--skeleton-bg`.

**States:** static; shimmer animation gated by reduced motion (static blocks instead).

**A11y:** container uses `aria-busy="true"` + `role="status"`; skeleton elements themselves `aria-hidden="true"`; never place real content under skeletons (use `aria-live` for actual content arrival). Not subject to 1.4.11 contrast (placeholder, no information).

---

## 13. Toast

**Role:** transient feedback. Tone colors come from the sacred set.

```ts
type ToastTone = 'good' | 'bad' | 'warn' | 'info';

interface Toast {
  id: string;
  tone: ToastTone;
  title?: React.ReactNode;
  message: React.ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;                            // ms; default 5000; 0 = sticky
}

interface ToastHostProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  position?: 'top-right' | 'bottom-right' | 'top-center'; // default 'top-right'
}
```

**Anatomy**

```
┌────•────────────────┐   <div class="gs-toast gs-toast--bad" role="alert">
│  ◦  Death occurred  │     <span class="gs-toast__icon">◦</span>
│     …               │     <div class="gs-toast__body"><p class="gs-toast__title">…
└─────────────[✕][OK]─┘     <div class="gs-toast__actions">…
```
Bg `--panel`, border `--border`, radius `--radius-md`, `--shadow-lg`, **left 3px accent in tone color** (≥3:1 on panel for every tone). `info` uses `--focus`/`--resource` accent with `--text` title. Icon = status dot or `✓/!/✕` glyph.

**States / behavior**
| State | Behavior |
|---|---|
| appear | Slide+fade in (`--duration-normal`) from the edge |
| hover | Auto-dismiss timer pauses |
| dismiss | Fade out; close `✕` is a real button with focus-visible |
| reduced-motion | Fade only |
| sticky | `duration: 0` — stays until dismissed |

**A11y:** `good/warn/info` toasts use `role="status"` (polite); `bad` toasts use `role="alert"` (assertive) — errors are never announced only visually. Close/action buttons are focusable. Toasts are **never the only channel** for an error (module pages keep an error state in the page body too).
