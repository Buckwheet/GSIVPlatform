# "No active characters" flag + alert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Flag `auth ok` accounts with zero active SGE characters, alert on first detection, surface a `/accounts` banner + transfer note, and keep cleanup manual.

**Architecture:** Add `accounts.no_active_chars` set inside `AccountsStore.refresh()` (the shared SGE-check path used by the roster sync and the scan failure re-check), emit `no_chars_alert` on the `0→1` transition, and add transfer detection to `stale()`. Expose the new fields over `/accounts` + `/accounts/stale`, broadcast the WS event, and render the banner/toast in the frontend.

**Tech Stack:** TypeScript (Hono + zod-openapi + better-sqlite3), vitest, biome; React + Vite.

## Global Constraints

- Repo at `D:\Code Projects\GSIVPlatform`; **edits via bash** (file tools refuse `D:\`).
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`.
- No `child_process`/file IO outside core capabilities; flag/alert only reuse `Sge` + `CoreDb`.
- Conventional commits. Test only Fisternar/Neleourg (Amn off-limits).

---

### Task 1: AccountsStore — `no_active_chars` flag + transition alert

**Files:** `backend/src/modules/accounts/store.ts`, `backend/tests/modules/accounts/store.test.ts`

- Add `no_active_chars` to `ScanAccountRow` + a migration `ALTER TABLE accounts ADD COLUMN no_active_chars INTEGER NOT NULL DEFAULT 0`.
- Extend constructor opts with `emit?`/`log?`.
- In `refresh()`, compute `noActiveChars = (authStatus === "ok" && sgeChars.length === 0) ? 1 : 0` (pass `0` on decrypt-error / SGE-error paths).
- In `saveScan(..., noActiveChars)`, persist the column and, reading the previous value first, emit `no_chars_alert {account, message}` + log `no_active_chars` only on `0→1`.
- Tests: flag set/cleared for the four SGE outcomes; emit+log only on transition (not re-flag).

### Task 2: AccountsStore — transfer detection in `stale()`

**Files:** `backend/src/modules/accounts/store.ts`, `backend/tests/modules/accounts/store.test.ts`

- Add `transferred_to?: string | null` to `ScanCharacterRow`.
- In `stale()`, for each `entry_only` char, look up the same name `active` under another account; set `transferred_to`.
- Tests: transferred_to set when active elsewhere, null otherwise.

### Task 3: Routes + ws-bridge + wiring

**Files:** `backend/src/modules/accounts/index.ts`, `backend/src/core/ws-bridge.ts`, `backend/src/index.ts`, `backend/tests/modules/accounts/routes.test.ts`

- `accountSchema` gains `no_active_chars: z.number()`; `characterSchema` gains `transferred_to: z.string().nullable().optional()`.
- Add `"no_chars_alert"` to `EVENT_TYPES` in `ws-bridge.ts`.
- `index.ts`: pass `eventBus.emit` + `eventLog.log` into `AccountsStore`.

### Task 4: Frontend — banner + transfer note + toast

**Files:** `frontend/src/pages/accounts/index.tsx`, `frontend/src/shell/AccountAlerts.tsx` (new), mount point

- `/accounts`: add a "No active characters" banner (accounts with `no_active_chars === 1`); add "possibly transferred to X" to stale chars with `transferred_to`.
- New `AccountAlerts` shell component subscribing to `no_chars_alert` (mirror `ScanAlerts`); mount it where `ScanAlerts` is mounted.

### Task 5: Gate + docs

- Full gate; append a STATUS.md §7 session-log entry.

## Deploy & live smoke

Merge → PR, deploy backend dist + frontend contents, then confirm ADRED flags `no_active_chars=1` + fires the alert on its next scan-failure re-check (Fisternar/Neleourg only).
