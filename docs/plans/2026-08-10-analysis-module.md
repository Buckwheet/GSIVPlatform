# Analysis Module Implementation Plan (combat log analysis + upload + history)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port v1 `/api/analysis/*` + `/api/logs/game/:char` into GSIVPlatform as the `analysis` module — Phase A #6 (the last Phase A module). Per the established decision, every privileged mechanism goes through a **dedicated, review-gated core capability**.

**Reference (read-only):** v1 `D:\Code Projects\GSIVDashboard\backend\src\index.ts` lines ~1574-1645 (analysis routes) + ~491-510 (`findLatestLog`, GET `/api/logs/game/:char`).

**Key architecture note:** the AI itself (Groq) runs in **server-side shell scripts** (`run-analysis.sh`, `shiva-loop.sh` under `/opt/gs4sd/data/`). The backend never talks to a provider — it kicks off the scripts and reads/writes their files. The v2 port keeps this split; no provider decision lives in the backend.

## Security model (review-gated core capabilities)

- **`core/analysis-files.ts`** — the ONLY place that touches the analysis data dir (`ANALYSIS_DATA_DIR`, default `/opt/gs4sd/data`) and the Lich game-log dir (`LICH_LOG_DIR`, default `/opt/gs4sd/lich5/logs`). Reads: analysis output/status/usage/history files; writes: uploaded `.log` files (mkdir recursive, filename sanitized, `.log`-only, size-capped). Traversal-proof path resolution (same resolve+prefix model as `core/config-files.ts`).
- **`core/script-runner.ts`** — the ONLY place that executes the server-side analysis scripts. A **fixed allowlist** of script paths (`run-analysis.sh`, `shiva-loop.sh` under the data dir) — never user-controlled; execFile with args array + injectable exec; background (unref) semantics.

**Key differences from v1:**
- v1 read/wrote the analysis files and ran scripts inline with hardcoded `/opt/gs4sd/data/...` paths; v2 confines all of it to the two capabilities.
- v1 `POST /analysis/upload` had no size cap; v2 caps uploads (50 MB) and requires `.log` + sanitized name (v1 sanitized name + `.log` check).
- Route prefixes change: `/api/analysis/*` → `/api/modules/analysis/*`, `/api/logs/game/:char` → `/api/modules/analysis/logs/game/:char`.
- v1's `GET /api/logs` (event-log history) is NOT ported — it reads the v1 events DB, which has no v2 equivalent yet (logEvent core is a later item). "history" here = `analysis-history.json`, which IS ported.

## Module contract

```
name: "analysis"
prefix: "/api/modules/analysis"
scopes: analysis.read, analysis.write
routes:
  GET  /analysis              analysis.read  ({output, status, usage} from the analysis data dir)
  GET  /analysis/history      analysis.read  (analysis-history.json array)
  POST /analysis/run          analysis.write (kick run-analysis.sh in background)
  POST /analysis/loop         analysis.write (kick shiva-loop.sh in background)
  POST /analysis/upload       analysis.write (multipart .log → mejora-logs/<Char>/<YYYY>/<MM>/)
  GET  /logs/game/:char       analysis.read  (?lines=80 ≤ 500; tail the latest game log)
```

## Global Constraints (inherit from core + SECURITY.md)

- Every route declares a scope; routeScopes covers all 6. `analysis.read` is read-only; `analysis.write` is the only write scope.
- No shell strings: scripts run via `core/script-runner.ts` fixed allowlist (execFile args array, never a shell); fs confined to `core/analysis-files.ts`.
- Char names validated with the strict regex; upload filenames sanitized to `[A-Za-z0-9._-]` and must end `.log`; uploads size-capped (50 MB).
- `ANALYSIS_DATA_DIR`/`LICH_LOG_DIR` envs, never hardcoded in commits (defaults mirror v1).
- Rate limiting: module-level limiter applies.
- TDD per step. Gates: `npm test && npm run typecheck && npm run lint`; security review (capabilities are review-gated) before merge.

---

### Task 1: core/analysis-files.ts + tests
**Files:** `backend/src/core/analysis-files.ts`, `backend/tests/core/analysis-files.test.ts`.
- [ ] **Step 1: failing tests** — readOutput/status/usage/history (missing file → empty/[]); upload() sanitizes names, rejects non-.log and traversal, mkdirs YYYY/MM, size-capped; tailGameLog() finds the latest `.log` under `LICH_LOG_DIR/GSIV-<Char>` recursively, tails `lines` (≤500), filters `<pushStream`/`<popStream`; invalid char names rejected.
- [ ] **Step 2: run → FAIL. Step 3: implement. Step 4: PASS; gate; commit.**

### Task 2: core/script-runner.ts + tests
**Files:** `backend/src/core/script-runner.ts`, `backend/tests/core/script-runner.test.ts`.
- [ ] **Step 1: failing tests** — run("run-analysis") resolves the fixed script path under the data dir and execs it (mock exec asserts exact argv); run("shiva-loop") same; unknown script name rejected before exec; exec failure surfaces; background/unref semantics.
- [ ] **Step 2: FAIL. Step 3: implement (allowlist map + execFile + injectable exec). Step 4: PASS; gate; commit.**

### Task 3: module routes + registration
**Files:** `backend/src/modules/analysis/index.ts`, `backend/tests/modules/analysis/routes.test.ts`.
- [ ] **Step 1: failing routes test** — 401/403; GET analysis/history with temp files; POST run/loop (stubbed runner); POST upload (multipart File, .log required, sanitized); GET logs/game/:char tail; OpenAPI coverage.
- [ ] **Step 2: FAIL. Step 3: implement (multipart via c.req.parseBody; zod-openapi route with permissive body). Step 4: PASS; gate; commit.**

### Task 4: wire entrypoint + SECURITY.md delta + smoke test
- [ ] Register analysis module (AnalysisFiles with env dirs, ScriptRunner with data dir) before `registry.validate()`.
- [ ] SECURITY.md delta; smoke test with temp data dir + log dir.

### Task 5: PR
- [ ] Push branch, `gh pr create --base main`, merge via `gh pr merge --merge`.

### Task 6: (Follow-on, tracked here)
- `GET /api/logs` (event history) once the logEvent core lands; update server consumers post-deploy; retire v1 analysis routes.
- Harden the analysis shell scripts server-side (they run as the service user; review their contents separately).

---

## Self-Review Notes

- **Review-gated capabilities:** analysis data/log dirs (core/analysis-files.ts, traversal-proof) and server scripts (core/script-runner.ts, fixed allowlist, args-array execFile).
- **Faithful port:** same routes/files/semantics (output/status/usage/history files, mejora-logs layout, game-log tail with push/pop filtering).
- **Deviations:** upload size cap (50 MB) added; event-log route deferred (no v2 events core); documented.
