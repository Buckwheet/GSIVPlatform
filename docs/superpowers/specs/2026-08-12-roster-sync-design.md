# Weekly Roster Sync (SGE gather / verify / correct) — Design

Date: 2026-08-12
Status: approved (user) — awaiting spec review
Author: Reasonix session (GSIVPlatform)

## Goal

Make the server roster (entry.yaml) and the data it feeds (invdb inventory,
characters module, account_characters) reflect **reality**: exactly the accounts
the user owns and exactly the characters that currently exist on those accounts.

Mechanism: a **weekly automated job** that uses Lich's SGE (eaccess) protocol to
connect to every managed account, poll the authoritative character list, save it,
**auto-add new characters** to entry.yaml (making them launchable/scanable), and
**flag stale characters** (in entry.yaml but no longer on SGE; previously-active
and now vanished). Test platform: **LWELLS5500** (chars: Scorpa, Skaad).

The follow-on workstream (stale-char *deletion*: inv.db3 + characters module +
entry.yaml cleanup) consumes the stale list this feature produces.

## Current state (deep dive, 2026-08-12)

- **Lich SGE protocol** (`lib/eaccess.rb`, ported as `backend/src/core/sge.ts`):
  TLS to `eaccess.play.net:7910`, cert-pinned (SHA-256
  `10:B7:...:21:8A`), `K` (hashkey) → `A\t<acct>\t<masked pw>` → `M` → `N\t<game>`
  → `G\t<game>` → `C` returns `slot\tname` pairs (active characters). Also `L`
  login info per char. The v2 `Sge` class implements `listCharacters` +
  `testAuth`, transport injectable, tested (`core/sge.test.ts`).
- **entry.yaml** (`/opt/gs4sd/lich5/data/entry.yaml`): accounts with
  `characters[]` + `password` encrypted **standard-mode** AES-256-CBC — key =
  PBKDF2(passphrase = `ACCOUNT_NAME.upcase`, salt = `lich5-password-encryption-standard`,
  10k iters). Deterministic per account → the same ciphertext decrypts on any host.
  Decrypt via the review-gated `core/ruby.ts` (fixed-script, no interpolation).
  Writes only via review-gated `core/entry-yaml.ts` (backup-then-write, strict
  char-name validation, `validateCharName`).
- **v2 accounts module** (`modules/accounts/store.ts`) already implements the
  SGE poll: `scanOne` decrypts the password, calls `Sge.listCharacters`, merges
  SGE chars (source `sge`) + entry.yaml chars (source `entry_yaml`) and saves to
  `gsiv.db` (`accounts`, `account_characters`). `scanAll` iterates entry.yaml
  accounts with 30s spacing. Routes exist (GET /accounts, scan/status, scan,
  entry CRUD, TOTP). Accounts UI page exists with a "Scan all" button.
- **Gaps found:**
  - `gsiv.db` accounts tables are **empty** — the v2 accounts module has never
    been scanned live.
  - `saveScan` **deletes all account_characters rows per account then re-inserts**
    → stale chars vanish without a trace; `last_seen` is always reset to now.
  - New SGE chars are recorded in the scan DB but **never added to entry.yaml**,
    so they aren't launchable/scanable by the invdb pipeline.
  - No stale detection, no stale surfacing, no schedule (**no roster-scan timer**
    exists; only `gsiv-sales-scan.timer` hourly + `gsiv-invdb-scan.timer` daily).
  - Machine token scopes: gems/healer/characters/pricing/lich/yourshops — **no
    `accounts.*`**, so a timer-driven scan needs `accounts.write`.
  - LWELLS5500 is **not** in the server entry.yaml; its credentials exist in the
    user's local `C:\lich5\data\entry.yaml` (standard-mode encrypted blob for
    LWELLS5500 + chars Scorpa, Skaad). Local `C:\lich5` entry.yaml has **35
    accounts**; the server entry.yaml has **14** (KAISER999 is server-only).
  - Legacy v1 `gs4sd.db` (separate DB) has old scan data incl. LWELLS5500's 27
    chars (13 source `inactive` from play.net `inactive_characters.asp` with
    level/profession). v1 had a proven `scrapeInactiveCharacters` (play.net) —
    v2 deferred it ("plan Task 9").

