# WS Live-Data Pattern

One shared live-data hook, defined once, used by **all** WS-fed pages. It is the only sanctioned way a page consumes the real-time event bus (`core/ws.ts`). This document defines the contract, the hook API, and the lifecycle (subscribe, buffering, reconnect, stale indicator). Reference-implementation sketches are clearly marked; they live in `frontend/src/core`, never in pages.

---

## 1. Non-negotiables

- **One socket.** The shell owns a single WebSocket connection (connected after auth, see brief 01 `auth-flow.md`). Pages never open sockets.
- **One hook.** Pages call `useWsData` / `useWsEvent` / `useWsStatus` from `frontend/src/core/ws.ts`. No page implements its own subscription logic.
- **WS is read-side only.** Commands go over REST (`POST /api/modules/...`). WS delivers state snapshots and deltas so the UI reflects what the server decided. This keeps claim/clear/accept flows server-authoritative.
- **REST stays the source of truth.** WS accelerates updates; every data region can be rebuilt from REST (`GET`) alone.

---

## 2. Event taxonomy (server → client)

The bus carries three message classes (per approved design `core/ws.ts`):

| Class | Topic pattern | Meaning | Example |
|---|---|---|---|
| `state.*` | `state.<module>.<resource>` | Current snapshot of a resource; the "value" pages render | `state.gems.jars` — jar list; `state.characters.status` |
| `stream.*` | `stream.<module>.<resource>` | High-frequency point/line data (append-only) | `stream.analysis.progress`, `stream.pricing.import` |
| `module.*` | `module.<module>.<event>` | Coarse lifecycle/activity events (one-shot) | `module.accounts.scanned`, `module.bounty.completed` |

**Envelope** (all classes):

```ts
interface WsEnvelope {
  type: "state" | "stream" | "module";
  topic: string;          // e.g. "state.gems.jars"
  seq: number;            // server-monotonic per topic
  payload: unknown;       // snapshot | delta | event body
  at: number;             // server time ms
}
```

- `seq` is the ordering/duplication guard: a client drops any message whose `seq <= lastSeq[topic]`.
- The server sends a **snapshot** (`state.*` full payload) immediately after a client subscribes, then **deltas** for subsequent changes.
- A **heartbeat** (`{type:"state", topic:"__hb__", ...}` or a dedicated ping) is sent on an interval agreed with the client; its absence drives the stale indicator (§6).

Modules declare their topics in the module contract (`wsEvents` map in the approved design §4).

---

## 3. Hook API

```ts
// reference sketch — implemented once in frontend/src/core/ws.ts

type FeedState = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

interface UseWsDataOptions<T> {
  topic: string;                 // "state.gems.jars"
  initial: T;                    // value before first snapshot
  select?: (prev: T, payload: unknown) => T;  // apply a delta
  staleAfterMs?: number;         // default: heartbeatInterval * 2.5
}

interface WsDataResult<T> {
  data: T;                 // current value (last snapshot + applied deltas)
  feed: FeedState;         // connection state of this topic
  stale: boolean;          // true when heartbeat overdue / feed not fresh
  lastUpdatedAt?: number;  // server time of last applied message
  refetch: () => void;     // request a fresh snapshot (manual)
}

function useWsData<T>(opts: UseWsDataOptions<T>): WsDataResult<T>;
function useWsEvent(topic: string, handler: (payload: unknown) => void): void;
function useWsStatus(): FeedState; // global strip (brief 01) reads this
```

**Usage rule:** `select` must be a pure reducer (immutable updates). Data regions keyed by id (lists) patch rows by id; stream topics append points.

---

## 4. Subscription lifecycle

```
Page mounts ──▶ useWsData(topic) ──▶ core ws client
                                        │ 1. subscribe(topic) to socket (ref-counted)
                                        │ 2. server replies snapshot (seq=N)
                                        │ 3. client sets data=snapshot, feed="connected"
                                        │ 4. deltas arrive → select(prev, delta)
Page unmounts ─▶ cleanup ──▶ unsubscribe(topic)
```

