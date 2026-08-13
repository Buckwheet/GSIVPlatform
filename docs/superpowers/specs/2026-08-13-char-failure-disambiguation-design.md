# SGE-based char-failure disambiguation — Design Spec

**Date:** 2026-08-13
**Status:** design (pre-plan)

## 1. Summary

When an invdb scan character fails, tell the operator **why** it failed, using a
fresh SGE re-check as the source of truth. On any account with failed characters
(one SGE round-trip per failed account), cross-reference the current SGE state
(auth result + active-character list) against the mechanical failure to produce
a stable, actionable reason per character. The reason is surfaced per-char on
the **Scans** page (live + history) and written back into
`accounts.auth_status`/`account_characters.status` so the **Accounts** page
reflects the same conclusion with no extra work.

This closes the deferred "error disambiguation via SGE" follow-up from the scan
orchestrator spec (its §16).

## 2. Problem

The scan orchestrator (`ScansStore`/`ScanRunner`) only reports a coarse
mechanical failure per char — `"Fisternar: not online"`, `"no invdb write"`,
`"start failed"`. It never distinguishes the three real causes:

1. the **account** can't authenticate to SGE (password changed/expired since the
   last roster sync);
2. the **character** is disabled/inactive/deleted on SGE (so Lich can't select
   it);
3. a **transient** mechanical flake (timing, script hiccup) that a retry would
   clear.

The roster sync (`AccountsStore.scanOne`) already persists the SGE signals that
could answer this — `accounts.auth_status`/`auth_error` and
`account_characters.status` (`active` vs `entry_only`) — but the scan orchestrator
never cross-references them. Worse, those signals are refreshed **weekly** while
scans run **daily**, so they are exactly at their stalest when a char fails.

## 3. Goals / Non-goals

**Goals**
- On a char scan failure, classify the reason as auth vs disabled vs transient
  using a **fresh SGE re-check** (no staleness).
- Stable, machine-readable failure codes (see §5) surfaced as human-readable
  text.
- Per-char failure detail on the **Scans** page, live and in history.
- Write the fresh SGE result back into `accounts.auth_status` /
  `account_characters.status` so the **Accounts** page reflects it.
- One SGE round-trip per failed account (not per char).

**Non-goals** (deferred)
- Automatic retry; per-character retry granularity.
- Reading Lich session log files to extract the login-failure line (the SGE
  re-check is the source of truth; journal scraping is a possible follow-up).
- Changing how `;invdb` collects data.
- Roster-sync Phase B (play.net inactive-char scrape).

## 4. Recorded decisions

| Decision | Choice |
|---|---|
| Signal source | **Fresh SGE re-check** at failure time (decrypt + `listCharacters`) |
| Architecture | **Reuse `AccountsStore.scanOne`**'s decrypt→SGE→save path, exposed as a narrow classifier interface |
| Granularity | Account-level re-check (one round-trip); per-char classification |
| Surfacing | **Both** Scans (per-char) and Accounts (write-back) |
| Write-back | `auth_status`/`auth_error` + char `active`/`entry_only` (auto-add kept, as in `scanOne`) |
| New classification codes | `sge_unreachable` added so a transient SGE outage isn't mislabeled as an auth failure |

## 5. Classification codes

Stable `code` + human-readable `reason`, chosen from the fresh SGE state and the
mechanical failure:

| code | trigger | reason |
|---|---|---|
| `start_failed` | `result === "failed"` (systemd) | `systemd start failed: <error>` |
| `auth_bad_password` | SGE auth = `bad_password` | `account auth: bad_password` |
| `auth_error` | SGE auth = `error` | `account auth: <auth_error>` |
| `auth_decrypt_error` | local decrypt failed | `account password decrypt failed: <error>` |
| `sge_unreachable` | re-check threw a transport error (timeout/connect/cert) | `SGE unreachable during re-check (retry later)` |
| `char_disabled` | auth OK, char not in SGE active list | `character not active on SGE (disabled/inactive/deleted)` |
| `no_write` | auth OK + char active, `result === "timeout"` with `no invdb write` | `character online but inv.db3 not written (script/mechanical flake)` |
| `transient` | auth OK + char active, `result === "timeout"` with `not online` | `character active + auth ok but never came online (timing flake)` |

Ordering: `start_failed` is decided first (purely mechanical, SGE state
irrelevant). Then account-level auth (including `sge_unreachable`), then
char-level (`char_disabled` vs `no_write` vs `transient`). The `not online` vs
`no invdb write` split comes from the mechanical `error` string `ScanRunner`
already emits (`"not online"` vs `"no invdb write"`).

`auth_decrypt_error` and `sge_unreachable` are new distinctions: `scanOne`
currently buckets every non-`invalid_password` SGE error into `auth_status =
"error"`. The re-check keeps that persistence, but the classifier distinguishes
transport errors (timeout/connect/cert-pin) from definitive auth rejections so a
momentary SGE outage doesn't label a healthy account as broken.

## 6. Architecture

Two edited pieces + one new table:

1. **`modules/accounts/store.ts` (`AccountsStore`)** — extract the
   decrypt→SGE→save body of `scanOne` into a reusable `refresh(name)`; add the
   classifier method `refreshAndClassify(account, failed)`.
2. **`modules/scans/store.ts` (`ScansStore`)** — depend on a narrow
   `CharFailureClassifier` interface; call it once per failed account; persist
   per-char failures; extend the live snapshot + history.
3. **`scan_chars`** table in gsiv.db (module `scans`) for per-char failure
   persistence.

