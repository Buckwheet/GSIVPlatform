# Config Module Implementation Plan (config files + go2 + eherbs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port v1 `/api/config/*` (character script config files) + `/api/go2/*` + `/api/eherbs/*` into GSIVPlatform as the `config` module — Phase A #5. Per the established decision, every privileged mechanism goes through a **dedicated, review-gated core capability**.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts`:
- Config files: lines ~662-760 (`resolveCharDir`, `GSIV_DATA_DIR`/`GST_DATA_DIR`, GET list, GET/PUT `:char/*`, POST `copy-from/:source`).
- go2: lines ~1030-1105 (GET/PUT `:char` — Ruby `uservars` + `script_auto_settings` Marshal blobs in lich.db3).
- eherbs: lines ~1107-1180 (GET/PUT `:char` — `script_auto_settings` for 'eherbs').

## Security model (review-gated core capabilities)

- **`core/lich-db.ts`** — the ONLY place that runs Ruby against `lich.db3` (env `LICH_DB_PATH`, default `/opt/gs4sd/lich5/data/lich.db3`). Fixed Ruby templates + ARGV (scope, settings JSON passed as args — **no user input interpolated into Ruby source**; v1 interpolated the scope into the script, an injection risk). Injectable exec for tests.
- **`core/config-files.ts`** — the ONLY place that touches the lich config dirs (`GSIV_DATA_DIR`/`GST_DATA_DIR`, derived from the entry.yaml dir). Strict path resolution: every requested relative path is resolved and must stay inside the char dir (traversal-proof; v1's `startsWith` guard is replaced with a `resolve()` + prefix check). Backup-then-write for PUT and copy-from (v1 semantics).
- **ConfigStore** — `resolveCharDir` logic (GSIV/GST instance resolution, v1-faithful) + orchestration.

**Key differences from v1:**
- v1 read/wrote go2/eherbs with interpolated Ruby scripts; v2 uses fixed templates + ARGV via `core/lich-db.ts`.
- v1 read/wrote config files inline with a `startsWith` guard; v2 confines all fs access to `core/config-files.ts` with resolve+prefix validation.
- Route prefixes change: `/api/config/*` → `/api/modules/config/*`, `/api/go2/:char` → `/api/modules/config/go2/:char`, `/api/eherbs/:char` → `/api/modules/config/eherbs/:char`.
- **Deviations (documented):** file paths are passed as a `?path=` query (or body `file`) instead of a path wildcard — avoids wildcard routing in the zod-openapi router; same semantics, stricter validation. go2/eherbs `instance` query param kept (`GSIV`|`GST`|`GS3`).

## Module contract

```
name: "config"
prefix: "/api/modules/config"
scopes: config.read, config.write
routes:
  GET  /config/:char            config.read   (?instance=; list config files)
  GET  /config/:char/file       config.read   (?path=sub/file.txt; read one file; 400 bad path, 404 missing)
  PUT  /config/:char/file       config.write  (body {path, content}; backup-then-write; 400 bad path)
  POST /config/:char/copy-from/:source  config.write  (body {files?}; copy files source→target, backup-then-write)
  GET  /go2/:char               config.read   (?instance=; go2 settings from lich.db3)
  PUT  /go2/:char               config.write  (body = settings object; write via Ruby Marshal)
  GET  /eherbs/:char            config.read   (?instance=; eherbs settings)
  PUT  /eherbs/:char            config.write  (body = settings object)
```

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 8. `config.read` is read-only; `config.write` is the only write scope.
- **No shell strings, no eval** — Ruby confined to core/lich-db.ts fixed templates; fs confined to core/config-files.ts.
- Char names validated with the strict regex before any path/Ruby use; `instance` restricted to `GSIV`|`GST`|`GS3`.
- `LICH_DB_PATH`/`GSIV_DATA_DIR`/`GST_DATA_DIR` envs, never hardcoded in commits (defaults mirror v1).
- Rate limiting: module-level limiter applies.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review (capabilities are review-gated) before merge.

---

### Task 1: core/lich-db.ts + tests
**Files:** `backend/src/core/lich-db.ts`, `backend/tests/core/lich-db.test.ts`.
- [ ] **Step 1: failing tests** — go2Get calls ruby with the fixed template + ARGV (scope via ARGV, no interpolation — assert template references ARGV and not the literal scope); parses the JSON stdout into settings; go2Put passes the settings JSON via ARGV and maps the stdout `{"ok":true}`; eherbsGet/Put same; exec failure → `{ok:false,error}`; invalid char names rejected before exec; LICH_DB_PATH passed via ARGV.
- [ ] **Step 2: run → FAIL. Step 3: implement (port v1 go2/eherbs Ruby templates as fixed scripts; scope + settings + db path via ARGV). Step 4: PASS; gate; commit.**

### Task 2: core/config-files.ts + tests
**Files:** `backend/src/core/config-files.ts`, `backend/tests/core/config-files.test.ts`.
- [ ] **Step 1: failing tests** — list() walks the char dir returning {path,size,modified}; read() returns content; write() backs up then writes; copyFrom copies with backups; **path traversal rejected** (`../`, absolute, encoded); unknown char dir → null (list returns empty / read 404); instance resolution (GSIV/GST).
- [ ] **Step 2: FAIL. Step 3: implement (resolveCharDir port; resolve+prefix validation). Step 4: PASS; gate; commit.**

### Task 3: ConfigStore
**Files:** `backend/src/modules/config/store.ts` (thin — wraps lich-db + config-files; keep if it earns its place, else routes call the capabilities directly).

### Task 4: module routes + registration
**Files:** `backend/src/modules/config/index.ts`, `backend/tests/modules/config/routes.test.ts`.
- [ ] **Step 1: failing routes test** — 401/403; file list/read/write/copy with a temp dir; go2/eherbs get/put with a stubbed lich-db; traversal 400; unknown char 404; OpenAPI coverage.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS; gate; commit.**

### Task 5: wire entrypoint + SECURITY.md delta + smoke test
- [ ] Register config module (LichDb, ConfigFiles with env dirs) before `registry.validate()`.
- [ ] SECURITY.md delta; smoke test with temp GSIV_DATA_DIR + stub lich-db.

### Task 6: PR
- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 7: (Follow-on, tracked here)
- Update server consumers of `/api/config*`, `/api/go2*`, `/api/eherbs*` post-deploy; retire v1 routes.

---

## Self-Review Notes

- **Review-gated capabilities:** lich.db3 (core/lich-db.ts, fixed templates + ARGV — injection fix vs v1) and lich config dirs (core/config-files.ts, traversal-proof resolve+prefix).
- **Faithful port:** same routes/semantics (backup-then-write, resolveCharDir instance logic, go2/eherbs key mappings).
- **Deviations:** file path via query/body param instead of path wildcard (router compatibility); documented.
