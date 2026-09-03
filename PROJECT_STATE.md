# Project State

## Goal
Fix config directory resolution in `AccountsStore` (pointing to `join(entryDir, "GSIV")` instead of nonexistent `/opt/gs4sd/data/GSIV`) and implement historical log cleanup (`analysisFiles.deleteCharacterLogs`) across Lich game logs, invdb-logs, and mejora-logs during character deletion.

## What changed
- Enhanced `backend/src/core/analysis-files.ts`:
  - Added `hasCharacterLogs(char)` to check if game logs or scanner logs exist.
  - Added `deleteCharacterLogs(char)` to remove `/opt/gs4sd/lich5/logs/GSIV-<char>`, `/opt/gs4sd/data/invdb-logs/<char>.log`, and `/opt/gs4sd/data/mejora-logs/GSIV-<char>`.
- Enhanced `backend/src/modules/accounts/store.ts`:
  - Added `analysisFiles` capability to `AccountsStore`.
  - Added `has_logs` to `deletePreview`.
  - Added log purge step to `deleteCharacterWithSteps`.
- Unified capability instances in `backend/src/index.ts`:
  - Shared `configFiles` (pointing to `join(entryDir, "GSIV")`) and `analysisFiles` across `accountsStore`, `configModule`, and `analysisModule`.
- Enhanced `frontend/src/pages/characters/DeleteCharacterModal.tsx`:
  - Included historical log deletion status in the preflight warning summary.
- Added tests:
  - `backend/tests/core/analysis-files.test.ts`: Tested `hasCharacterLogs` and `deleteCharacterLogs`.
  - `backend/tests/modules/accounts/store.test.ts`: Tested log check in preview and log deletion step.

## Commands run + results
- `npm test` in backend: 49 test files passed, 377/377 tests passed.
- `npm run typecheck` + `npm run lint` in backend: 0 errors.
- `npm run build` in frontend: Vite built cleanly in 149ms.
- `npm run build` in backend: Built `dist/`.

## Files touched
- `backend/src/core/analysis-files.ts`
- `backend/src/modules/accounts/store.ts`
- `backend/src/index.ts`
- `backend/tests/core/analysis-files.test.ts`
- `backend/tests/modules/accounts/store.test.ts`
- `frontend/src/pages/characters/DeleteCharacterModal.tsx`
- `PROJECT_STATE.md`

## Next 3 actions
- [x] Unify `configFiles` and implement `deleteCharacterLogs`.
- [ ] Commit and push to `main`.
- [ ] Deploy new build to production and clean up leftover Bilz logs & empty config dir on server.