### 6.1 AccountsStore classifier

```ts
interface CharFailure {
  char: string;
  result: "done" | "timeout" | "failed";
  error?: string;
}
interface CharFailureClassified extends CharFailure {
  code: string;   // one of §5
  reason: string; // human-readable
}
interface CharFailureClassifier {
  refreshAndClassify(account: string, failed: CharFailure[]): Promise<CharFailureClassified[]>;
}
```

- `refresh(name)` = the existing `scanOne` body (decrypt password via the
  review-gated `Ruby` capability → `Sge.listCharacters` → persist `accounts`
  auth row + `account_characters` `active`/`entry_only` + auto-add newly
  discovered chars). `scanOne` becomes a thin caller of `refresh` (route
  behaviour unchanged).
- `refreshAndClassify` runs `refresh(account)` once, then reads the freshly
  written `accounts` row and each failed char's `account_characters.status`, and
  maps each failure to a code/reason per §5.
- Auto-add of newly discovered SGE chars during the re-check is **kept**
  (consistent with `scanOne`/roster sync); it keeps the roster accurate and is
  idempotent.

### 6.2 ScansStore

- Constructor gains a required `classifier: CharFailureClassifier` param
  (injected; `AccountsStore` structurally satisfies it). Existing ScansStore
  tests pass a stub/no-op classifier; `index.ts` passes the real
  `AccountsStore`.
- In `runJob`, after an account's char loop, if any char failed, call
  `classifier.refreshAndClassify(account, failures)` **once** and attach the
  results to the account state (`failures[]`). A classifier error is non-fatal:
  fall back to the raw mechanical error with code `transient`.
- `ScanAccountState` gains `failures: CharFailureClassified[]`.
- Persist each failure row into `scan_chars` in `persistAccount`.

### 6.3 Wiring (`index.ts`)

`accountsStore` is constructed before `scansStore`; pass it as `classifier` into
`new ScansStore(...)`. Both stores already share the same `CoreDb` (gsiv.db) and
each holds its own `EntryYaml` instance (same file).

## 7. Data model (gsiv.db, module `scans`)

New table:

```sql
CREATE TABLE IF NOT EXISTS scan_chars (
  job_id INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  char_name TEXT NOT NULL,
  result TEXT NOT NULL,
  code TEXT NOT NULL,
  reason TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_chars_job ON scan_chars(job_id);
```

Only **failed** chars are persisted (done chars are already summarized by
`scan_accounts.chars_done`). `reason`/`error` are credential-free SGE/systemd
messages.

## 8. API (`/api/modules/scans`)

No new routes. Two existing responses gain per-char failure detail:

- `GET /scan/status` — each account in `job.accounts` gains
  `failures: { char, result, code, reason }[]`.
- `GET /scan/history` — each account in `jobs[].accounts` gains
  `chars: { char_name, result, code, reason }[]` (failures only).

Scopes unchanged (`scans.read`/`scans.write`). The write-back to the accounts
tables happens as a scan side effect under the existing `scans.write`-gated
`POST /scan`; no new scope is introduced (it reuses the same internal path the
roster scan uses).

## 9. Frontend (`/scans`)

- Live card: under each running/failed account, render per-char failure lines,
  color-coded by code (`auth_*`/`sge_unreachable` = warn; `char_disabled` = bad;
  `transient`/`no_write`/`start_failed` = muted).
- History: make each failed account expandable to list its per-char failures
  with reason.
- Read-only token: failure lines still render (they are read data).

The **Accounts** page needs no change — `refresh` writes the same
`auth_status`/`auth_error` + char status the page already renders (Auth Status
column + "Roster issues" banner).

## 10. Testing

- **AccountsStore unit tests** (injected fake `Sge` + `Ruby`): classification for
  each §5 code — bad_password / auth error / decrypt error / transport error →
  `sge_unreachable` / char_disabled / no_write / transient; `refresh` persists the
  auth row + char status and keeps `scanOne` behaviour.
- **ScansStore unit tests** (fake classifier): classifier called once per failed
  account (not per char); results attached to the snapshot; persisted to
  `scan_chars`; classifier throwing falls back to `transient` without crashing
  the job; done accounts persist no char rows.
- **Route tests**: `/scan/status` + `/scan/history` include per-char failure
  detail.
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` +
  `cd frontend && npm run build`.
- **Live smoke** (Fisternar/Neleourg only; Amn off-limits): stop a known-active
  char's Lich unit, run a single-account scan, and confirm the failure is
  classified `transient`; then a char on a broken-auth account (if present)
  classifies `auth_*`, and a stale/entry_only char classifies `char_disabled`.

## 11. Security & review-gated compliance

- The re-check decrypts the account password via the existing `Ruby` capability
  and passes plaintext only to the pinned SGE TLS socket — the same path
  `scanOne` already uses; plaintext is never logged or returned.
- No `child_process`/file IO is added outside core capabilities; `refresh` reuses
  `Ruby` + `Sge` (both review-gated) and `accounts`/`account_characters` reads.
- Failure `reason`/`error` strings are SGE/systemd messages (credential-free);
  stored in `scan_chars` and returned over `scans.read`.
- Manual security pass before merge (the `security_review` subagent can't see D:\).

## 12. Out of scope / follow-ups

- Scraping the Lich session journal to capture the exact login-failure line
  (the SGE re-check is authoritative for auth-vs-disabled; journal text would
  only refine the wording).
- Automatic retry of `transient`/`no_write` failures.
- Roster-sync Phase B (play.net inactive-char scrape); `ebounty_tracker.lic`.
