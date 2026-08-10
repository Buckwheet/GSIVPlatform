# Accounts Module Implementation Plan (accounts + entry, TOTP-gated)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port v1 account manager + entry.yaml management (`/api/accounts*`, `/api/entry/*`, `/api/totp/*`) into GSIVPlatform as the `accounts` module — Phase A #4, the most sensitive module. Per the user's established decision (characters module): every privileged mechanism goes through a **dedicated, review-gated core capability**.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts` (accounts routes ~875-955, entry routes ~1145-1330, scanAccount ~802-870, encrypt/decryptPassword ~1176-1188) + `totp.ts`, `sge.ts`, `playdotnet.ts`, `store.ts`, `db.ts` scan tables (~67-143).

## Security model (review-gated core capabilities)

- **`core/totp.ts`** — TOTP 2FA: `otpauth` package, secret persisted at `TOTP_SECRET_PATH` (mode 0600), `setup`/`verify`/`reset`, timing-safe `validate({window:1})`. The "TOTP-gated" write protection for entry.yaml mutations.
- **`core/ruby.ts`** — review-gated Ruby execution: `execFile("ruby", ["-e", FIXED_TEMPLATE, ...argv])` with **no user input interpolated into the script** (v1 interpolated `account_name` into the Ruby source — an injection risk; v2 passes args via ARGV after strict validation). Used ONLY for `Lich::Common::GUI::PasswordCipher` encrypt/decrypt. Injectable exec for tests; `cwd` = lich dir derived from entry.yaml path.
- **`core/entry-yaml.ts`** (extend existing) — add `write()` (backup `${path}.bak.<ts>` then write, v1 semantics) + account CRUD helpers, all char/account names validated with the strict regex; the only place entry.yaml is written.
- **`core/sge.ts`** — SGE (eaccess.play.net:7910) TLS auth + character list, ported from v1 with an injectable transport for tests; plaintext passwords are never logged and never returned by routes.

**Key differences from v1:**
- v1 kept scan results in a standalone SQLite scan DB; v2 uses the core `CoreDb` with a new migration (`accounts`, `account_characters`).
- v1's `requireTotp` was an inline helper; v2 exposes the same gate as a module-level helper over `core/totp.ts`.
- v1 read/wrote entry.yaml inline (with backup); v2 routes only call the extended `core/entry-yaml.ts` capability.
- v1 ran Ruby with interpolated scripts; v2 runs fixed templates + ARGV (injection fix).
- **Deferred (follow-on, Task 9):** playdotnet inactive-char scraping and store-balance scraping (need `cheerio`/`fetch-cookie` and only run on the server). The v2 scan does SGE auth + active character list + entry.yaml chars — documented gap vs v1's full scan.
- Route prefixes change: `/api/accounts*` → `/api/modules/accounts/accounts*`, `/api/entry/*` → `/api/modules/accounts/entry/*`, `/api/totp/*` → `/api/modules/accounts/totp/*`.

## Module contract

```
name: "accounts"
prefix: "/api/modules/accounts"
scopes: accounts.read, accounts.write
routes:
  GET   /accounts                       accounts.read   (accounts + characters from CoreDb scan results)
  GET   /accounts/scan/status           accounts.read   ({ running })
  POST  /accounts/scan                  accounts.write  (scan ALL entry.yaml accounts, 30s spacing, 409 if running)
  POST  /accounts/:name/scan            accounts.write  (scan one account; 404 unknown)
  GET   /totp/status                    accounts.read   ({ setup })
  POST  /totp/setup                     accounts.write  ({ secret, uri, qrDataUrl }; 400 if already setup)
  POST  /totp/verify                    accounts.read   ({ code } → { valid })  [rate-limited oracle, v1-faithful]
  POST  /entry/account                  accounts.write  +TOTP gate ({account_name, password, totp_code})
  DELETE /entry/account/:name           accounts.write  +TOTP gate ({totp_code})
  PATCH /entry/account/:name/password   accounts.write  +TOTP gate ({password, totp_code})
  POST  /entry/account/:name/character  accounts.write  +TOTP gate ({char_name, game_code?, totp_code})
  DELETE /entry/account/:name/character/:char  accounts.write +TOTP gate ({totp_code})
```

**TOTP gate:** every entry mutation requires `totp_code`; 403 unless `totp.isSetup()` AND `totp.verify(code)` (window 1). v1-faithful error strings.

**Scan result schema (CoreDb):**
- `accounts(account_name PK, auth_status, auth_error, store_balance, store_reward_next, last_scan)`
- `account_characters(account_name, char_name, slot, game_code, source, level, race, profession, last_login, last_seen)`

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 12. `accounts.read` is read-only; `accounts.write` + TOTP gate for entry mutations.
- **Credentials:** account passwords are encrypted with `core/ruby.ts` (PasswordCipher) before writing entry.yaml; the scan decrypts only inside `core/ruby.ts`; plaintext passwords are never logged and never appear in responses. Passwords travel to the API over HTTPS in prod (same as v1).
- All SQL via prepared statements (CoreDb); no eval, no shell strings; Ruby confined to core/ruby.ts fixed templates.
- `ENTRY_YAML_PATH`/`TOTP_SECRET_PATH` envs, never hardcoded in commits.
- Rate limiting: module-level limiter (120 req/min) — the `/totp/verify` oracle is rate-limited like everything else.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review (dedicated capabilities are review-gated) before merge.

