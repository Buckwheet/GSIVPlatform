# Gems Module Implementation Plan (jar pipeline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v1 jar-status + service-queue features into GSIVPlatform as the `gems` module — the third feature module and the first KV-backed, live-event one. Retires the corresponding v1 routes when complete.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts`:
- Jar routes: `POST /api/jars`, `GET /api/jars`, `GET /api/jars/:char`, `POST /api/jars/claim`, `POST /api/jars/clear` (lines ~235-283).
- Queue routes: `POST /api/queue/join`, `GET /api/queue/status/:service`, `GET /api/queue/next/:service`, `POST /api/queue/done` (lines ~501-541).
- Lich publisher payload: `lich/gs4sd_jarrer.lic` publishes `{ character, full_jars: [{ id, type, portions }], full_jar_count }`.

The port is faithful (same semantics, same event type names), adapted to the GSIVPlatform module contract: scoped auth on every route, KV-backed state, events on the core EventBus instead of v1's `broadcast()`.

**Key differences from v1:**
- v1 stored jar state + queues in Redis (`gs4sd:jars:*`, `gs4sd:queue:*`). v2 uses the core `KV` abstraction (`gems:jars:*`, `gems:queue:*`) — works with InMemoryKV in dev/tests and Redis in prod, no core changes needed.
- v1 had no auth on these routes. v2 requires auth + scope on every route (`gems.read` / `gems.write`).
- v1 broadcast types `jars_update`, `jars_claimed`, `queue_update` become `eventBus.emit(...)` calls — the EventBus is the v2 WS layer; the typed WS socket + topics (`state.gems.jars`) are Phase B frontend work (see `docs/design/output/03-module-pages/ws-data-pattern.md`), which subscribes to these events.
- v1 `GET /api/jars/:char` enriched the response with `room_id` from character state. v2 has no character-state core yet (publisher core is a later Phase A item), so room_id enrichment is deferred — tracked in Task 5.
- Route prefixes change: `/api/jars*` → `/api/modules/gems/jars*`, `/api/queue/*` → `/api/modules/gems/queue/*`. The Lich scripts (`gs4sd_jarrer.lic`, gembank/queue users) must be updated to the new prefix when the module lands (follow-on task, tracked in Task 5).

## Module contract

```
name: "gems"
prefix: "/api/modules/gems"
scopes: gems.read, gems.write
routes:
  GET  /jars                    gems.read   (all jar statuses, sorted by character)
  GET  /jars/:char              gems.read   (single status; missing → { full_jars: [], full_jar_count: 0 })
  POST /jars                    gems.write  (publish/update jar status from Lich; emits jars_update)
  POST /jars/claim              gems.write  ({holder, responder}; 404 if no jar data; emits jars_claimed)
  POST /jars/clear              gems.write  ({character}; clears jar state)
  GET  /queue/status/:service   gems.read   (ordered queue for a service)
  GET  /queue/next/:service     gems.read   ({ next: string|null } — for the mule/service char to poll)
  POST /queue/join              gems.write  ({service, character}; dedupe → { position: "already_queued" } 200; else 201 { ok, position }; emits queue_update)
  POST /queue/done              gems.write  ({service, character}; removes; emits queue_update)
```

**WS events emitted** (EventBus type → payload):
- `jars_update` → `{ character, data }` (full stored status)
- `jars_claimed` → `{ holder, responder }`
- `queue_update` → `{ service, queue }`

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 9. `gems.read` is read-only; `gems.write` is the only write scope.
- No SQL needed (KV-backed); no shell execution, no eval.
- All char names lowercased for storage and keys (matches v1). `full_jars` payload passes through as-is (Lich-defined shape `{id, type, portions}`).
- Rate limiting: module-level limiter applies (120 req/min per authed user) — sufficient for Lich publish cadence.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review before merge.

---

### Task 1: GemsStore — KV-backed jar + queue state

**Files:**
- Create: `backend/src/modules/gems/store.ts`, `backend/tests/modules/gems/store.test.ts`

