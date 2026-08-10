# GSIVPlatform Backend

Modular Hono backend. Features are modules registered in the core registry.

## Commands

    npm install
    npm run dev        # tsx watch
    npm run build      # tsc -p tsconfig.build.json -> dist/
    npm start          # node dist/index.js
    npm test           # vitest run
    npm run typecheck  # tsc --noEmit
    npm run lint       # biome check
    npm run format     # biome format --write

## Config (.env)

    REDIS_URL=             # empty => in-memory KV fallback
    AUTH_TOKENS=admin:tok:*  # name:token[:scopes] (missing scopes = admin)
    PORT=3100
    DB_PATH=data/gsiv.db

## Adding a module

1. Create `src/modules/<name>/index.ts` exporting a `Module` (see
   `src/core/types.ts`).
2. Declare `scopes` + `routeScopes` for every route — `scopeGuard` enforces
   them at request time.
3. Register it in `src/index.ts` and add tests in `tests/modules/<name>/`.
4. Run `npm test && npm run typecheck && npm run lint` and pass a security
   review (see SECURITY.md for the module gate).

## Endpoints

- `GET /health` — public liveness.
- `GET /api/modules/<name>/...` — module routes (Bearer + scope, rate-limited).
- `GET /api/spec` — merged OpenAPI spec (Bearer).