- **Ref-counting:** if two pages/listeners subscribe to the same topic, the wire sends one `subscribe`; only the last unsubscribe closes it. This makes the live character strip and a Characters page coexist safely.
- **Late-join:** a page that mounts after the snapshot still receives a fresh snapshot on subscribe — no replay buffer needed on the client for state topics.
- **Buffering (while disconnected):** the hook holds a **bounded delta buffer** (e.g. last 100 messages per topic). While `reconnecting`/`offline`, arriving deltas are queued. On reconnect:
  1. Drop buffered deltas for the topic.
  2. Resubscribe → server sends a **fresh snapshot** (reconciliation; deltas buffered during the gap are superseded by the snapshot).
  3. Apply the snapshot; mark `connected`.
  - Rationale: snapshots make per-message replay unnecessary. The buffer only covers the sub-second window between socket-up and resubscribe-ack, and is cleared on snapshot.
- **Out-of-order / duplicates:** guarded by `seq` (drop `seq <= lastSeq`).

---

## 5. Reconnect

- **Backoff:** 1s → 2s → 4s → 8s → cap 30s, with ±20% jitter; reset to 1s on a successful connection.
- **Feed states:** `connecting` (initial), `connected`, `reconnecting` (lost, backing off), `offline` (socket failed / auth lost — shell handles reauth per brief 01).
- **Behavior during reconnect:** data keeps rendering from the last snapshot (no spinner); `stale` becomes `true`; the board strip shows `reconnecting` with a warn dot.
- **Exhausted reconnects:** after N failures the hook marks `offline` and the shell surfaces reauth/retry; `refetch()` (REST) is always available as a manual recovery.

---

## 6. Stale indicator

- **Definition:** a topic is **fresh** while heartbeats arrive within `staleAfterMs` (default `heartbeatInterval × 2.5`). Missing a heartbeat flips `stale=true`.
- **UI mapping** (shared across pages, primitives from brief 02):

| `feed` | Dot | Label | Data shown |
|---|---|---|---|
| `connecting` | neutral | "connecting…" | skeleton |
| `connected`, fresh | `--good` | "live · 2s ago" | live data |
| `reconnecting` | `--warn` | "reconnecting… · last update 12s ago" | last-known data |
| `offline` | `--bad` | "offline · data as of 14:02" | last-known data |
| `stale=true` (any non-connected) | `--warn`/`--bad` | "stale · Xs ago" | last-known data |

- The **Live status board** renders this in its board strip (Pattern 3); List/Search shows a small dot beside the result count; Detail shows it in the header meta line.
- **Not-stale ≠ no-events:** a jar that hasn't changed in an hour is *not* stale — staleness is about the feed/heartbeat, not data activity. Never flash "stale" merely because nothing changed.

---

## 7. Error handling

- **Parse/decode errors:** the hook catches malformed envelopes, logs once, and requests a fresh snapshot (self-healing).
- **Topic not found / permission denied on subscribe:** server replies an error envelope; the hook surfaces `feed="offline"` with a tooltip "no permission to this stream" (scope-gated topics, see `scope-driven-ui.md`).
- **Delta apply throws (bad `select`):** hook catches, rolls the topic back to the last good snapshot, and refetches.
- Pages never see raw socket errors — only `feed`/`stale`/`lastUpdatedAt`.

---

## 8. Anti-patterns (do not do these)

- ❌ Opening a second WebSocket in a page.
- ❌ `setInterval` polling a WS-fed region as a fallback.
- ❌ Mutating `data` directly (breaks delta application and re-render batching).
- ❌ Custom JSON over WS (typed envelope only — the OpenAPI spec doesn't cover WS; the envelope is the contract).
- ❌ Ignoring `stale` (the whole point is ops surfaces must not silently freeze).

---

## 9. Batching / performance

- The client **coalesces** multiple deltas for the same topic within one animation frame into a single `setState` (bursts of jar/queue updates render once per frame, not once per message).
- Lists keyed by id patch by key; unchanged rows are referentially stable so React skips re-render.
