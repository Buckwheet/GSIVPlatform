# play.net inactive-character scrape (roster-sync Phase B) — Design

Date: 2026-08-13
Status: approved (user) — pending spec review
Author: Reasonix session (GSIVPlatform)

## Goal

Give the stale-character signal its richest source: the account's **deleted
characters** as recorded on play.net's `inactive_characters.asp` (name, level,
race, profession, last-login). Today a char that vanished from SGE is flagged
`entry_only` but we cannot tell *why* it vanished — transferred, merely
inactive, or actually deleted. Phase B ports v1's proven `scrapeInactiveCharacters`
into a review-gated core capability and wires it into the accounts scan so
`/accounts` and `/accounts/stale` can distinguish **deleted** (safe to clean up)
from **transferred** and **inactive**.

## Current state (deep dive, 2026-08-13)

- **v1 (`D:\Code Projects\GSIVDashboard\backend\src\playdotnet.ts`)** has a proven
  `scrapeInactiveCharacters(account, password)`: `fetch-cookie` + `tough-cookie`
  CookieJar, a play.net web login (`signin_needed.asp` → POST `login.asp` with
  `redirect:"manual"` + 302/`location` check → GET `inactive_characters.asp`),
  cheerio table parse into `{game,name,level,race,profession,last_login}`, 5
  retries on 500s, non-fatal on failure. It produced the legacy gs4sd.db
  `source='inactive'` rows (e.g. LWELLS5500's 13 inactive chars). The play.net
  login reuses the SAME plaintext password SGE uses (decrypted by `core/ruby.ts`).
- **v2 accounts module** (`modules/accounts/store.ts`) already runs the SGE poll in
  `refresh()`: `ruby.decryptPassword` → `Sge.listCharacters` → per-row upsert with
  `status` (`active`/`entry_only`) + `auto_added`. `account_characters` already has
  `level/race/profession/last_login` columns (unused — the scan never writes them)
  and `ScanCharacterRow` already declares them. `saveScan` writes only
  `slot/game_code/source/status/auto_added/last_seen` — the enrichment columns are
  never persisted.
- `refresh()` is the shared scan path, called by: `scanOne`/`scanAll` (weekly roster
  sync + manual), and `refreshAndClassify` (the daily invdb scan's failure re-check,
  failed accounts only). `AccountsStore` is constructed in `index.ts:109` with
  `(db, EntryYaml, Ruby, Sge, InvDb, { emit, log })`.
- Backend deps do NOT include the v1 scraper stack (`fetch-cookie`, `tough-cookie`,
  `cheerio`); v2 uses Node's native `fetch` (undici). Native fetch returns an
  opaque-redirect response (no `Location`, no `Set-Cookie`) on `redirect:"manual"`,
  so v1's 302/`location` check is NOT portable to native fetch — the port pins the
  base fetch to `node-fetch` (which exposes 302 status + `Location`), keeping the
  flow deterministic across Node versions.

## Approach (approved)

**New review-gated core capability `core/playdotnet.ts` + inline enrichment in
`AccountsStore.refresh()`.** Faithful to v1's scraper and to v2's capability
architecture (mirrors `core/sge.ts`: injectable transport, no credential logging).
Rejected alternatives: folding into `core/sge.ts` (mixes two protocols into one
capability) and a standalone scheduled job (duplicates credential handling; user
chose inline).

## Components & changes

### 1. Core capability `core/playdotnet.ts`

- `export interface InactiveChar { game: string; name: string; level: number; race: string; profession: string; last_login: string }`
- `export function parseInactiveCharacters(html: string): InactiveChar[]` — pure,
  cheerio-based table parse (v1-faithful): skip the header row, read `<td>` text
  per row, keep rows with `>= 5` cells, `level = parseInt(cells[2], 10) || 0`,
  `last_login = cells[5] || ""`.
- `export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>`
  (injectable base fetch; default = `node-fetch`).
- `export class Playdotnet` with `constructor(private fetchFn: FetchFn = nodeFetch)`
  and `listInactiveCharacters(account: string, password: string): Promise<InactiveChar[]>`:
  1. build a fresh `CookieJar`, pre-seed `PersonalizationCookies=true` +
     `TrackingCookies=true` (Domain=.play.net, Secure), wrap `makeFetchCookie(this.fetchFn, jar)`.
  2. GET `https://www.play.net/gs4/signin_needed.asp` (Chrome UA).
  3. POST `https://www.play.net/includes/common/login/login.asp` (form
     `account_name`/`account_password`/`submit=CONTINUE`, `return_error_page=/gs4/login_error.asp`,
     `redirect:"manual"`); require `status === 302`; if `location` includes `error`
     → throw `"play.net login rejected"`.
  4. GET `https://www.play.net/gs4/account/inactive_characters.asp`; require 200;
     return `parseInactiveCharacters(await resp.text())`.
  5. 5 attempts total; a 500 on login or scrape retries after 500ms; exhaustion →
     throw `"play.net all retries hit broken backend"`.
- Plaintext password only ever enters the login POST body; never logged or returned.

### 2. AccountsStore integration (`refresh()`)

- New constructor dependency `playnet: Playdotnet` (wired at `index.ts:109` as `new Playdotnet()`).
- After SGE succeeds (`authStatus === "ok"`) and the `characters` array is built,
  in a **non-fatal** try/catch call `this.playnet.listInactiveCharacters(accountName, decrypted.plain)`.
  On error: `console.error` and continue — `auth_status`/`auth_error` (SGE state) are untouched.
- Merge (all name matching case-insensitive):
  - inactive char whose name matches an existing **`entry_only`** row → set
    `deleted=1` and copy `level/race/profession/last_login` onto that row (keeps
    `source="entry_yaml"`, `status="entry_only"`).
  - inactive char with NO matching row (not on SGE, not in entry.yaml) → push a new
    row `source="inactive"`, `status="entry_only"`, `deleted=1`,
    `game_code = ic.game.includes("Shattered") ? "GSF" : "GS3"` (v1-faithful), plus
    level/race/profession/last_login.
  - inactive char matching an `active` SGE row → ignored (defensive; can't be both).
- `deleted` is only ever set by the play.net signal; a play.net failure leaves it 0.

### 3. Schema + persistence

- Append migration: `ALTER TABLE account_characters ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`.
- Extend `saveScan` INSERT/UPDATE to also persist `level, race, profession, last_login, deleted`.
- `characterSchema` (routes) gains `deleted: z.number()`; `level/race/profession/last_login`
  are already declared (optional/nullable).

### 4. Stale surfacing

- `GET /accounts/stale` already returns `status='entry_only'` rows (with `transferred_to`
  computed). After Phase B those rows now also carry `deleted` + level/race/profession/last_login,
  and `source="inactive"` rows (deleted, never in entry.yaml) are included. No route change.
- `GET /accounts` (list) surfaces the same fields for every row.

### 5. Frontend (Accounts page, light)

- In the Roster-issues `<details>` list, annotate each stale char by signal:
  - `deleted=1` → "deleted · last login {last_login} · L{level} {profession}" (when fields present).
  - else `transferred_to` → "⚠ possibly transferred to {transferred_to}" (already rendered).
  - else → "inactive (no play.net record)".
- No new page, no new columns beyond the annotation.

### 6. Security (SECURITY.md delta)

Add to the accounts module section: play.net inactive-char scraping is confined to the
review-gated `core/playdotnet.ts` — HTTPS to hardcoded `www.play.net` URLs only, standard
TLS verification (play.net web serves a valid public cert, unlike eaccess), plaintext
password in the login POST body only (never logged/returned), injectable fetch for tests,
5-attempt retry + non-fatal on failure. Note the one server-only consideration: the scrape
performs a web login per scanned account (weekly cadence + failed-account re-checks).

### 7. Testing

- `backend/tests/core/playdotnet.test.ts`:
  - `parseInactiveCharacters` on a fixture HTML table (header row skipped, multi-row,
    missing `last_login` → `""`, non-numeric level → 0, row with <5 cells skipped).
  - `listInactiveCharacters` with an injected fake fetch: asserts the login POST
    `method`/body contains `account_name`+`account_password`; a 302 to an `error`
    location throws `"play.net login rejected"`; a non-302 login throws; a 500 login
    then success retries and returns; success returns the parsed chars.
- `backend/tests/modules/accounts/store.test.ts`: injected fake `Playdotnet` —
  a deleted entry_only char gets `deleted=1` + fields persisted; a brand-new inactive
  char lands as `source="inactive"`/`deleted=1`; a play.net throw leaves the scan `ok`
  and `auth_status` intact.
- `backend/tests/modules/accounts/routes.test.ts`: `characterSchema` accepts `deleted`
  (route returns 200; `deleted` present on rows).
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`.

### 8. Live rollout (testing rule: Fisternar/Neleourg only; Amn off-limits)

1. Deploy backend dist + frontend contents per the server .env runbook; restart
   `gsiv-platform`; verify `systemctl is-active` + public bundle `text/javascript`.
2. Live-smoke on a Fisternar/Neleourg account (CGROSS/JAYCELIA/ADRED/BUCKWHEET):
   `POST /accounts/:name/scan` → poll `GET /accounts`; verify `auth_status=ok` and the
   play.net scrape ran without disturbing the scan (deleted chars surface as
   `source="inactive"`/`deleted=1` or the account simply has none).
3. `GET /accounts/stale` shows `deleted`/`last_login` for any deleted entry_only char.
4. Verify no regression on existing endpoints; document in STATUS.md §7.

## Data flow (per account)

```
scanOne -> refresh
  ruby.decryptPassword                       # capability, plaintext never logged
  Sge.listCharacters                         # active chars (cert-pinned)
  -> upsert active rows + auto-add entry.yaml
  -> entry.yaml-only chars -> entry_only rows
  playnet.listInactiveCharacters(acct, pw)   # NEW, non-fatal, only when auth ok
  -> deleted entry_only chars -> deleted=1 + level/race/profession/last_login
  -> brand-new deleted chars -> source="inactive", status="entry_only", deleted=1
  saveScan                                   # persists enrichment columns
  -> GET /accounts + /accounts/stale surface deleted/transferred/inactive
```

## Error handling

- SGE failure path unchanged (auth_status = bad_password/error/decrypt_error; play.net
  is skipped because it needs valid credentials).
- play.net failure (login rejected, non-302, 500×5, network) is logged and swallowed —
  the account scan still succeeds; `deleted` stays 0 for that run.
- No credential appears in any error string returned to the client.

## Success criteria

- `core/playdotnet.ts` unit-tested; the accounts scan persists `deleted` +
  level/race/profession/last_login for deleted chars without disturbing SGE results.
- A deleted `entry_only` char is distinguishable from transferred and merely-inactive
  in `/accounts/stale` + the Accounts page.
- All gates green; live pair (Fisternar/Neleourg) unaffected; the play.net scrape is
  live-verified on at least one real account.

## Out of scope (follow-ons)

- Changing `cleanupStale` to act on the `deleted` signal (cleanup workstream is parked).
- Cleanup of `source="inactive"` chars that are not in entry.yaml (inv.db3/characters
  residue) — surfaced here, cleaned up later.
- ebounty_tracker port; roster-sync further signals (store balance scrape).
