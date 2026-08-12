# Stale-char cleanup (delete dead accounts + stale chars) — Design

Date: 2026-08-12
Status: draft
Author: Reasonix session (GSIVPlatform)

## Goal

Consume `GET /accounts/stale` (built in the roster-sync workstream) and **drop**
the flagged rows from all three stores the roster feeds, so the platform reflects
reality:

1. **entry.yaml** (`/opt/gs4sd/lich5/data/entry.yaml`) — the launchable roster.
2. **inv.db3** (`/opt/gs4sd/lich5/data/inv.db3`) — the inventory DB the
   invdb scanner writes and the inventory module reads.
3. **gsiv.db** (`data/gsiv.db`, `accounts` + `account_characters` tables) — the
   dashboard accounts module scan results.

The characters module reads entry.yaml live (no store of its own), so removing a
character from entry.yaml removes it there automatically.

## Current state (2026-08-12, live)

`GET /accounts/stale` returns:

- **17 dead accounts** (`auth_status IN bad_password|error|decrypt_error`):
  FUTTILO, MARSTON, MSMI2779, PAJENNEY, PJENNEY, SHIMSHAM1, SJEWETT33, SSMITH,
  SWAMI2, TALONTED, TOREE, TRALIS, TRALL541, TWORAZORS, USHER1, VERYDASHING1, WOJO1.
- **30 entry_only chars**, of which:
  - 8 on live accounts (drop char only): Bilz (ADRED), Mahres (BUCKWHEET),
    Aeton (JEMLEY), Kraytok (JG01), Scorpa (LWELLS5500), Snutz (RYLOHK),
    Jewlengela (SHOLLINDAL), Velkyr (SHOLLINDAL).
  - 22 on dead accounts (dropped with the account).

inv.db3 rows actually present for these targets: Norhaak + Tworazors_ (TWORAZORS),
Bilz, Mahres, Scorpa, Aeton. The rest are not in inv.db3 (nothing to delete there).

## Approach

Extend the existing **accounts module** (same pattern as the roster-sync
workstream). Additive; no new module.

1. **New review-gated core capability `core/inv-db.ts` (`InvDb`)** — the only
   place in the platform that *writes* inv.db3 (today it is opened read-only by
   the inventory module). `better-sqlite3` read-write connection, `busy_timeout`,
   **backup-then-delete** (copy to `inv.db3.bak.<ts>`, rotate to 5) before any
   mutation, mirroring `EntryYaml`.
   - `deleteCharacters(targets)` — for each `{name, account}` (case-insensitive),
     delete child rows (item, silver, resource, tickets, lumnis) then the
     character row (the schema has **no** `ON DELETE CASCADE`).
   - `deleteAccounts(accounts)` — delete every character of those accounts + their
     child rows, then the `account` row.
   - Returns per-run counts + an `ok`/`error` result (never throws into the route).

2. **`AccountsStore.cleanupStale()`** — orchestration:
   - Read `stale()`.
   - Dead accounts first: `EntryYaml.deleteAccount` + `AccountsStore.deleteAccount`
     (gsiv.db) + `InvDb.deleteAccounts`.
   - Stale chars on remaining live accounts: `EntryYaml.deleteCharacter` +
     `AccountsStore.deleteCharacter` (gsiv.db) + `InvDb.deleteCharacters`.
   - Dedup: skip a stale char whose account was already deleted above.
   - Return `{ ok, removedAccounts, removedCharacters, steps[] }` (per-item
     step results, same shape as the existing delete-with-steps routes).

3. **`POST /accounts/stale/cleanup`** (scope `accounts.write`), **TOTP-gated** via
   `requireTotp` — consistent with the existing destructive entry routes
   (`DELETE /entry/account/:name`, `DELETE /entry/account/:name/character/:char`).

4. **Frontend (Accounts page)**: a "Clean up stale" action in the roster-issues
   banner (write scope + TOTP code field), mirroring the "Add account" form's
   TOTP gate. No new pages.

## Security

- Destructive route is TOTP-gated and scoped to `accounts.write`.
- inv.db3 writes go through the review-gated `InvDb` capability only; backup
  before every mutation.
- No credentials touched (deletion only needs names — no password decrypt).

## Testing

- `core/inv-db.test.ts`: cascade delete (child rows), account delete, case
  insensitivity, no-match/empty input no-ops, backup file created.
- `modules/accounts/store.test.ts`: `cleanupStale` removes from entry.yaml +
  gsiv.db + inv.db3; dead accounts are deduped from the char pass; per-item steps.
- `modules/accounts/routes.test.ts`: `POST /accounts/stale/cleanup` requires
  `accounts.write` + TOTP (403 without setup / invalid code).
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` +
  `cd frontend && npm run build`.

## Live rollout

1. Deploy backend + frontend (frontend contents into `/opt/gsiv-platform/frontend`,
   verify public bundle `text/javascript`).
2. Verify `GET /accounts/stale` unchanged; `POST /accounts/stale/cleanup` 403s
   without TOTP.
3. **Backup** entry.yaml (already done by capability) + inv.db3 explicitly, show
   the exact list, run cleanup with the admin's TOTP code, verify counts + that
   `/accounts`, `/lookup` Overview and `/characters` no longer list the dropped
   accounts/chars.

## Out of scope

- `<Account>_` placeholder rows in inv.db3 (level 0 / 0 items) for *live*
  accounts — a separate inv.db3-hygiene concern, not produced by `/accounts/stale`.
- Scheduler UX redesign (parked workstream).
- Roster-sync Phase B (play.net inactive-char scrape).
