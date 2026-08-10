# States — Viewer up / down / loading / auth at every entry point

## 1. State model

Three independent axes combine to decide what every affordance shows:

| Axis | Values | Source |
|---|---|---|
| **V — viewer availability** | `unknown` → `up` \| `down` | Health probe (`/api/modules/gameview/health`, WS-pushed) |
| **C — character running** | `running` \| `stopped` \| `unknown` | Platform state (characters module / WS status strip) |
| **P — pairing** | `n/a` \| `unpaired` (hint) | VellumFE only; the dashboard sees this **only if** the health payload reports it, otherwise `n/a` |

Dashboard-visible state = `V` × `C`. Pairing (`P`) is a hint layer, never a gate: the dashboard can't know it, so it never blocks the link — the viewer owns the pairing screen.

### Viewer availability transitions

```
        probe in flight
   unknown ────────────► up ──────────────┐
      │  ▲               │   probe fails  │
      │  │ auto-retry    ▼                │
      │  └─────── (stale → degrade) ◄─────┘
      └────────────► down ──► Retry pressed ──► unknown
        probe fails
```

- `unknown`: no result yet (first paint, probe in flight, or just after a Retry). Renders as **checking** (amber).
- `up`: last probe OK. Stale if `now - lastChecked > 3 × interval` → treat as `down` until next probe (never show a green dot on stale data).
- `down`: probe failed or timed out; `Retry` fires an immediate probe.

## 2. State matrix by entry point

### 2a. Nav item "Game View"

| V | C | Rendered | Action |
|---|---|---|---|
| unknown | any | Amber dot, "checking…" | navigate to `/game-view` |
| up | ≥1 running | Green dot + badge `2` | navigate to `/game-view` |
| up | 0 running | Green dot, no badge | navigate to `/game-view` |
| down | any | **Red dot**, tooltip "VellumFE viewer offline" | navigate to `/game-view` (page shows banner + Retry) |
| stale | any | Red dot (degraded), tooltip "viewer offline" | same as down |

Nav item is never disabled — the overview page is where the offline state lives.

### 2b. Per-character Watch (status strip / Characters page)

| V | C | Rendered | Action |
|---|---|---|---|
| unknown | running | Button disabled, spinner-in-button "checking…" | — (enables within one probe) |
| up | running | **`Watch` enabled** (primary) | open new tab |
| up | stopped | hidden (Characters page) / disabled "not running" (strip) | — |
| down | running | **disabled** + reason "Viewer offline — retry" (tooltip) | — |
| up | unknown | enabled with amber "status?" hint (rare) | open new tab |
| down | stopped | hidden | — |

Rules: a disabled Watch always carries a visible reason; it is never silently gray. A stale V renders as down.

### 2c. Game View overview page

| State | UI |
|---|---|
| loading (first paint) | Skeleton: status card + 3 list-row skeletons |
| viewer up | Green card: "Up · v2.4.1 · checked 3s ago"; running list with enabled Watch |
| viewer down | **Red banner**: "VellumFE viewer offline — Watching is unavailable." + `Retry`; Watch buttons disabled with reason; stopped list shown |
| viewer checking | Amber card "Checking viewer…" |
| empty | "No characters running" + a `Watch`-less state; nav stays visible |
| unpaired (hint, if VellumFE reports it) | Info chip: "First visit? You'll pair once in the viewer." |

### 2d. Auth (pairing) states — all entry points

| P | What the dashboard shows | What the user sees in the viewer |
|---|---|---|
| n/a (default; dashboard can't know) | one-line hint at first visit | viewer's pairing screen → token entry → live view |
| `unpaired` (only if health payload exposes it) | hint chip/icon near Watch | same as above |
| paired | nothing | straight to live view (VellumFE remembers, A2) |

The dashboard **never** stores, forwards, or pre-fills the pairing token. If it did know a pairing was missing it still opens the tab — the viewer owns the flow, and `returnTo` brings the user back.

## 3. Loading / in-flight states

- **New-tab handoff is synchronous** — the dashboard has no "loading the viewer" step, which is the payoff of the new-tab decision (an iframe would have forced an in-page viewer-loading state). Optionally show a transient toast "Opening viewer…" on slow devices for assistive feedback; it must not block the click.
- **Health probe in flight** shows as amber "checking…", never as a false green/red.
- **Character start→running** (Characters page): Watch animates disabled→enabled on the WS `running` event without a reload.

## 4. Viewer-down handling — every entry point, no broken tab

1. **Watch buttons** — disabled with reason (2b). Clicking never opens a dead tab.
2. **Nav** — red dot; clicking still works and lands on the overview page (4), which is the *recovery surface*: banner + `Retry`.
3. **Overview page** — red banner + `Retry`; the health card shows `lastChecked` and the probe error so support can be actioned.
4. **Already open tab dies mid-viewing** — the viewer tab is VellumFE's; the dashboard can't fix it. When the user returns to the dashboard tab, the dot is red and `Retry` is available. (This is the resilience case the new-tab model wins on.)
5. **Down-detection disabled (degradation)** — if the health assumptions A1–A3 (see `deep-link-contract.md`) can't be met, the dashboard treats V as permanently `up` and relies on the viewer's own error UI; `states.md` §2's down rows then don't apply. Flagged loudly in config logs.

## 5. State ownership (who computes what)

| Thing | Owner |
|---|---|
| V (viewer up/down) | platform backend probe → `gameview.health` route → WS push |
| C (character running) | characters module / platform WS |
| P (pairing) | VellumFE only (dashboard hint layer, best-effort) |
| Combined affordance state | frontend `useGameView()` hook (derives `unknown/up/down` from V, enables Watch when `V=up && C=running`) |

The hook is a thin composition of the health push + character state — no streaming logic, no VellumFE internals.
