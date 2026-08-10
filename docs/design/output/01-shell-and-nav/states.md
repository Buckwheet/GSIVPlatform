# Loading / Empty / Error / Offline States

## 1. The state model

One `PageState` primitive renders four page states; the shell uses it for
every region so behavior is identical app-wide. Pages (and shell regions)
resolve to exactly one state:

```
kind: "loading" | "empty" | "error" | "ready"     (+ global "offline" overlay)
```

## 2. `PageState` component

| kind | Renders | Defaults |
|---|---|---|
| `loading` | skeleton block (shimmer) sized to the region | aria-busy=true |
| `empty` | icon + headline + hint + optional action button | "Nothing here yet" |
| `error` | headline + detail (collapsed, includes request id) + **Retry** | "Something went wrong" |
| `ready` | children | — |

```tsx
<PageState kind={state.kind}
            icon="🫙" message="No jars in flight"
            action={<Button onClick={startJar}>Start a jar</Button>}
            retry={refetch} detail={error?.requestId} />
```

- `loading` never flashes: entering ready for ≥ 300 ms, or error/empty, hides
  it (min-display to avoid flicker on fast calls).
- Every retry-able region gets a Retry with a 1 s debounce (no double-clicks).

## 3. Shell-level states

| Region | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| AppHeader | skeleton brand bar | — | — | offline badge |
| StatusStrip | gray dots | no live data → "—" per cell | per-cell "?" + tooltip | all dots gray, "offline" label |
| AppNav | skeleton nav (groups ghosted) | (never: core items always present) | nav still renders core items; broken module items show "unavailable" and disable | renders from cached manifest |
| ContentRegion | `PageLoading` | `PageEmpty` | `AppErrorBoundary` fallback w/ reload | `OfflineBanner` + cached content |

## 4. Boot sequence

```
auth → validating:  full-screen splash (logo + spinner)
   ├─ ok → registry fetch
   │     ├─ ok → shell ready
   │     └─ fail → shell degraded (offline banner + Retry), cached manifest used
   └─ fail(401) → LoginView (reason)
   └─ fail(network) → offline splash → Retry
```

## 5. Offline (global, not per-page)

- Trigger: WS closed without 401 + API connectivity probe failing.
- **The shell stays usable.** Nav, cached data, and reading pages keep
  working; writes are blocked with a toast ("You're offline — changes won't
  save") and the offending control disabled.
- `OfflineBanner` (amber, sticky under the status strip): "Offline —
  reconnecting… [Retry now]". Auto-reconnect with exponential backoff
  (1 s → 2 s → … → 30 s cap), manual Retry resets the backoff.
- On reconnect: WS re-auth, cached views marked stale, pages refetch in
  background and update (toast: "Reconnected — data refreshed").

## 6. Error boundary

- `AppErrorBoundary` wraps each route's page. A crash renders
  `ErrorFallback` (page-level, keeps shell frame): headline + "Report bug"
  (includes request id + stack) + "Reload page" + "Go to Dashboard".
- **Shell never dies from a page crash**, and a page crash never tears down
  auth or the WS.
- Boundary resets on route change (new page, fresh chance) — implemented as a
  keyed boundary per route in the router.

## 7. Per-module WS staleness

- A page whose WS feed is stale > 30 s shows a subtle "live updates paused"
  chip, not an error; a manual refresh works. This distinguishes "server
  unreachable" (offline) from "module quiet" (normal).

## 8. Empty-state copy rules

- Say what's missing, not what's broken ("No jars in flight" ≠ "Jars
  unavailable").
- Always pair with a next action when one exists (Start, Refresh, Import,
  Add).
- First-run shell empty states point at the relevant module: "You have no
  characters yet — add one in Characters."