---

### Task 1: core/totp.ts + tests
**Files:** `backend/src/core/totp.ts`, `backend/tests/core/totp.test.ts`; deps: `otpauth`, `qrcode`.
- [ ] **Step 1:** failing tests — setup persists a base32 secret + returns uri/qr; verify accepts a current code (computed in-test with otpauth from the returned secret) and rejects a wrong code; verify is false when not setup; reset clears; secret file mode is 0600.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; gate; commit.

### Task 2: core/ruby.ts + tests
**Files:** `backend/src/core/ruby.ts`, `backend/tests/core/ruby.test.ts`.
- [ ] **Step 1:** failing tests — encrypt/decrypt call `ruby -e` with the fixed template + ARGV (mock exec asserts exact argv incl. `-e` template and args, no interpolation); account names strictly validated (rejects `..`, `"`, spaces); exec failure surfaces as `{ok:false,error}`; timeout passed.
- [ ] **Step 2:** FAIL. **Step 3:** implement (PasswordCipher template, cwd = lich dir from entry.yaml path). **Step 4:** PASS; gate; commit.

### Task 3: extend core/entry-yaml.ts (write + account CRUD)
**Files:** `backend/src/core/entry-yaml.ts`, `backend/tests/core/entry-yaml.test.ts` (extend).
- [ ] **Step 1:** failing tests — write() backs up then writes; addAccount/deleteAccount/updatePassword/addCharacter/deleteCharacter round-trip through the yaml package; duplicates 409-style errors surfaced; names validated.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; gate; commit.

### Task 4: core/sge.ts + tests
**Files:** `backend/src/core/sge.ts`, `backend/tests/core/sge.test.ts`.
- [ ] **Step 1:** failing tests — protocol handling with an injectable transport: handshake → sendAuth (masked password) → KEY → M → N → G → C parse into chars; invalid_password / reject / norecord error mapping; timeout.
- [ ] **Step 2:** FAIL. **Step 3:** implement (tls.connect wrapper, injectable socket). **Step 4:** PASS; gate; commit.

### Task 5: AccountsStore + CoreDb migration + scan orchestration
**Files:** `backend/src/modules/accounts/store.ts`, `backend/tests/modules/accounts/store.test.ts`.
- [ ] **Step 1:** failing tests (stub ruby/sge): scan single account stores accounts + account_characters rows (SGE chars + yaml-only chars with source flags); scan-all iterates entry.yaml accounts; scan lock prevents concurrent scans; list() returns accounts + characters; delete account/char removes rows.
- [ ] **Step 2:** FAIL. **Step 3:** implement (CoreDb.migrate for accounts tables; `scanRunning` process-local lock; 30s spacing injectable for tests). **Step 4:** PASS; gate; commit.

### Task 6: module routes + registration
**Files:** `backend/src/modules/accounts/index.ts`, `backend/tests/modules/accounts/routes.test.ts`.
- [ ] **Step 1:** failing routes test — 401/403; accounts list; scan single/all + status; totp setup/status/verify flow (real otpauth); entry CRUD with correct totp_code succeeds and wrong code 403s; 409 duplicate account/char; OpenAPI coverage.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; gate; commit.

### Task 7: wire entrypoint + SECURITY.md delta + smoke test
**Files:** `backend/src/index.ts`, `backend/SECURITY.md`.
- [ ] **Step 1:** register accounts module (TOTP capability, Ruby capability, EntryYaml, SGE, AccountsStore, CoreDb migration) before `registry.validate()`.
- [ ] **Step 2:** SECURITY.md delta — accounts: scopes, TOTP gate, credential handling (PasswordCipher via core/ruby.ts, never logged), entry.yaml writes via capability, SGE port, deferred playdotnet/store scrape.
- [ ] **Step 3:** smoke test — boot with temp TOTP secret + entry.yaml fixture; totp setup/verify; entry add/delete account/char with code; accounts list; scan error paths (no SGE access on Windows).
- [ ] **Step 4:** security_review (capabilities are the review gate); fix findings; commit.

### Task 8: PR
- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 9: (Follow-on, tracked here)
- playdotnet inactive-char + store-balance scrape (needs cheerio/fetch-cookie, server-only).
- Update server watchdog/Lich consumers of `/api/accounts*`, `/api/entry/*`, `/api/totp/*` post-deploy; retire v1 routes.

---

## Self-Review Notes

- **Review-gated capabilities:** TOTP (core/totp.ts), Ruby/PasswordCipher (core/ruby.ts, fixed templates + ARGV, injection fix vs v1), entry.yaml writes (extended core/entry-yaml.ts), SGE (core/sge.ts). Credentials never logged or returned.
- **Faithful port:** same routes, TOTP gate semantics, scan results schema, entry.yaml backup-then-write.
- **Deferred:** playdotnet/store scrape (Task 9) — the v2 scan is SGE auth + active chars + entry.yaml chars.