## Approach (approved)

**Extend the existing v2 accounts module** (Approach A). Reuse the tested
Sge/EntryYaml/Ruby capabilities and the existing scanOne/scanAll shape. Additive
changes only. Rejected: standalone cron script (bypasses the review-gated
capability architecture, no tests/UI), dedicated `/roster` module (duplicates
the accounts module).

Scope (user decision): **migrate all 35 local accounts** from
`C:\lich5\data\entry.yaml` onto the server entry.yaml, then let the weekly SGE
poll verify each — dead accounts get flagged, live ones get corrected char lists.

## Components & changes

### 1. One-time account migration (ops, not code)

Merge `C:\lich5\data\entry.yaml` (35 accounts) into
`/opt/gs4sd/lich5/data/entry.yaml`:

- Union of accounts; for each account prefer the **local** encrypted password +
  char list when present, else keep the server's (covers KAISER999, server-only).
- Copy the encrypted blobs verbatim (standard-mode is deterministic per account —
  plaintext never touches disk or logs).
- Backup the server entry.yaml first (`entry.yaml.bak-roster-migrate-<ts>`),
  validate the result (YAML parses, all char_names pass `validateCharName`,
  encryption_mode stays `standard`), and verify one account decrypts
  (e.g. LWELLS5500) via the Ruby capability before/after.
- Result: server roster = 36 accounts (35 local + KAISER999 server-only); 14 already
  SGE-verified, the rest to be verified by the poll (some expected dead).

### 2. Roster-scan storage semantics (`accounts/store.ts` + migration)

- Add `status` column to `account_characters`: `active` (on SGE now) |
  `entry_only` (in entry.yaml, not on SGE → stale candidate). Existing rows from
  the never-scanned v2 tables: n/a (empty).
- Replace delete-and-reinsert with **per-row upsert** (key:
  `account_name + LOWER(char_name)`):
  - SGE-seen char → upsert `status='active'`, `last_seen=now`, `slot`, `source='sge'`.
  - entry.yaml char not on SGE → upsert `status='entry_only'` **without touching
    `last_seen`** (keeps the proof of when it was last seen active).
  - Chars in the DB with neither source this run are left untouched (defensive;
    a per-account scan failure must not delete rows).
- `accounts` table: keep current upsert (auth_status, auth_error, last_scan) —
  already correct.
- New `status` values are also exposed in `GET /accounts` rows.

### 3. Auto-add new characters to entry.yaml (in `scanOne`)

For each SGE char not present in entry.yaml (case-insensitive):

- `EntryYaml.addCharacter(account, charName, gameCode)` (existing
  backup-then-write + validation).
- Record the row with `source='sge'` + an `auto_added=1` marker (new column or
  encoded in source; prefer a dedicated boolean column for clarity).
- Consequence (intended): the char becomes launchable (`gs4sd-lich@<Char>`
  template) and will be picked up by the invdb scanner on future runs.
- Failure of the entry.yaml write must not abort the rest of the account scan —
  log/record and continue.

### 4. Stale surfacing

- `GET /accounts/stale` (scope `accounts.read`) returns:
  - `characters`: rows with `status='entry_only'` (in entry.yaml, absent from
    SGE) with `last_seen` (the stale proof) + account.
  - `accounts`: rows with `auth_status IN ('bad_password','error','decrypt_error')`.
- Feed for the follow-on cleanup workstream + Overview notices (later).

### 5. Weekly schedule

- New systemd units on the server:
  - `gsiv-roster-scan.service`: `POST /api/modules/accounts/scan` with a token
    that has `accounts.write`; token read from a 0600 env file
    (`/etc/gsiv-roster-scan.env`, pattern parity with `gsiv-sales-scan.env`).
  - `gsiv-roster-scan.timer`: **weekly, Mon 03:30 UTC** (30 min after the daily
    03:00 invdb scan; avoids overlap).
- Add `accounts.write` to the machine token in the server .env `AUTH_TOKENS`
  (single machine-token pattern; the scan route already scopes
  `POST /accounts/scan` = accounts.write).
- `scanAll`'s existing 30s spacing keeps the ~36-account poll gentle
  (~18 min worst case, weekly cadence — acceptable).

### 6. Phase B (deferred, optional — not in the first implementation plan)

