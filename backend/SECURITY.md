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
- Every route MUST declare a scope (registry + spec boot validation).
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
