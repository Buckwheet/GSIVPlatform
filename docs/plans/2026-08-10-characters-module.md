# Characters Module Implementation Plan (managed + systemd)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v1 character management (`/api/characters*`) into GSIVPlatform as the `characters` module — Phase A #3. Per the user's decision, the systemctl execution goes through a **dedicated, review-gated core capability** (the SECURITY.md-mandated path), not inline exec in the module.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts` lines ~543-660 (`readEntryYaml`, `lichUnit`, `systemctl`, `getUnitStatus`, GET /api/characters, POST /:name/start|stop|restart) + `db.ts:291-316` (`managed_characters` table, `getManagedCharacters`, `setManaged`).

**Security model (why the core capability):** SECURITY.md says *"No shell execution, no eval. Future modules that need Ruby entry.yaml access must go through a dedicated, review-gated core capability."* Systemd control is shell-adjacent, so:
- `core/systemd.ts` — the ONLY place that calls `child_process.execFile`. It:
  - exposes a closed set of actions (`start` | `stop` | `restart` | `show`) — anything else fails closed;
  - validates character names against a strict allowlist regex before deriving the unit (`gs4sd-lich@<Name>.service`) — callers never supply a unit string;
  - invokes `execFile` with an **args array** (never a shell string), a timeout, and no env/input; errors surface as `{ok:false, error}`;
  - takes an injectable `exec` function so tests verify the exact argv without a real systemd.
- `core/entry-yaml.ts` — the only place that reads `entry.yaml` (env `ENTRY_YAML_PATH`, default `/opt/gs4sd/lich5/data/entry.yaml`). Parses with the `yaml` npm package (parse-only, no eval), validates each `char_name` against the same strict regex, and returns plain data.