Port v1's `scrapeInactiveCharacters` (play.net `inactive_characters.asp`) into a
core capability: returns **deleted characters with level/profession/last-login
` — the richest stale signal (it produced the old `inactive` rows). Needs a
play.net login session per account; ship only after the SGE core is verified
live. Revisit after cleanup workstream.

### 7. Frontend (Accounts page, light)

- Status column (Active / Entry-only / Auth error) + filter chips.
- "auto-added" badge on auto-added chars.
- Stale count summary. No new pages.

## Data flow (per account, weekly)

```
gsiv-roster-scan.timer
  -> POST /accounts/scan (token w/ accounts.write)
  -> scanAll: for each entry.yaml account (30s spacing)
  -> scanOne:
      ruby.decryptPassword(account, entry.yaml)      # capability, no logs
      Sge.listCharacters(account, pw, GS3)           # cert-pinned, 15s timeout
      -> upsert gsiv.db rows (active/entry_only, last_seen)
      -> EntryYaml.addCharacter for every new SGE char (backup-then-write)
      -> auth_status = ok | bad_password | error | decrypt_error
  -> GET /accounts (+ /accounts/stale) surfaces the corrected roster
```

## Error handling

- Per-account try/catch (existing pattern): one bad account never blocks the
  scan.
- SGE timeout / cert mismatch -> `auth_status='error'`, continue.
- `invalid_password` -> `auth_status='bad_password'`, continue.
- entry.yaml write failure -> recorded, rest of account continues; backups
  preserved by the capability.
- Scan DB upsert is defensive: never delete rows on failure.

## Security

- Passwords stay encrypted in entry.yaml (standard mode); plaintext only ever
  inside the Ruby capability process; nothing logged (existing rule).
- Credentials are transferred as **encrypted blobs** (no plaintext over the wire
  or on disk).
- entry.yaml writes go through the review-gated EntryYaml capability only.
- Timer token file 0600, root-owned (sales-scan pattern).

## Testing

- `backend/tests/modules/accounts/store.test.ts`: status transitions
  (active<->entry_only), last_seen preservation, no-delete upsert, auto-add
  (injected EntryYaml fake), auto-add failure doesn't abort.
- `backend/tests/modules/accounts/routes.test.ts`: `/accounts/stale` +
  scopes (401/403).
- Existing `core/sge.test.ts`, `core/entry-yaml-crud.test.ts`, `core/ruby.test.ts`
  unchanged (capabilities untouched).
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` +
  `cd frontend && npm run build`.

## Live rollout (testing rule: Fisternar/Neleourg only; Amn off-limits)

1. Migration: merge 35 local accounts into server entry.yaml (backup first),
   verify LWELLS5500 decrypts.
2. Deploy backend; `POST /accounts/scan` with admin token -> verify LWELLS5500
   auths, chars land in gsiv.db, **Scorpa flagged stale if SGE no longer lists
   it** (the test), auto-add fires for any new SGE char.
3. Full `scanAll` (all 35) -> dead accounts show bad_password/error; live
   accounts get corrected char lists; verify no regressions (existing endpoints).
4. Install `gsiv-roster-scan.{service,timer}`; force-run once; verify timer
   persists (`systemctl is-enabled`) and the public API still serves
   `text/javascript` after the frontend build (CF cache gotcha).
5. Accounts page shows statuses.

## Success criteria

- gsiv.db `account_characters` populated from a real SGE poll; every row has a
  meaningful `status` + truthful `last_seen`.
- New SGE chars auto-added to entry.yaml (verified on at least one live account).
- LWELLS5500: SGE-verified; Scorpa/Skaad resolved to active-or-stale correctly.
- Weekly timer fires and completes; `GET /accounts/stale` returns the flagged set.
- All gates green; live pair (Fisternar/Neleourg) unaffected.

## Out of scope (follow-ons)

- Stale-char **deletion** (inv.db3 + characters module + entry.yaml cleanup) -
  next workstream, consumes `/accounts/stale`.
- Scheduler UX redesign (parked workstream) - will rewire invdb-parallel.sh's
  auth gating away from the legacy gs4sd.db once the roster lives in gsiv.db.
- Legacy v1 gs4sd.db retirement.
