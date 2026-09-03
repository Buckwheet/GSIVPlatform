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
- PR & Deployment:
  - Created PR #58 and merged into `main` (`79ee241`).
  - Built backend and frontend production distributions.
  - Deployed to OVH production server (`ubuntu@51.68.235.144`).
  - Successfully restarted `gsiv-platform.service` and verified live assets via Caddy (`HTTP/2 200`).

## Commands run + results
- `git push -u origin feat/character-deletion`: Pushed branch.
- `gh pr create` + `gh pr merge 58 --merge`: Merged PR #58 into `main`.
- `npm run build` in `backend`: Built `dist/`.
- `npm run build` in `frontend`: Built `dist/assets/index-CwNoeldM.js`.
- `scp` + `ssh` deploy: Deployed to `/opt/gsiv-platform/` and restarted `gsiv-platform.service`.
- Verified live service: `active`, journal logged `gsiv-platform listening on :3102`, and bundle `index-CwNoeldM.js` returned `HTTP/2 200` with `text/javascript`.

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
- [x] Merge PR #58 to `main`.
- [x] Deploy build to production server and restart `gsiv-platform.service`.
- [ ] Monitor production logs and verify character deletion workflow in the live browser UI.