**Key differences from v1:**
- v1 `systemctl()` used `execFile("sudo", ["systemctl", action, unit])` inline; v2 routes call the core capability only.
- v1 `getUnitStatus()` used `execFile("systemctl", ["show", ...])` inline; v2 uses the same capability's `show`.
- v1 tracked managed chars in a SQLite table seeded at boot; v2 keeps them in KV (`characters:managed` → JSON array), seeded once from entry.yaml at boot — same semantics (stop removes the char from managed).
- v1 merged account-scan DB + invdb enrichment into the list; v2 has no scan DB yet (Phase A #4 accounts/entry) and modules never import each other's internals, so the list is entry.yaml chars + systemd status + managed flag. The invdb/scan merge lands with the accounts module.
- v1 did not check whether a name is a known yaml char before acting; v2 returns 404 for start/stop/restart on unknown chars (only launchable yaml chars have units — a strict improvement that prevents acting on arbitrary unit names).
- Route prefixes change: `/api/characters*` → `/api/modules/characters/*`. Lich scripts that poll these (watchdog) must be updated post-deploy (Task 5).

## Module contract

```
name: "characters"
prefix: "/api/modules/characters"
scopes: characters.read, characters.write
routes:
  GET  /characters               characters.read   (entry.yaml chars + systemd status + managed flag)
  GET  /characters/:name         characters.read   (single char status; 404 if not a known yaml char)
  POST /characters/:name/start   characters.write  (systemctl start; 404 unknown char; 500 on exec failure)
  POST /characters/:name/stop    characters.write  (systemctl stop + remove from managed; 404/500)
  POST /characters/:name/restart characters.write  (systemctl restart; 404/500)
```

**Core capability surface (`core/systemd.ts`):**
```ts
class Systemd {
  constructor(exec?: ExecFn, opts?: { sudoActions?: boolean })   // exec injectable for tests
  unitFor(name: string): string                                   // validates name, derives unit
  action(action: "start"|"stop"|"restart", name): Promise<{ok: boolean; error?: string}>
  show(name): Promise<{ active: boolean; sub: string; uptime: number | null }>
}
```

**Core capability surface (`core/entry-yaml.ts`):**
```ts
class EntryYaml {
  constructor(path?: string)             // ENTRY_YAML_PATH or default
  read(): EntryChar[]                    // throws on missing/corrupt (caller catches); validates char_name
}
interface EntryChar { account: string; char_name: string; game_code: string }
```

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 5. `characters.read` is read-only; `characters.write` is the only write scope.
- All SQL prepared statements (none here — KV only). No eval, no shell strings, no `child_process.exec` (only `execFile` arg arrays, confined to core/systemd.ts).
- Unit names derive from strictly validated char names inside the capability; the module never builds unit strings.
- `ENTRY_YAML_PATH` env is never hardcoded in commits (default mirrors v1).
- Rate limiting: module-level limiter applies.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review (dedicated capability is review-gated) before merge.

---

### Task 1: core/systemd.ts capability + tests

**Files:**
- Create: `backend/src/core/systemd.ts`, `backend/tests/core/systemd.test.ts`

- [ ] **Step 1: Write failing tests** — rejects invalid names (`../../x`, `a b`, `foo;rm`, `--help`, empty, unicode) with SystemdError before exec; unitFor derives `gs4sd-lich@Fisternar.service`; action() calls exec with exactly `["systemctl", "start", unit]` (+sudo prefix when enabled) and maps error stderr to `{ok:false, error}`; show() parses ActiveState/SubState/uptime and degrades gracefully on exec error; action allowlist rejects unknown actions at the type/validation level.
- [ ] **Step 2: Run → FAIL. Step 3: implement core/systemd.ts (execFile wrapped in a promise, injectable). Step 4: run → PASS; gate; commit.**

### Task 2: core/entry-yaml.ts capability + tests

**Files:**
- Create: `backend/src/core/entry-yaml.ts`, `backend/tests/core/entry-yaml.test.ts`, `backend/tests/fixtures/entry-yaml.fixture.yaml`
- Add `yaml` npm dependency.

- [ ] **Step 1: Write failing tests** — parses the fixture into account/char_name/game_code rows; rejects a char_name failing the strict regex (corrupt entry) by throwing; missing file throws (caller catches).
- [ ] **Step 2: Run → FAIL. Step 3: implement (fs.readFileSync + YAML.parse, validate, flatten). Step 4: run → PASS; gate; commit.**

### Task 3: CharactersStore — KV managed list + yaml chars

**Files:**
- Create: `backend/src/modules/characters/store.ts`, `backend/tests/modules/characters/store.test.ts`

**Interfaces:**
- Consumes: `KV`, `EntryYaml`, `Systemd`.
- Produces: `class CharactersStore { constructor(kv, yaml, systemd) }`:
  - `seedManagedIfEmpty(): Promise<void>` — seed `characters:managed` from yaml chars when absent
  - `list(): Promise<CharacterRow[]>` — yaml chars + `show()` status + managed flag
  - `get(name): Promise<CharacterRow | null>` — single; null when not a yaml char
  - `start/stop/restart(name)` — validate known char, call systemd, update managed on stop
  - `managed(): Promise<string[]>` / `setManaged(name, bool)`

- [ ] **Step 1: Write failing store tests** (mock Systemd + EntryYaml): seedManagedIfEmpty seeds once and not twice; list() enriches with show() + managed; get() null for unknown; start calls systemd.action; stop removes from managed; restart calls action.
- [ ] **Step 2: Run → FAIL. Step 3: implement. Step 4: run → PASS; gate; commit.**

### Task 4: Module routes + registration

**Files:**
- Create: `backend/src/modules/characters/index.ts`, `backend/tests/modules/characters/routes.test.ts`

- [ ] **Step 1: Write failing routes test** — 401 no-token; 403 read-token on POST start; GET /characters lists fixture chars with status; GET /:name 200/404; start/stop/restart 200 with write scope (mock systemd) and 404 for unknown char; OpenAPI
spec coverage.
- [ ] **Step 2: Run → FAIL. Step 3: implement. Step 4: run → PASS; gate; commit.**

### Task 5: Wire entrypoint + SECURITY.md delta

**Files:**
- Modify: `backend/src/index.ts`, `backend/SECURITY.md`

- [ ] **Step 1: Register characters module** — `new EntryYaml()`, `new Systemd()`, `CharactersStore(kv, yaml, systemd)`, `seedManagedIfEmpty()`, register before `registry.validate()`.
- [ ] **Step 2: SECURITY.md delta** — characters: scopes, core capabilities (systemd/entry-yaml), strict validation, no shell strings, KV managed state, no invdb merge yet.
- [ ] **Step 3: Smoke test** — boot with fixture entry.yaml; GET /characters (systemd missing on Windows → inactive status), start → 500 error path, 401/403 paths, unknown-char 404.
- [ ] **Step 4: security_review (dedicated capability is the review gate); fix findings; commit.**

### Task 6: PR

- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 7: (Follow-on, tracked here) watchdog/Lich URL migration

- Update any server-side watchdog/Lich consumers of `/api/characters*` to `/api/modules/characters/*` post-deploy; retire v1 character routes.

---

## Self-Review Notes

- **Review-gated core capability:** systemctl execution is confined to core/systemd.ts with an allowlist of actions, strict name validation, args-array execFile, injectable exec for tests. entry.yaml reading is confined to core/entry-yaml.ts. This satisfies SECURITY.md's gate.
- **Faithful port:** same routes, unit naming (`gs4sd-lich@<Name>.service`), stop-removes-managed semantics, boot seed of managed list; storage moves from SQLite to KV.
- **Scopes:** read vs write enforced at request time by scopeGuard.
- **Deferred:** account-scan DB + invdb enrichment merge (needs accounts module + cross-module data join — lands with Phase A #4).
