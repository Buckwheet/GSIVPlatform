# Project State

## Goal
Implement end-to-end character deletion pipeline across backend (systemd, watchdog KV, Redis telemetry, inv.db3 cascade, gsiv.db, entry.yaml, config archival) and frontend (React confirmation modal with preflight preview and TOTP authentication).

## What changed
- Enhanced `backend/src/core/inv-db.ts`: Added `charItemCount` to `InvDbCleaner` and `InvDb` to support previewing affected items prior to deletion.
- Enhanced `backend/src/core/config-files.ts`: Added `archive(char)` capability to move character script configs to `.archived/<char>.<timestamp>` rather than destroying them.
- Enhanced `backend/src/modules/accounts/store.ts`:
  - Injected `systemd`, `kv`, and `configFiles` into `AccountsStore`.
  - Added `deletePreview(accountName, charName)` for preflight checks.
  - Implemented complete 7-stage teardown in `deleteCharacterWithSteps`: stops active systemd unit, evicts from watchdog and clears KV telemetry, removes from `entry.yaml`, deletes from `account_characters`, cascade-deletes from `inv.db3` with automatic backup, archives configs, and emits `character_deleted` event with audit logging. Supports `dryRun`.
- Enhanced `backend/src/modules/accounts/index.ts`:
  - Added `GET /entry/account/:name/character/:char/preview` endpoint (scope: `accounts.read`).
  - Added `dry_run` support to `DELETE /entry/account/:name/character/:char` (scope: `accounts.write`, TOTP-gated).
- Wired in `backend/src/index.ts`: Passed live `Systemd`, `KV`, and `ConfigFiles` capabilities into `accountsStore`.
- Added test coverage:
  - `tests/core/config-files.test.ts`: Added `archive` capability test.
  - `tests/core/inv-db.test.ts`: Added `charItemCount` test.
  - `tests/modules/accounts/routes.test.ts`: Tested preview and complete delete steps.
  - `tests/modules/accounts/store.test.ts`: Added unit tests for `deletePreview`, full teardown pipeline, and `dryRun` mode.
- Created `frontend/src/pages/characters/DeleteCharacterModal.tsx`:
  - React confirmation modal with preflight breakdown (running status, inventory item count, config files) and 2FA TOTP input.
- Integrated into frontend pages:
  - `frontend/src/pages/characters/index.tsx`: Added `Delete` action button (`variant="danger"`) in the character actions column (guarded by `accounts.write`) with modal trigger.
  - `frontend/src/pages/accounts/index.tsx`: Added individual `Delete` action buttons next to each stale character in the roster issues banner.

## Commands run + results
- `npm test` in `backend`: 49 test files passed, 376 tests passed (0 failures).
- `npm run typecheck` in `backend`: 0 type errors (`tsc --noEmit`).
- `npm run lint` in `backend`: Biome check passed with 0 errors.
- `npm run build` in `frontend`: Vite client built cleanly in 141ms (`dist/index.html` + chunks).
- `npm run typecheck` in `frontend`: 0 type errors.

## Files touched
- `backend/src/core/config-files.ts`
- `backend/src/core/inv-db.ts`
- `backend/src/modules/accounts/store.ts`
- `backend/src/modules/accounts/index.ts`
- `backend/src/index.ts`
- `backend/tests/core/config-files.test.ts`
- `backend/tests/core/inv-db.test.ts`
- `backend/tests/modules/accounts/routes.test.ts`
- `backend/tests/modules/accounts/store.test.ts`
- `frontend/src/pages/characters/DeleteCharacterModal.tsx`
- `frontend/src/pages/characters/index.tsx`
- `frontend/src/pages/accounts/index.tsx`
- `PROJECT_STATE.md`

## Next 3 actions
- [ ] Commit changes to `feat/character-deletion` branch in `GSIVPlatform`.
- [ ] Present feature walkthrough and verification steps to user.
- [ ] Merge to main when user approves and deploy to production server.
