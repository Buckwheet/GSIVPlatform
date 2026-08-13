# Scan Orchestrator + Scheduler UX Redesign — Design Spec

**Date:** 2026-08-13
**Status:** design (pre-plan)

## 1. Summary

Replace the InvDB scan scheduler's bash-driven coordination with a TypeScript
orchestrator in the backend, and move the scan/schedule UI off the Inventory
page onto a new **Scans** page that shows live, animated per-account progress.
A scan becomes a first-class **job**: a bounded worker pool (5 concurrent
accounts) scans each account's characters one at a time, every state transition
is surfaced over WebSocket, results persist for history, and failed accounts
can be retried manually.

## 2. Problem

Today the InvDB scheduler is a card on the Inventory page and is a thin shell
over two server-side bash scripts (`invdb-scan-all.sh` -> `invdb-parallel.sh`).
The backend only knows "is a script running?" and "what were the last 3 log
lines?" — no per-account visibility, no job model, no retries, and the controls
live in the wrong place. The user asked for:

- a **status page** with a **live animated section** showing each account's
  progress as its characters scan through;
- a **smart orchestrator** with a bounded thread pool (**5 accounts at once**);
- per-account job status + **manual retry**.

## 3. Goals / Non-goals

**Goals**
- Move scheduling + scan controls to a dedicated `/scans` page (off Inventory).
- A backend orchestrator that scans accounts in parallel (5 workers), chars
  within an account sequentially.
- Live per-account/per-char progress over WS with an animated UI.
- Persistent job + per-account history; manual retry of failed accounts.
- **Full re-scan** semantics (re-collect + refresh timestamps) — the daily run
  is a real refresh, and the live view always shows all accounts working.

**Non-goals** (deferred)
- Per-character (not per-account) retry granularity.
- Automatic retry loops.
- Cancelling a running job.
- Scanning `ebounty_tracker.lic` / play.net data (separate streams).
- Changing how `;invdb` collects data (the Lich-side script is untouched).

## 4. Recorded decisions

| Decision | Choice |
|---|---|
| Orchestrator | Backend TypeScript (reuses review-gated capabilities) |
| UI location | New **Scans** page, operations nav group |
| Retries | Manual, per failed **account** |
| Concurrency | **5** accounts at once (constant, env-overridable) |
| Scan mode | **Full re-scan** (completion = inv.db3 timestamp advances) |
| Char progress | Live only (WS + `GET /scan/status`); not persisted |

## 5. Architecture

Four new/edited pieces:

1. **`core/scan-runner.ts`** — review-gated capability; the only place that
   runs a single character's scan cycle. It composes injected capabilities and
   emits stage transitions. No shell strings; systemd + inv.db3 access stay in
   core per the review-gated rule.
2. **`modules/scans/store.ts`** (`ScansStore`) — job model, bounded worker pool,
   persistence, and progress emission (owns the 5-account concurrency).
3. **`modules/scans/index.ts`** — HTTP routes + WS events.
4. **`frontend/src/pages/scans/index.tsx`** — the live status page.

### 5.1 ScanRunner (core capability)

Dependencies (all injected -> unit-testable):

- `systemd: Systemd` — start/stop `gs4sd-lich@<Char>` (existing core capability).
- `invDb: InvDbReader` — read-only poll of a char's inv.db3 `character.timestamp`
  (the completion signal). Implemented as a read method on the existing core
  `InvDb` (or a small sibling reader); interface is `charTimestamp(name): number|null`.
- `sendScript(char, script): Promise<void>` — queues `;invdb` / `;invdb tickets`
  (module adapts `LichStore.pushCommand` to this).
- `isOnline(char): Promise<boolean>` — recent-publish liveness (module adapts
  `LichStore.status` + `isOnline`).
- `emit(stage, detail)` — progress callback (module forwards to the WS bus).

### 5.2 ScansStore (module)

- Holds the single in-flight job (one scan at a time; a second `POST /scan`
  returns 409).
