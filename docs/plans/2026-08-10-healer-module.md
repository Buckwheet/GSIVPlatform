# Healer Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v1 healer service into GSIVPlatform as the `healer` module — Phase A #2. Healer registry, pending requests, accept/complete, WS live updates.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts` lines ~1372-1481 (`/api/healer/*`) + `lich/gs4sd_healer.lic` (register, heartbeat, poll `/next/:healer`, accept, complete).

**Key differences from v1:**
- v1 kept healers + requests in **process memory** (lost on restart). v2 stores them in the core `KV` abstraction (`healer:registry:<char>`, `healer:requests`) — reboot-resilient, no core changes, same InMemoryKV/Redis duality as the gems module.
- v1 request_id used an in-process counter. v2 uses `kv.incr("healer:req_counter")` (atomic) → `heal_<n>_<Date.now()>`.
- v1 had no auth on these routes. v2 requires auth + scope (`healer.read` / `healer.write`).
- v1 broadcast types `healer_update`, `heal_request`, `heal_accepted`, `heal_complete` become `eventBus.emit(...)` calls.
- Route prefixes change: `/api/healer/*` → `/api/modules/healer/*`. Lich script (`gs4sd_healer.lic`) must be updated when the module lands (follow-on task, Task 5).
- The service queue used by healer polling in v1 (`/api/queue/*`, gembank/healer) is already ported in the gems module — healer uses `next/:healer` matching, not the queue.

## Module contract

```
name: "healer"
prefix: "/api/modules/healer"
scopes: healer.read, healer.write
routes:
  GET  /status           healer.read   ({ healers, pending } — prunes stale healers >30s no heartbeat)
  GET  /requests         healer.read   (last 20 requests)
  GET  /next/:healer     healer.read   ({ target, room_id, request_id } | { target: null } — oldest pending in healer's room)
  POST /register         healer.write  ({character, room_id, prof?, level?}; emits healer_update)
  POST /heartbeat        healer.write  ({character, room_id}; upsert + last_heartbeat)
  POST /request          healer.write  ({character, room_id, hp?, max_hp?, wounds?}; emits heal_request)
  POST /accept           healer.write  ({request_id, character, target}; emits heal_accepted)
  POST /complete         healer.write  ({request_id, character, target, status?}; emits heal_complete; prune to last 50)
```

**WS events emitted** (EventBus type → payload, matching v1 broadcast):
- `healer_update` → `{ healers }` (array of HealerInfo)
- `heal_request` → `{ request }`
- `heal_accepted` → `{ request_id, healer, target }`
- `heal_complete` → `{ request_id, healer, target, status }`

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 8. `healer.read` is read-only; `healer.write` is the only write scope.
- No SQL needed (KV-backed operational state); no shell execution, no eval.
- Char names lowercased for registry keys (matches v1). `room_id` comparisons in `/next/:healer` are stringified (v1 compared `String(room_id) === String(healer.room_id)`).
- Stale-prune threshold 30s and requests cap 50 are faithful to v1.
- Rate limiting: module-level limiter applies (120 req/min per user) — healer heartbeat cadence is far below.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review before merge.

---

### Task 1: HealerStore — KV-backed registry + requests

**Files:**
- Create: `backend/src/modules/healer/store.ts`, `backend/tests/modules/healer/store.test.ts`

**Interfaces:**
- Consumes: `KV` (core).
- Produces: `class HealerStore { constructor(kv: KV) }`:
  - `register(char, roomId, prof?, level?): Promise<HealerInfo>`
  - `heartbeat(char, roomId): Promise<HealerInfo>`
  - `request(char, roomId, opts?): Promise<HealRequest>` — id via `kv.incr`
  - `nextFor(healer): Promise<{target, room_id, request_id} | null>` — oldest pending in same room
  - `accept(requestId, healer, target): Promise<void>`
  - `complete(requestId, status): Promise<void>` — sets status; prune to last 50
  - `status(): Promise<{ healers, pending }>` — prunes stale (>30s) healers
  - `requests(): Promise<HealRequest[]>` — last 20

- [ ] **Step 1: Write failing store tests** — register + status lists healer; heartbeat upsert + refreshes timestamp; request creates pending with unique id; nextFor returns oldest pending in same room (and null for different room / missing healer); accept marks accepted + sets healer; complete sets status + prunes to 50; status prunes stale healers.
- [ ] **Step 2: Run tests → verify FAIL. Step 3: implement store.ts. Step 4: run → PASS; gate; commit.**

### Task 2: Module routes + registration

**Files:**
- Create: `backend/src/modules/healer/index.ts`, `backend/tests/modules/healer/routes.test.ts`

**Interfaces:**
- Consumes: `HealerStore`, `Module` type, `eventBus`.
- Produces: `createHealerModule(store: HealerStore): Module` — 8 routes, factory pattern; handlers emit WS events.

- [ ] **Step 1: Write failing routes test** — 401 no-token; 403 read-token on POST /request; register→status flow; request→next→accept→complete flow; missing-param 400s; eventBus receives healer_update/heal_request/heal_accepted/heal_complete; OpenAPI spec covers healer paths.
- [ ] **Step 2: Run → FAIL. Step 3: implement. Step 4: run → PASS; gate; commit.**

### Task 3: Wire entrypoint + SECURITY.md delta

**Files:**
- Modify: `backend/src/index.ts`, `backend/SECURITY.md`

- [ ] **Step 1: Register healer module** — `HealerStore(kv)` after `createKV()`, register `createHealerModule` before `registry.validate()`.
- [ ] **Step 2: SECURITY.md delta** — healer: scopes, KV-backed state, WS events, stale-prune semantics.
- [ ] **Step 3: Smoke test** — boot with fixture tokens; curl register/heartbeat/request/next/accept/complete/status/requests; verify 401/403 paths.
- [ ] **Step 4: security_review; fix findings; commit.**

### Task 4: PR

- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 5: (Follow-on, tracked here) Lich URL migration

- Update `lich/gs4sd_healer.lic` (in GSIVDashboard repo) to `/api/modules/healer/*` post-deploy; retire v1 healer routes.

---

## Self-Review Notes

- **Faithful port:** same semantics, thresholds, and event type names as v1; storage moves from process memory to KV (a strict improvement — reboot-resilient).
- **Scopes:** read vs write enforced at request time by scopeGuard.
- **No SQL:** healer state is ephemeral operational state — KV is the right home.
- **WS:** events emitted on the core EventBus with v1 type names; Phase B maps them to topics per ws-data-pattern.md.
