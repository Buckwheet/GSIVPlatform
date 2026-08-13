# "No active characters" account flag + alert — Design Spec

**Date:** 2026-08-13
**Status:** design (pre-plan)

## 1. Summary

When an account's SGE authentication is still `ok` but SGE reports **zero active
characters** (a char was sold, deleted, or transferred away), flag the account
and alert the operator so they can cancel billing. Gone characters are **not**
auto-deleted from `inv.db3` (a "gone" char may simply have been transferred to
another account); instead the existing "Clean up stale" step remains the manual
final cleanup, and the stale list gains a **transfer note** when a gone char is
`active` under a different account.

## 2. Problem

Today the roster sync (SGE `listCharacters` per account) already distinguishes
`active` vs `entry_only` chars and `auth_status`, but:

- An account that authenticates fine yet has **no active characters** is not
  distinguishable from any other `auth_status = ok` account — the operator has to
  notice a stale char manually.
- There is no alert when an account drops to zero active characters, so a
  subscription can keep billing with no one noticing.
- `inv.db3` cleanup is manual-only, and when it does run there is no hint that a
  "gone" char might actually have been **transferred** to another account (which
  would make deleting its inventory data — and its account — premature).

## 3. Goals / Non-goals

**Goals**
- Flag an account as `no_active_chars` when `auth ok` + zero active SGE chars.
- Alert (WS toast + EventLog) when an account first enters that state.
- Surface the flag on `/accounts` (a dedicated banner, distinct from the
  auth-error "Roster issues").
- Add a **transfer note** to the stale-char list: when an `entry_only` char name
  is `active` under a different account, show "possibly transferred to X".
- Detect on the daily cycle (the fresh SGE re-check already built into the scan
  failure path) *and* the weekly roster sync.

**Non-goals**
- Auto-deleting gone chars from `inv.db3` (transfer ambiguity — stays manual).
- Changing the existing "Clean up stale" removal semantics.
- Roster-sync Phase B (play.net inactive-char scrape).

## 4. Recorded decisions

| Decision | Choice |
|---|---|
| Flag storage | New `accounts.no_active_chars` column (0/1) |
| Flag set when | `auth ok` AND SGE active-char list is empty |
| Alert trigger | Each detection (re-alert while the account stays empty) |
| Alert surface | WS `no_chars_alert` toast + EventLog + `/accounts` banner |
| Cleanup | Unchanged — manual "Clean up stale" (full removal) |
| Transfer detection | Cross-reference `account_characters`: entry_only char name `active` under another account |

## 5. Data model (gsiv.db, module `accounts`)

```sql
ALTER TABLE accounts ADD COLUMN no_active_chars INTEGER NOT NULL DEFAULT 0;
```

`account_characters` is unchanged. Transfer detection is a computed field (not a
new column) added to the `GET /accounts/stale` response.

## 6. Backend

### 6.1 AccountsStore

- **Migration**: add `no_active_chars` (see §5).
- **Constructor**: gain optional `emit(type, payload)` and
  `log(type, char, detail, source)` callbacks (same shape ScansStore uses).
- **`refresh()`**: compute `noActiveChars = (authStatus === "ok" && sgeChars.length === 0) ? 1 : 0`
  (always `0` on the decrypt-error / SGE-error paths), and pass it to `saveScan`.
- **`saveScan(…, noActiveChars)`**: persist the column in the accounts upsert;
  emit on each detection while the account stays empty
  `no_chars_alert { account, message }` and log `no_active_chars` to EventLog.
- **`stale()`**: for each `entry_only` char, look up whether the same char name
  (case-insensitive) is `active` under a different account; if so add
  `transferred_to` (that account name) to the returned char.
- **`list()`**: unchanged (`SELECT *` now carries `no_active_chars`).

### 6.2 Routes (`accounts` module)

- `accountSchema` gains `no_active_chars: z.number()`.
- `characterSchema` (used by `/accounts` + `/accounts/stale`) gains
  `transferred_to: z.string().nullable().optional()`.

### 6.3 WebSocket bridge

- Add `"no_chars_alert"` to `EVENT_TYPES` in `core/ws-bridge.ts`.

### 6.4 Wiring (`index.ts`)

- Pass `eventBus.emit` + `eventLog.log` into the `AccountsStore` constructor.

## 7. Frontend (`/accounts`)

- **"No active characters" banner**: list accounts with `no_active_chars === 1`
  (title e.g. "No active characters — cancel billing?"), distinct from the
  existing auth-error "Roster issues" banner.
- **Transfer note**: in the stale-char list, show "⚠ possibly transferred to X"
  when `transferred_to` is set.
- **Global toast**: a new `AccountAlerts` shell component (mirroring `ScanAlerts`)
  subscribes to `no_chars_alert` and shows a toast.

## 8. Alert cadence

- The alert fires on **each** detection while the account stays empty (daily scan
  failure re-check and/or weekly roster sync), so the operator is re-reminded until
  they act. Clearing (an account gains an active char again, or auth breaks) resets
  the flag to `0` and stops the alerts.

## 9. Testing

- **AccountsStore unit tests** (fake `Sge`): `refresh` sets `no_active_chars=1`
  on auth-ok+empty-list, `0` on non-empty list and on auth/decrypt errors;
  `saveScan` emits `no_chars_alert` + logs only on `0 -> 1` (not on re-flag);
  `stale()` sets `transferred_to` when the name is active elsewhere and leaves it
  null otherwise.
- **Route tests**: `/accounts` + `/accounts/stale` expose the new fields.
- **Gate**: `cd backend && npm test && npm run typecheck && npm run lint` +
  `cd frontend && npm run build`.
- **Live smoke** (Fisternar/Neleourg only; Amn off-limits): after deploy, ADRED
  should flag `no_active_chars=1` and fire the alert on its next scan-failure
  re-check; `/accounts` shows the banner + Bilz's transfer note (null, since
  Bilz is gone, not transferred).

## 10. Out of scope / follow-ups

- Auto-delete / auto-cancel of empty accounts.
- Re-associating inv.db3 rows when a char is transferred to a new account.
- Roster-sync Phase B.