- Worker pool of `MAX_CONCURRENT_ACCOUNTS = 5` (env `SCAN_MAX_THREADS`, default 5).
- Target set resolution, skip list, retry bookkeeping, persistence to `CoreDb`
  (gsiv.db), and `EventBus` emission of `scan_update`.

## 6. Scan semantics

**Target set (default):** every account in `entry.yaml` whose `auth_status` in the
accounts table (gsiv.db) is `ok`, minus the skip list. The skip list is
`SCAN_SKIP_ACCOUNTS` (comma-separated, default `UNFOCUSEDPIE` = Amn, off-limits).
An explicit `accounts` list on `POST /scan` overrides the default (subset).

Characters = that account's `char_name` entries from `entry.yaml` (the source
that maps 1:1 to `gs4sd-lich@<Char>` units and lich command targets). Stale
chars still present in entry.yaml (pending the "Clean up stale" action) may
surface as failed/timeout in the live view — that is itself useful signal, and
cleanup removes them from entry.yaml.

**Per-character cycle** (mirrors the bash script, ported to TS):

1. `systemd.start(char)`.
2. Wait for online (`isOnline`, poll every 2s, <= 3 min).
3. Settle ~8s.
4. Record `before = invDb.charTimestamp(char)` (null if never scanned).
5. `sendScript(char, ";invdb")`.
6. Poll `invDb.charTimestamp(char) > before` (or a row appears) every 2s, <= 4 min.
7. `sendScript(char, ";invdb tickets")`.
8. Settle ~10s.
9. `systemd.stop(char)`.

**Char result:** `done` | `timeout` (never online / no write / no tickets) |
`failed` (systemd start/stop error).

## 7. Orchestration

- One account = one worker slot; its characters scan strictly sequentially
  (two Lich sessions on the same account would collide).
- At most 5 accounts run concurrently; remaining accounts queue.
- **Job result:** `done` (all accounts done) | `partial` (some accounts failed) |
  `failed` (no account succeeded).
- **Account result:** `done` | `partial` (>=1 char failed) | `failed` (all chars
  failed). Account errors include the first failing char + reason.
- **Retry:** `POST /scan/:jobId/retry` starts a new job over the failed accounts
  of that job (their chars re-scan; inv.db3 writes are idempotent — rows are
  overwritten). Disallowed while a job is running (409).

## 8. Data model (gsiv.db, module `scans`)

- `scan_jobs(id INTEGER PK, status, started_at, finished_at, total_accounts,
  accounts_done, accounts_failed)`
- `scan_accounts(job_id, account_name, status, chars_total, chars_done,
  chars_failed, error, started_at, finished_at)`

Per-char progress is **in-memory only** on the current job (returned by
`GET /scan/status` and pushed on `scan_update`); it is not persisted. History is
job + per-account only.

## 9. API (`/api/modules/scans`, scopes `scans.read` / `scans.write`)

| Route | Scope | Purpose |
|---|---|---|
| `GET /time` | read | server clock `{ now, tz }` (moved from inventory) |
| `GET /schedule` | read | `{ enabled, time, next_run, error }` (moved) |
| `PUT /schedule` | write | set daily time `{ time: "HH:MM" }` (moved) |
| `POST /scan` | write | start job `{ accounts?: string[] }` -> `{ jobId, totalAccounts }`; 409 if running |
| `GET /scan/status` | read | current/last job incl. per-account + per-char progress |
| `GET /scan/history` | read | recent jobs + per-account summaries |
| `POST /scan/:jobId/retry` | write | new job over failed accounts; 409 if running |
| `GET /scan/targets` | read | available accounts + char counts (feeds the subset picker) |

The inventory module's `/time`, `/schedule`, `/scan/start`, `/scan/status`
routes and the `InventoryScheduler` frontend card are **removed** (schedule +
status move to `scans`; `scan/start` is replaced by `POST /scan`).

