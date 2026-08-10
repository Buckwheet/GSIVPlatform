# Entry Points — Game View

Every place a user can start watching a character, with the exact UI treatment. All entry points resolve to the same builder (`buildVellumDeepLink`, see `deep-link-contract.md`) and all surface the same availability states (see `states.md`). Viewer-up = health probe green; viewer-down = red; checking = amber.

## 1. Nav item — "Game View"

Registry-driven nav (brief 01): a normal nav entry, not a plain external link.

```
[GSIVPlatform]        ⚙ Config    🔎 Analysis   🎮 Game View ●   👤 Characters
                                                  status dot: ● up / ● down / ● checking
                                                  badge: number of running characters (2)
```

- **Treatment:** standard nav item with a live **status dot** (reuses shell `StatusDot`): green = viewer up, red = viewer down, amber = health probe in flight. Optional badge with the count of running characters.
- **Behavior:** always navigates (SPA route `/game-view`) to the **Game View overview page** (see §4). It is **not** disabled when the viewer is down — the overview page is where the user sees the offline banner and retry. Red dot + title tooltip "VellumFE viewer offline".
- **Keyboard:** focusable, standard `aria-current="page"` when active.
- **Scope:** visible when the token has at least `characters.read` (or a dedicated `gameview.read` if we prefer to scope it — see `deep-link-contract.md` §Configuration). Without scope, nav item hidden.

## 2. Global status strip — per-character Watch

Brief 01's always-visible status strip lists running characters. Each running character gets a compact "Watch" affordance.

```
┌──────────────────────────────────────────────────────────┐
│ ● WS connected   ● Server up   ● Fisternar [Watch]   Zim [Watch] │
└──────────────────────────────────────────────────────────┘
```

- **Treatment:** text button `Watch` next to each running character in the strip. Compact on mobile (icon-only 👁 with `aria-label="Watch Fisternar"`).
- **Enabled** only when: character `running` **and** viewer `up`. Otherwise the button is disabled with a reason tooltip (see `states.md` — "viewer offline" / "not running").
- **Click:** opens `buildVellumDeepLink(charName, { returnTo: currentUrl })` in a new tab.

## 3. Characters page — per-character Watch

Every character row/card in the Characters module page gets a Watch action, placed with the other primary row actions.

```
┌ Fisternar ──── Lvl 100 ── running  [Start] [Stop] [👁 Watch] ┐
└ Zim ────────── Lvl 98 ─── stopped  [Start]        (Watch hidden)┘
```

- **Watch shown** for characters in any state (you may want to watch even if the viewer shows an idle/lobby screen), but **enabled only** when the character is `running` and the viewer is `up`; otherwise disabled + reason tooltip.
- **No Watch affordance** if the token lacks `characters.read` (scope-driven UI, brief 03).
- After starting a character, the Watch button animates from disabled→enabled as soon as platform WS reports `running` (no page reload).

## 4. Game View overview page (route `/game-view`) — the hub

The nav destination: one place to see viewer health + all running characters.

```
┌──────────────────────────────────────────────────────┐
│ Game View                                    [Retry]  │
│                                                      │
│  Viewer status: ● Up — v2.4.1 · checked 3s ago        │  ← health card
│  (viewer down → red banner + Retry button)           │
│                                                      │
│  Running characters                                  │
│  ┌ Fisternar ── playing ── [👁 Watch]               ┐ │
│  ┌ Zim ──────── playing ── [👁 Watch]               ┐ │
│                                                      │
│  Stopped characters (collapsed)                      │
│  First visit? You'll pair once inside the viewer.    │  ← auth hint
└──────────────────────────────────────────────────────┘
```

- **Sections:** (a) **Viewer status card** — up/down, version + last-checked when available, `Retry` button, and a "first visit? pair once in the viewer" hint; (b) **running characters list** from platform state, each with Watch; (c) collapsed stopped/offline characters; (d) empty state "No characters running" when nothing to watch.
- **Refresh:** page subscribes to the health WS push and to platform character-state WS events — no manual reload.
- This page is the fallback destination for nav clicks while the viewer is down.

## 5. Keyboard shortcut (optional, progressive enhancement)

- **`Alt+Shift+G`** anywhere in the shell (ignored when focus is in an input/textarea) → navigate to `/game-view`.
- Documented in the `?` shortcut help. Register in the shell; this is enhancement, not a requirement.
- No per-character shortcut; per-character actions stay click-only to avoid ambiguous bindings.

## 6. Fallback — shareable/pasted deep link

- The user can always reach a character by opening `buildVellumDeepLink(charName)` themselves (e.g. from an external chat, a bookmarked URL). The dashboard simply guarantees the URL shape is stable and documented (`deep-link-contract.md`).
- Dashboard-side states apply only to the four affordances above; a pasted URL is handled entirely by VellumFE.

## Non-negotiable rules across all entry points

1. **One URL builder.** Every affordance calls `buildVellumDeepLink(charName, opts)` from core — no ad-hoc string concatenation anywhere.
2. **No disabled-by-lying.** A disabled Watch always has a visible reason (tooltip/inline): "Viewer offline — retry" or "Character not running".
3. **New tab, always** (`target="_blank"`, `rel="noopener noreferrer"`).
4. **Never a bare `https://` guess.** Base URL comes from config, never hardcoded.