**Interfaces:**
- Consumes: `KV` (core).
- Produces: `class GemsStore { constructor(kv: KV) }` with methods:
  - `getJars(): Promise<JarStatus[]>` — all statuses, sorted by character
  - `getJar(char): Promise<JarStatus>` — single; missing → `{ full_jars: [], full_jar_count: 0, ts: 0 }`
  - `setJar(char, input): Promise<JarStatus>` — store `{...input, ts: Date.now()}` under `gems:jars:<char>`
  - `claimJar(holder, responder): Promise<JarStatus | null>` — null when no jar data (route 404s); else sets `responder` + `claimed_at`
  - `clearJar(char): Promise<void>`
  - `queueJoin(service, char): Promise<{ position: number | "already_queued" }>`
  - `queueStatus(service): Promise<string[]>`
  - `queueNext(service): Promise<string | null>`
  - `queueDone(service, char): Promise<void>`

- [ ] **Step 1: Write failing store tests** — setJar/getJar roundtrip + ts; getJar missing default; getJars sorted; claim sets responder/claimed_at; claim on missing holder → null; clear removes; queue join dedupe + position + FIFO order; queueNext first; queueDone removes.
- [ ] **Step 2: Run tests → verify FAIL** (module not found).
- [ ] **Step 3: Implement store.ts** — JSON-in-KV with `gems:jars:*` / `gems:queue:*` keys; queue = ordered JSON array (FIFO by join order; 0-based position).
- [ ] **Step 4: Run tests → PASS; run `npx tsc --noEmit` + `npx biome check`; commit.**

### Task 2: Module routes + registration

**Files:**
- Create: `backend/src/modules/gems/index.ts`, `backend/tests/modules/gems/routes.test.ts`

**Interfaces:**
- Consumes: `GemsStore`, `Module` type, `eventBus` (from deps).
- Produces: `createGemsModule(store: GemsStore): Module` — 9 routes, factory pattern; route handlers emit WS events via `deps.eventBus`.

- [ ] **Step 1: Write failing routes test** — 401 no-token on GET /jars; 403 read-token on POST /jars; 200 GET /jars + GET /jars/:char with gems.read; POST /jars 200 with gems.write then visible on GET; claim 404 (no jar data) + 200 sets responder; clear 200; queue join 201 / dedupe 200 / status / next / done; eventBus receives jars_update + queue_update; OpenAPI spec covers `/api/modules/gems/jars` and `/api/modules/gems/queue/status/:service`.
- [ ] **Step 2: Run → FAIL. Step 3: implement (index.ts routes, zod-openapi schemas). Step 4: run → PASS; full gate; commit.**

### Task 3: Wire entrypoint + SECURITY.md delta

**Files:**
- Modify: `backend/src/index.ts`, `backend/SECURITY.md`

- [ ] **Step 1: Register gems module in index.ts** — construct `GemsStore(kv)` after `createKV()` and register `createGemsModule` before `registry.validate()` (module is eager; KV is always available — no failure mode like the optional inventory DB).
- [ ] **Step 2: SECURITY.md delta** — gems: scopes read/write, KV-backed state (no SQL), WS events emitted, queue dedupe semantics.
- [ ] **Step 3: Build + smoke test** — boot with fixture tokens; curl GET/POST jars, claim, queue join/status/next/done; verify 401/403 paths.
- [ ] **Step 4: security_review (full); fix findings; commit.**

### Task 4: PR

- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 5: (Follow-on, tracked here) Lich URL migration

**Files:**
- Modify (in GSIVDashboard repo, NOT GSIVPlatform): `lich/gs4sd_jarrer.lic` (+ any gembank/queue consumers) to point at `/api/modules/gems/jars*` and `/api/modules/gems/queue/*`; when the module is deployed, retire the v1 jar/queue routes.
- Note: executed after the gems module is verified in v2 — a deployment-phase task, listed here for tracking.

---

## Self-Review Notes

- **Faithful port:** same semantics and event type names as v1 — no behavior drift; only prefix, auth model, and storage backend change (KV JSON instead of Redis sorted sets; queues keep FIFO + dedupe).
- **Scopes:** read vs write enforced at request time by scopeGuard (inherits core fix).
- **No SQL:** jar/queue state is ephemeral operational state (like v1 Redis), not durable data — KV is the right home.
- **WS:** events emitted on the core EventBus with v1 type names; the Phase B WS layer maps them to `state.gems.jars` topics per ws-data-pattern.md.
- **Deferred:** room_id enrichment in GET /jars/:char waits for the character-state/publisher core (a later Phase A item).