## 10. WebSocket event

`scan_update` — emitted on every transition (account queued/started/char-stage/
char-done/account-done/job-done). Payload = the full current job snapshot so a
(re)connecting client can render from one message. Frontend uses the existing
`useWsEvents` pattern (as in jars/healer).

## 11. Frontend UX (`/scans`)

- Nav: operations group, after Lookup (order ~30), icon e.g. `📡`.
- **Live section** (the animated view): one card per account, grouped into
  *running* (<=5, animated) and *queued*:
  - progress bar = chars done / chars total;
  - current char name + stage pulse (`starting -> waiting online -> scanning ->
    tickets -> done`) with an animated indicator;
  - per-account elapsed time + status chip;
  - **Retry** button on failed accounts (job-finished state).
- **Controls:** "Scan now" (with optional account subset picker), schedule
  setter + server clock + UTC-offset converter (relocated from the current
  Scheduler card), and a recent-history list.
- Read-only token -> controls hidden/disabled; live view still renders (read).
- Inventory page returns to a pure read-only view; update the Overview notice
  copy that points at "Inventory > Run scan now" -> "Scans > Scan now".

## 12. Schedule & timer migration

- `gsiv-invdb-scan.timer` (daily 03:00 UTC) stays; its oneshot
  `gsiv-invdb-scan.service` ExecStart changes from
  `bash /opt/gs4sd/scripts/invdb-scan-all.sh 5` to a thin wrapper that
  `curl -X POST` the machine token at `/api/modules/scans/scan`
  (mirror the roster-scan wrapper + `/etc/gsiv-scan.env` 0600 pattern).
- `PUT /schedule` continues to rewrite the timer unit (relocated verbatim);
  only the service `ExecStart` changes.
- `invdb-scan-all.sh` / `invdb-parallel.sh` are retired (left dormant, not
  deleted — rollback path).

## 13. Deploy steps

1. Add `scans.read,scans.write` to the machine token in server `.env`.
2. Rebuild + redeploy backend + frontend (frontend contents -> Caddy root).
3. Install the updated timer service + wrapper (`/opt/gsiv-platform/scripts/gsiv-scan.sh`,
   `/etc/gsiv-scan.env` 0600).
4. Verify the public frontend bundle is `text/javascript` (CF cache gotcha).

## 14. Security & review-gated compliance

- `child_process` (systemctl) and inv.db3 file IO remain confined to
  `core/scan-runner.ts` (+ existing `Systemd`/`InvDb`), matching the standing
  rule. No shell strings — `execFile` args arrays (via `Systemd`), KV-backed
  lich commands, parameterized inv.db3 reads.
- `scan.write` gates `POST /scan`, `POST /scan/:jobId/retry`, `PUT /schedule`.
- Char names flow through `Systemd.unitFor` (strict validation) — no unit/name
  injection. inv.db3 poll uses `charTimestamp(name)` with a bound param.
- Manual security pass before merge (the `security_review` subagent can't see D:\).

## 15. Testing

- **Backend unit tests** (injected fakes) for `ScanRunner`: char cycle stages,
  online/timeout, timestamp-advance completion, tickets step, systemd errors.
- **Backend unit tests** for `ScansStore`: 5-worker concurrency bound, sequential
  chars per account, skip list, subset override, retry builds the failed set,
  job/account result rollups, single-job 409, persistence round-trip.
- **Route tests**: scope gating (`scans.read` vs `scans.write`), 409 on double
  start, retry while running.
- **Frontend**: `npm run build`.
- **Live smoke** (Fisternar/Neleourg only, per the testing rule): a single-account
  scan, then a full run; watch the live view + WS updates.

## 16. Out of scope / follow-ups

- Per-character retry granularity; auto-retry; job cancellation.
- Porting `ebounty_tracker.lic` into v2.
- Streaming more characters (existing `deploy/V2-DEPLOYMENT.md` §VellumFE recipe).
