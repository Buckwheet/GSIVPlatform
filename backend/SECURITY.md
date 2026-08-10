# GSIVPlatform — Security Model

## Auth
- Bearer tokens from `AUTH_TOKENS` env (`name:token[:scope1,scope2]`).
- Missing scopes => full admin (`*`). This is intentional and documented;
  scope-less tokens are the bootstrap/admin path. Real friend tokens must
  declare explicit scopes.
- Constant-time token comparison (`crypto.timingSafeEqual`).
- Per-token scope lists enforced per route via `scopeGuard` (derived from the
  module's `routeScopes` map) — **enforced at request time, not just validated
  at boot**.
- KV audit keys are full SHA-256 hashes of the token — never the token itself.

## Scopes
- Every route MUST declare a scope; scopeGuard enforces at request time (fail-closed 403), and buildSpec throws when serving /api/spec if any route is missing from routeScopes (registry.validate() checks scope usage/key format at boot).
- Admin `*` bypasses scope checks.
- A route whose path matches no `routeScopes` entry returns 403 (fail closed).
- No route may be public unless explicitly mounted outside `/api/modules/*`
  (only `/health` is public today).

## Rate limiting
- Sliding window per authed user (keyed by token owner name), 120 req/min
  default, applied at module mount. Keyed by authenticated user — not by
  client-supplied headers — so it cannot be spoofed.
- Public endpoints (`/health`) have no rate limit; keep them side-effect-free.

## Data
- All SQL through better-sqlite3 prepared statements.
- No shell execution, no eval. (Future modules that need Ruby entry.yaml
  access must go through a dedicated, review-gated core capability.)

## Secrets
- `.env` gitignored. `.env.example` contains placeholders only.
- No secrets in tests or docs. Lockfiles are committed (they pin versions)
  but contain no credentials.
- The `admin:changeme:*` value in `.env.example` is a placeholder — replace it
  with a real generated token (UUID) in `.env`, never commit `.env`.

## Future module gate
Every module plan MUST include: scopes declared and used, routeScopes coverage
(so `scopeGuard` can enforce), rate-limit appropriateness, a `SECURITY.md`
delta, and a security_review pass before merge.

## Module: inventory (first feature module)
- Read-only SQLite over the production `inv.db3` (opened `{ readonly: true }`).
- Single scope `inventory.read` on all 7 GET routes (enforced by scopeGuard).
- DB path from `INV_DB_PATH` env, never hardcoded in commits.
- Server boots without inventory if the DB is missing (module skipped with a warning) — availability never depends on inv.db3.
- No write queries, no shell execution.

## Module: pricing (sales-tracker fold-in)
- Scopes: `pricing.read` (sales/intelligence/listings read), `pricing.write` (POST /listings), `pricing.scrape` (POST /scrape). All enforced by scopeGuard.
- Scraper fetches public data from `https://shops.elanthia.online/data/removed_items.json` — no credentials; ETag cached in scrape_state to avoid redundant fetches. External host is rate-limited by the module-level limiter plus the operator's manual trigger cadence (no scheduled auto-scrape by default).
- All SQL prepared statements; the only free-text input (`q` in /sales, gem_type in /gems/*) is bound via named parameters — LIKE wildcards are not escaped (matches v1 behavior; filter-only, not injection).
- Pricing DB is a core service: open failure is fatal (server does not boot silently degraded, unlike optional inventory).

## Module: gems (jar pipeline)
- Scopes: `gems.read` (jar statuses, queue reads), `gems.write` (publish jar status, claim/clear, queue join/done). All enforced by scopeGuard.
- State is KV-backed operational data (`gems:jars:*`, `gems:queue:*`) — ephemeral like v1's Redis, not durable records; no SQL, no shell execution.
- Queues are FIFO by join order with dedupe (already-queued returns `position: "already_queued"`); char names are lowercased for storage and keys.
- Queue join/done is a non-atomic KV read-modify-write (single-key JSON array). v1 used atomic Redis sorted sets; at this scale (one mule, a handful of characters) lost updates are an accepted, documented trade-off rather than a risk.
- WS events emitted on the core EventBus: `jars_update`, `jars_claimed`, `queue_update` — server-authoritative state; REST remains the source of truth (per ws-data-pattern.md).
- `full_jars` payloads pass through as published by the Lich jarrer (`{id, type, portions}`) — treated as opaque data, validated structurally.

## Module: healer
- Scopes: `healer.read` (status, requests, next), `healer.write` (register, heartbeat, request/accept/complete). All enforced by scopeGuard.
- State is KV-backed operational data (`healer:registry:<char>`, `healer:requests`) — ephemeral like v1's in-memory Maps, but reboot-resilient; no SQL, no shell execution.
- Healers are pruned when their heartbeat is >30s stale (on /status reads); the request list is capped at 50 (pruned on complete) — both faithful to v1.
- Request creation/accept/complete is a non-atomic KV read-modify-write on `healer:requests` (single-key JSON array; same accepted trade-off as the gems module queues). request_id comes from `kv.incr`, which is atomic in both KV backends.
- `request_id`s come from an atomic KV counter (`kv.incr`); char names lowercased for registry keys.
- WS events emitted on the core EventBus: `healer_update`, `heal_request`, `heal_accepted`, `heal_complete` — server-authoritative; REST remains the source of truth.
- `next/:healer` only exposes the oldest pending request whose room matches the healer's current room; request bodies are structurally validated.

## Module: characters (managed + systemd)
- Scopes: `characters.read` (list + status), `characters.write` (start/stop/restart). All enforced by scopeGuard.
- **Shell execution is confined to the review-gated core capability `core/systemd.ts`** — the only place `child_process.execFile` is used. It allowlists actions (`start`/`stop`/`restart`/`show`, fail-closed otherwise), strictly validates character names before deriving units (`gs4sd-lich@<Name>.service`), and always calls execFile with an **args array** (never a shell string) + timeout. Routes never build unit strings.
- **entry.yaml access is confined to `core/entry-yaml.ts`** (parse-only via the `yaml` package, no eval); each `char_name` is validated against the same strict regex. `ENTRY_YAML_PATH` env, default `/opt/gs4sd/lich5/data/entry.yaml` — never hardcoded in commits.
- Managed list is KV-backed (`characters:managed`, lowercased names), seeded once at boot from entry.yaml; `stop` removes the char from managed (watchdog won't restart it) — v1 semantics.
- start/stop/restart 404 on unknown characters (only launchable entry.yaml chars have units) — stricter than v1.
- No invdb/account-scan enrichment yet (needs the accounts module; cross-module imports are forbidden) — lands with Phase A #4.
