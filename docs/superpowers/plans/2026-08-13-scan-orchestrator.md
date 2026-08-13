# Scan Orchestrator + Scheduler UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bash-driven InvDB scheduler with a TypeScript scan orchestrator (5 concurrent accounts, full re-scan, manual retry) and a live animated `/scans` page, with failure alerting.

**Architecture:** A review-gated `core/scan-runner.ts` capability executes one character's scan cycle (systemd + inv.db3 + lich commands, all injected). A `modules/scans` store owns the job model, a 5-worker pool, persistence to gsiv.db, retry, and WS/alert emission. The frontend `/scans` page renders live per-account progress from a `scan_update` WS event.

**Tech Stack:** Hono + @hono/zod-openapi, better-sqlite3, vitest, React + Vite, the existing `Systemd`/`InvDb`/`LichStore`/`EntryYaml`/`CoreDb`/`EventBus` capabilities.

## Global Constraints

- Repo lives on `D:\Code Projects\GSIVPlatform` — **all edits go through bash** (heredoc/node), not the file tools.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit. Gate before merge: `cd backend && npm test && npm run typecheck && npm run lint`; `cd frontend && npm run build`.
- Review-gated rule: `child_process` and inv.db3/entry.yaml file IO stay in `backend/src/core/*`. Modules never exec or touch those paths; no shell strings (`execFile` args arrays only).
- Work ships via branch + PR (`gh pr merge <n> --merge`). Branch is already `feature/scans-orchestrator`.
- Testing rule: live smoke only on Fisternar/Neleourg; **Amn (UNFOCUSEDPIE) is off-limits**.
- Long heredocs truncate past ~170 lines — write files in chunks and join.
- `Registry.validate()` fails fast if a scope is declared but unused, or a route-scope key is malformed.
- Manifest: `requiresScopes` = the module's `.read` scopes; every GET route must be gated by a `.read` scope. Regenerate with `cd backend && npm run gen:manifest`.

---

### Task 1: `InvDb.charTimestamp` read method

The ScanRunner needs to poll a character's inv.db3 `character.timestamp` to detect a full re-scan (timestamp advances) or first scan (row appears). Add a read method to the existing review-gated `InvDb`.

**Files:**
- Modify: `backend/src/core/inv-db.ts` (add method, after `get path()`)
- Test: `backend/tests/core/inv-db.test.ts` (append a describe)

**Interfaces:**
- Consumes: nothing new.
- Produces: `InvDb.charTimestamp(name: string): number | null` — the latest `character.timestamp` for a char (case-insensitive), or `null` when no row or on error.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/core/inv-db.test.ts`:

```ts
describe("InvDb.charTimestamp", () => {
  it("returns null when the char has no row", () => {
    const dir = mkdtempSync(join(tmpdir(), "invdb-ts-"));
    const path = join(dir, "inv.db3");
    const db = new Database(path);
    db.exec("CREATE TABLE character (id INTEGER PRIMARY KEY, name TEXT, timestamp INTEGER)");
    db.close();
    const inv = new InvDb(path);
    expect(inv.charTimestamp("Fisternar")).toBeNull();
    inv.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the latest timestamp for a char (case-insensitive)", () => {
    const dir = mkdtempSync(join(tmpdir(), "invdb-ts-"));
    const path = join(dir, "inv.db3");
    const db = new Database(path);
    db.exec("CREATE TABLE character (id INTEGER PRIMARY KEY, name TEXT, timestamp INTEGER)");
    db.prepare("INSERT INTO character (name, timestamp) VALUES (?, ?)").run("Fisternar", 1700000000);
    db.close();
    const inv = new InvDb(path);
    expect(inv.charTimestamp("fisternar")).toBe(1700000000);
    inv.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

(Ensure `import Database from "better-sqlite3";` and `import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";` are present at the top of the test file — add if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/inv-db.test.ts -t "charTimestamp"`
Expected: FAIL — `inv.charTimestamp is not a function`

- [ ] **Step 3: Write the implementation**

Add to `backend/src/core/inv-db.ts`, right after `get path()`:

```ts
  /**
   * Latest `character.timestamp` for a char (case-insensitive), or null when
   * the char has no row. Used by the scan runner to detect scan completion
   * (a full re-scan advances the timestamp; a first scan creates the row).
   */
  charTimestamp(name: string): number | null {
    try {
      const db = this.open();
      const row = db
        .prepare("SELECT timestamp FROM character WHERE LOWER(name) = LOWER(?)")
        .get(name) as { timestamp: number | null } | undefined;
      return row?.timestamp ?? null;
    } catch {
      return null; // missing table/DB during a scan must not crash the runner
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/inv-db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/core/inv-db.ts backend/tests/core/inv-db.test.ts
git commit -m "feat(inv-db): add charTimestamp read for scan completion polling"
```

---

### Task 2: `core/scan-runner.ts` — the ScanRunner capability

A review-gated capability that executes one character's full scan cycle. All side-effecting deps are injected so it is unit-testable without a real game server.

**Files:**
- Create: `backend/src/core/scan-runner.ts`
- Test: `backend/tests/core/scan-runner.test.ts`

**Interfaces:**
- Consumes: `Systemd.action`, `InvDb.charTimestamp` (Task 1).
- Produces:
  - `type ScanStage = "starting" | "waiting_online" | "scanning" | "tickets" | "done" | "failed" | "timeout"`
  - `interface ScanCharResult { char: string; result: "done" | "timeout" | "failed"; error?: string }`
  - `class ScanRunner` with `scanChar(char, onStage?): Promise<ScanCharResult>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/core/scan-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScanRunner, type ScanRunnerDeps } from "../../src/core/scan-runner.js";

const FAST = {
  onlineTimeoutMs: 50,
  scanTimeoutMs: 50,
  settleMs: 0,
  ticketsSettleMs: 0,
  pollMs: 5,
};

function makeDeps(overrides: Partial<ScanRunnerDeps> = {}): ScanRunnerDeps & {
  starts: string[];
  stops: string[];
  scripts: string[];
  ts: Map<string, number | null>;
} {
  const ts = new Map<string, number | null>();
  const deps = {
    ts,
    starts: [],
    stops: [],
    scripts: [],
    systemd: {
      async action(action: "start" | "stop", name: string) {
        (action === "start" ? deps.starts : deps.stops).push(name);
        return { ok: true };
      },
    },
    invDb: { charTimestamp: (name: string) => ts.get(name) ?? null },
    async sendScript(char: string, script: string) {
      deps.scripts.push(`${char}:${script}`);
      if (script === ";invdb") ts.set(char, (ts.get(char) ?? 0) + 1);
    },
    async isOnline() {
      return true;
    },
    ...overrides,
  };
  return deps;
}

describe("ScanRunner", () => {
  it("runs the full cycle and reports done", async () => {
    const deps = makeDeps();
    const runner = new ScanRunner(deps, FAST);
    const stages: string[] = [];
    const res = await runner.scanChar("Fisternar", (s) => stages.push(s));
    expect(res).toEqual({ char: "Fisternar", result: "done" });
    expect(deps.starts).toEqual(["Fisternar"]);
    expect(deps.stops).toEqual(["Fisternar"]);
    expect(deps.scripts).toEqual(["Fisternar:;invdb", "Fisternar:;invdb tickets"]);
    expect(stages).toEqual(["starting", "waiting_online", "scanning", "tickets", "done"]);
  });

  it("fails when systemd start errors", async () => {
    const deps = makeDeps({
      systemd: { async action() { return { ok: false, error: "no unit" }; } },
    });
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("failed");
    expect(res.error).toBe("no unit");
  });

  it("times out when the char never comes online", async () => {
    const deps = makeDeps({ isOnline: async () => false });
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("timeout");
    expect(deps.stops).toEqual(["Fisternar"]); // cleaned up the unit
  });

  it("times out when invdb produces no write", async () => {
    const deps = makeDeps();
    // sendScript advances ts only for ";invdb" — override to NOT advance
    deps.sendScript = async (c, s) => { deps.scripts.push(`${c}:${s}`); };
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("timeout");
    expect(res.error).toBe("no invdb write");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/core/scan-runner.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/scan-runner.js'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/core/scan-runner.ts`:

```ts
// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place that runs an invdb scan cycle
// for one character (systemd unit start/stop, lich command dispatch, and
// inv.db3 completion polling). Every side-effecting dependency is injected;
// this file performs no child_process or file IO of its own — it composes the
// Systemd + InvDb capabilities and a caller-supplied lich channel.
// ---------------------------------------------------------------------------

export type ScanStage = "starting" | "waiting_online" | "scanning" | "tickets" | "done" | "failed" | "timeout";

export interface ScanCharResult {
  char: string;
  result: "done" | "timeout" | "failed";
  error?: string;
}

export interface ScanRunnerDeps {
  systemd: { action(action: "start" | "stop", name: string): Promise<{ ok: boolean; error?: string }> };
  invDb: { charTimestamp(name: string): number | null };
  sendScript(char: string, script: string): Promise<void>;
  isOnline(char: string): Promise<boolean>;
}

export interface ScanTimings {
  onlineTimeoutMs: number;
  scanTimeoutMs: number;
  settleMs: number;
  ticketsSettleMs: number;
  pollMs: number;
}

const DEFAULT_TIMINGS: ScanTimings = {
  onlineTimeoutMs: 180_000, // wait for the lich session to come online (<=3 min)
  scanTimeoutMs: 240_000, // wait for the ;invdb write (<=4 min)
  settleMs: 8_000, // let the session finish logging in before sending ;invdb
  ticketsSettleMs: 10_000, // let ;invdb tickets finish before stopping the unit
  pollMs: 2_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ScanRunner {
  private timings: ScanTimings;

  constructor(
    private deps: ScanRunnerDeps,
    timings: Partial<ScanTimings> = {},
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  /** Scan one character end-to-end, reporting each stage transition. */
  async scanChar(char: string, onStage?: (stage: ScanStage, detail: string) => void): Promise<ScanCharResult> {
    const { systemd, invDb, sendScript, isOnline } = this.deps;
    const t = this.timings;
    const stage = (s: ScanStage, detail = char) => onStage?.(s, detail);

    stage("starting");
    const started = await systemd.action("start", char);
    if (!started.ok) {
      stage("failed", started.error ?? "start failed");
      return { char, result: "failed", error: started.error };
    }

    stage("waiting_online");
    const online = await this.waitFor(() => isOnline(char), t.onlineTimeoutMs);
    if (!online) {
      stage("timeout", "never came online");
      await systemd.action("stop", char);
      return { char, result: "timeout", error: "not online" };
    }

    await sleep(t.settleMs);

    const before = invDb.charTimestamp(char);
    stage("scanning");
    await sendScript(char, ";invdb");
    const wrote = await this.waitFor(() => {
      const ts = invDb.charTimestamp(char);
      return before === null ? ts !== null : (ts ?? 0) > before;
    }, t.scanTimeoutMs);
    if (!wrote) {
      stage("timeout", "invdb produced no write");
      await systemd.action("stop", char);
      return { char, result: "timeout", error: "no invdb write" };
    }

    stage("tickets");
    await sendScript(char, ";invdb tickets");
    await sleep(t.ticketsSettleMs);

    await systemd.action("stop", char);
    stage("done");
    return { char, result: "done" };
  }

  private async waitFor(pred: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await pred()) return true;
      await sleep(this.timings.pollMs);
    }
    return await pred();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/core/scan-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/core/scan-runner.ts backend/tests/core/scan-runner.test.ts
git commit -m "feat(scan-runner): char scan cycle capability (systemd + invdb poll + lich commands)"
```

---

### Task 3: `modules/scans/store.ts` — ScansStore

The job model + bounded worker pool + persistence + retry. Holds one in-flight job, scans at most 5 accounts concurrently (chars sequential per account), and emits `scan_update`/`scan_alert`.

**Files:**
- Create: `backend/src/modules/scans/store.ts`
- Test: `backend/tests/modules/scans/store.test.ts`

**Interfaces:**
- Consumes: `ScanCharResult`, `ScanStage` (Task 2); `CoreDb`, `EntryYaml`.
- Produces:
  - `interface CharScanner { scanChar(char, onStage?): Promise<ScanCharResult> }`
  - `class ScansStore` with `start(explicit?)`, `retry(jobId)`, `targets(explicit?)`, `currentJob()`, `scanRunning()`, `whenIdle()`, `history(limit?)`

- [ ] **Step 1: Write the failing test** — see the test block in the next two steps; first create the store module skeleton is NOT needed (TDD: write the test, watch it fail on import).

Create `backend/tests/modules/scans/store.test.ts`:

```ts
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import type { ScanCharResult, ScanStage } from "../../../src/core/scan-runner.js";
import { ScansStore } from "../../../src/modules/scans/store.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");
const TMP = mkdtempSync(join(tmpdir(), "scans-store-"));
let counter = 0;
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

type Emitted = { type: string; payload: unknown };
function makeStore(opts: {
  results?: Record<string, "done" | "failed">;
  maxConcurrent?: number;
  okAccounts?: string[];
  skipAccounts?: string[];
} = {}) {
  const db = new CoreDb(":memory:");
  const yamlPath = join(TMP, `entry-${++counter}.yaml`);
  copyFileSync(FIXTURE, yamlPath);
  const events: Emitted[] = [];
  const logs: string[] = [];
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];
  const results = opts.results ?? {};
  const runner = {
    started,
    maxActive: () => maxActive,
    async scanChar(char: string, onStage?: (stage: ScanStage, detail: string) => void): Promise<ScanCharResult> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(char);
      onStage?.("scanning", char);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return results[char] === "failed"
        ? { char, result: "failed", error: "boom" }
        : { char, result: "done" };
    },
  };
  const store = new ScansStore(
    db,
    new EntryYaml(yamlPath),
    runner,
    (type, payload) => events.push({ type, payload: JSON.parse(JSON.stringify(payload)) }),
    (type, _c, detail) => logs.push(`${type}:${detail}`),
    {
      maxConcurrent: opts.maxConcurrent ?? 5,
      okAccounts: () => (opts.okAccounts ?? ["BUCKWHEET", "ALT"]),
      skipAccounts: opts.skipAccounts ?? [],
    },
  );
  return { db, store, events, logs, runner, started };
}

describe("ScansStore", () => {
  it("targets() returns auth-ok accounts' chars, minus skip", () => {
    const { store } = makeStore({ okAccounts: ["BUCKWHEET"], skipAccounts: ["BUCKWHEET"] });
    expect(store.targets()).toEqual([]); // skipped
    const { store: s2 } = makeStore({ okAccounts: ["BUCKWHEET"] });
    expect(s2.targets()).toEqual([{ account: "BUCKWHEET", chars: ["Fisternar", "Zepherus"] }]);
  });

  it("start() runs a job to completion and persists it", async () => {
    const { store, events } = makeStore();
    const res = store.start();
    expect(res.ok).toBe(true);
    expect(res.totalAccounts).toBe(2);
    await store.whenIdle();
    const job = store.currentJob();
    expect(job?.status).toBe("done");
    expect(job?.accounts.map((a) => a.status)).toEqual(["done", "done"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("scan_update");
    const hist = store.history();
    expect(hist.jobs.length).toBe(1);
    expect(hist.jobs[0].status).toBe("done");
  });

  it("bounds concurrency to maxConcurrent", async () => {
    const { store, runner } = makeStore({ maxConcurrent: 1 });
    store.start();
    await store.whenIdle();
    expect(runner.maxActive()).toBe(1);
    expect(runner.started.length).toBe(3); // Fisternar, Zepherus, Neleourg
  });

  it("marks an account failed and emits scan_alert + log", async () => {
    const { store, events, logs } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" } });
    store.start();
    await store.whenIdle();
    const job = store.currentJob();
    expect(job?.status).toBe("partial"); // ALT still succeeded
    expect(job?.accounts.find((a) => a.account === "BUCKWHEET")?.status).toBe("failed");
    expect(events.some((e) => e.type === "scan_alert")).toBe(true);
    expect(logs.some((l) => l.startsWith("scan_partial:"))).toBe(true);
  });

  it("rejects a concurrent start", async () => {
    const { store } = makeStore();
    expect(store.start().ok).toBe(true);
    expect(store.start()).toEqual({ ok: false, error: "scan already running" });
    await store.whenIdle();
  });

  it("retry() re-runs only the failed accounts", async () => {
    const { store } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" } });
    store.start();
    await store.whenIdle();
    const retry = store.retry(store.currentJob()!.id);
    expect(retry.ok).toBe(true);
    expect(retry.totalAccounts).toBe(1); // only BUCKWHEET
    await store.whenIdle();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/scans/store.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/scans/store.js'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/scans/store.ts`:

```ts
import type { CoreDb } from "../../core/db.js";
import type { EntryYaml } from "../../core/entry-yaml.js";
import type { ScanCharResult, ScanStage } from "../../core/scan-runner.js";

export type AccountStatus = "queued" | "running" | "done" | "partial" | "failed";
export type JobStatus = "running" | "done" | "partial" | "failed";

export interface ScanAccountState {
  account: string;
  chars: string[];
  status: AccountStatus;
  charsDone: number;
  charsFailed: number;
  current: string | null;
  stage: ScanStage | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ScanJob {
  id: number;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  accounts: ScanAccountState[];
}

export interface ScanTarget {
  account: string;
  chars: string[];
}

/** Narrow scanner surface the store depends on (ScanRunner satisfies it). */
export interface CharScanner {
  scanChar(char: string, onStage?: (stage: ScanStage, detail: string) => void): Promise<ScanCharResult>;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    total_accounts INTEGER NOT NULL DEFAULT 0,
    accounts_done INTEGER NOT NULL DEFAULT 0,
    accounts_failed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS scan_accounts (
    job_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    status TEXT NOT NULL,
    chars_total INTEGER NOT NULL DEFAULT 0,
    chars_done INTEGER NOT NULL DEFAULT 0,
    chars_failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scan_accounts_job ON scan_accounts(job_id)`,
];

export interface ScansStoreOptions {
  maxConcurrent?: number;
  skipAccounts?: string[];
  okAccounts?: () => string[];
  now?: () => number;
}

const DEFAULT_SKIP = ["UNFOCUSEDPIE"];

function defaultOkAccounts(db: CoreDb): () => string[] {
  return () => {
    try {
      const rows = db
        .get()
        .prepare("SELECT account_name FROM accounts WHERE auth_status = 'ok'")
 
        .all() as { account_name: string }[];
      return rows.map((r) => r.account_name);
    } catch {
      return []; // accounts table not yet migrated — no targets until the roster scan runs
    }
  };
}

export class ScansStore {
  private running = false;
  private active: Promise<void> | null = null;
  private current: ScanJob | null = null;
  private readonly db;
  private readonly maxConcurrent: number;
  private readonly skip: Set<string>;
  private readonly okAccounts: () => string[];
  private readonly now: () => number;

  constructor(
    db: CoreDb,
    private yaml: EntryYaml,
    private runner: CharScanner,
    private emit: (type: string, payload: unknown) => void,
    private log: (type: string, char: string | null, detail: string, source: string) => void,
    opts: ScansStoreOptions = {},
  ) {
    db.migrate("scans", MIGRATIONS);
    this.db = db.get();
    this.maxConcurrent = opts.maxConcurrent ?? 5;
    this.skip = new Set((opts.skipAccounts ?? DEFAULT_SKIP).map((s) => s.toUpperCase()));
    this.okAccounts = opts.okAccounts ?? defaultOkAccounts(db);
    this.now = opts.now ?? Date.now;
  }

  scanRunning(): boolean {
    return this.running;
  }

  async whenIdle(): Promise<void> {
    if (this.active) await this.active;
  }

  currentJob(): ScanJob | null {
    return this.current;
  }

  /** account -> chars target set (default = auth-ok minus skip; explicit overrides auth filter). */
  targets(explicit?: string[]): ScanTarget[] {
    const map = new Map<string, string[]>();
    const okSet = explicit ? null : new Set(this.okAccounts());
    const want = explicit ? new Set(explicit.map((s) => s.toUpperCase())) : null;
    for (const ch of this.yaml.read()) {
      if (this.skip.has(ch.account)) continue;
      if (okSet && !okSet.has(ch.account)) continue;
      if (want && !want.has(ch.account)) continue;
      const list = map.get(ch.account) ?? [];
      list.push(ch.char_name);
      map.set(ch.account, list);
    }
    return [...map.entries()]
      .map(([account, chars]) => ({ account, chars }))
      .sort((a, b) => a.account.localeCompare(b.account));
  }

  start(explicit?: string[]): { ok: boolean; jobId?: number; totalAccounts?: number; error?: string } {
    if (this.running) return { ok: false, error: "scan already running" };
    const targets = this.targets(explicit);
    if (targets.length === 0) return { ok: false, error: "no scan targets (no auth-ok accounts in entry.yaml)" };
    const jobId = this.insertJob(targets.length);
    this.current = {
      id: jobId,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      accounts: targets.map((t) => ({
        account: t.account,
        chars: t.chars,
        status: "queued",
        charsDone: 0,
        charsFailed: 0,
        current: null,
        stage: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
    };
    this.running = true;
    this.active = this.runJob().finally(() => {
      this.running = false;
      this.finalizeJob();
    });
    return { ok: true, jobId, totalAccounts: targets.length };
  }

  retry(jobId: number): { ok: boolean; jobId?: number; totalAccounts?: number; error?: string } {
    if (this.running) return { ok: false, error: "scan already running" };
    const rows = this.db
      .prepare("SELECT account_name FROM scan_accounts WHERE job_id = ? AND status IN ('failed','partial')")
      .all(jobId) as { account_name: string }[];
    const failed = rows.map((r) => r.account_name);
    if (failed.length === 0) return { ok: false, error: "no failed accounts to retry" };
    return this.start(failed);
  }

  history(limit = 20): {
    jobs: {
      id: number;
      status: string;
      started_at: number;
      finished_at: number | null;
      total_accounts: number;
      accounts_done: number;
      accounts_failed: number;
      accounts: { account_name: string; status: string; chars_total: number; chars_done: number; chars_failed: number; error: string | null }[];
    }[];
  } {
    const cap = Math.min(Math.max(limit, 1), 100);
    const jobs = this.db
      .prepare("SELECT * FROM scan_jobs ORDER BY id DESC LIMIT ?")
      .all(cap) as { id: number; status: string; started_at: number; finished_at: number | null; total_accounts: number; accounts_done: number; accounts_failed: number }[];
    const acctStmt = this.db.prepare(
      "SELECT account_name, status, chars_total, chars_done, chars_failed, error FROM scan_accounts WHERE job_id = ? ORDER BY account_name",
    );
    return {
      jobs: jobs.map((j) => ({
        ...j,
        accounts: acctStmt.all(j.id) as {
          account_name: string;
          status: string;
          chars_total: number;
          chars_done: number;
          chars_failed: number;
          error: string | null;
        }[],
      })),
    };
  }

  private insertJob(total: number): number {
    return Number(
      this.db
        .prepare("INSERT INTO scan_jobs (status, started_at, total_accounts) VALUES ('running', ?, ?)")
        .run(this.now(), total).lastInsertRowid,
    );
  }

  private snapshot(): ScanJob {
    return this.current as ScanJob;
  }

  private async runJob(): Promise<void> {
    const queue = [...(this.current?.accounts ?? [])];
    const next = async (): Promise<void> => {
      while (queue.length > 0) {
        const acct = queue.shift()!;
        acct.status = "running";
        acct.startedAt = this.now();
        this.emit("scan_update", this.snapshot());
        for (const char of acct.chars) {
          acct.current = char;
          acct.stage = "starting";
          this.emit("scan_update", this.snapshot());
          const res = await this.runner.scanChar(char, (stage) => {
            acct.stage = stage;
            this.emit("scan_update", this.snapshot());
          });
          if (res.result === "done") acct.charsDone += 1;
          else {
            acct.charsFailed += 1;
            acct.error = acct.error ?? `${char}: ${res.error ?? res.result}`;
          }
          acct.current = null;
          acct.stage = null;
        }
        acct.status = acct.charsFailed === 0 ? "done" : acct.charsDone === 0 ? "failed" : "partial";
        acct.finishedAt = this.now();
        this.persistAccount(acct);
        this.emit("scan_update", this.snapshot());
      }
    };
    const workers = Array.from({ length: Math.min(this.maxConcurrent, queue.length) }, () => next());
    await Promise.all(workers);
  }

  private persistAccount(acct: ScanAccountState): void {
    const jobId = this.current!.id;
    this.db
      .prepare(
        `INSERT INTO scan_accounts (job_id, account_name, status, chars_total, chars_done, chars_failed, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(jobId, acct.account, acct.status, acct.chars.length, acct.charsDone, acct.charsFailed, acct.error, acct.startedAt, acct.finishedAt);
  }

  private finalizeJob(): void {
    const job = this.current;
    if (!job) return;
    const failed = job.accounts.filter((a) => a.status === "failed").length;
    const partial = job.accounts.filter((a) => a.status === "partial").length;
    const status: JobStatus = failed === job.accounts.length ? "failed" : failed + partial > 0 ? "partial" : "done";
    job.status = status;
    job.finishedAt = this.now();
    this.db
      .prepare("UPDATE scan_jobs SET status = ?, finished_at = ?, accounts_done = ?, accounts_failed = ? WHERE id = ?")
      .run(status, job.finishedAt, job.accounts.filter((a) => a.status === "done").length, failed + partial, job.id);
    this.emit("scan_update", this.snapshot());
    if (status !== "done") {
      const failedNames = job.accounts.filter((a) => a.status !== "done").map((a) => a.account);
      this.emit("scan_alert", { jobId: job.id, failedAccounts: failedNames, message: `${failedNames.length} account(s) failed` });
      this.log(status === "failed" ? "scan_failed" : "scan_partial", null, `scan job ${job.id}: ${failedNames.join(", ")}`, "scan");
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/modules/scans/store.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/modules/scans/store.ts backend/tests/modules/scans/store.test.ts
git commit -m "feat(scans): ScansStore job model, 5-worker pool, persistence, retry"
```

---

### Task 4: `modules/scans/index.ts` — routes + WS events

The HTTP surface for the Scans page: schedule (relocated), scan start/status/history/retry/targets. Also registers the `scan_update`/`scan_alert` event types in the WS bridge.

**Files:**
- Create: `backend/src/modules/scans/index.ts`
- Modify: `backend/src/core/ws-bridge.ts` (add two event types)
- Test: `backend/tests/modules/scans/routes.test.ts`

**Interfaces:**
- Consumes: `ScansStore` (Task 3).
- Produces: `createScansModule(store, options)` returning a `Module`; `options.exec` is the injectable schedule command runner (same pattern the old inventory scheduler used).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/modules/scans/routes.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createScansModule } from "../../../src/modules/scans/index.js";
import { ScansStore } from "../../../src/modules/scans/store.js";

const H = { Authorization: "Bearer tok" };
const dir = mkdtempSync(join(tmpdir(), "gsiv-scans-routes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeApp(tokensEnv: string, exec: (cmd: string) => string = () => "") {
  const db = new CoreDb(":memory:");
  // a fake char scanner that always succeeds
  const runner = {
    async scanChar(char: string) {
      return { char, result: "done" as const };
    },
  };
  const yamlPath = join(dir, "entry.yaml");
  writeFileSync(yamlPath, "accounts: {}
"); // valid empty roster
  const yaml = new EntryYaml(yamlPath);
  const store = new ScansStore(db, yaml, runner, () => {}, () => {}, { okAccounts: () => [] });
  const registry = new Registry();
  registry.register(healthModule);
  registry.register(createScansModule(store, { exec }));
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv(tokensEnv);
  return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
}

describe("scans module routes", () => {
  it("GET /time returns UTC server time", async () => {
    const app = makeApp("limited:tok:scans.read");
    const res = await app.request("/api/modules/scans/time", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: string; tz: string };
    expect(body.tz).toBe("UTC");
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
  });

  it("GET /schedule reads timer state via exec", async () => {
    const exec = (cmd: string) => {
      if (cmd.includes("is-active")) return "active";
      if (cmd.includes("cat /etc/systemd/system/gsiv-invdb-scan.timer")) return "[Timer]\nOnCalendar=*-*-* 03:15:00\n";
      return "";
    };
    const app = makeApp("limited:tok:scans.read", exec);
    const res = await app.request("/api/modules/scans/schedule", { headers: H });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, time: "03:15" });
  });

  it("requires scans.write for POST /scan (403)", async () => {
    const app = makeApp("limited:tok:scans.read");
    const res = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("POST /scan with no targets returns 409 (clear error, not a crash)", async () => {
    // no auth-ok accounts -> no targets -> a clear error, not a crash
    const app = makeApp("limited:tok:scans.write");
    const res = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("no scan targets");
  });

  it("exposes scans routes in the OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: H });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/scans/scan"]).toBeDefined();
    expect(spec.paths["/api/modules/scans/scan/status"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/scans/routes.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/scans/index.js'`

- [ ] **Step 3: Write the module**

Create `backend/src/modules/scans/index.ts`:

```ts
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { ScansStore } from "./store.js";

const scheduleSchema = z.object({
  enabled: z.boolean(),
  time: z.string().nullable(),
  next_run: z.string().nullable(),
  error: z.string().nullable(),
});

const accountSchema = z.object({
  account: z.string(),
  chars: z.array(z.string()),
  status: z.string(),
  charsDone: z.number(),
  charsFailed: z.number(),
  current: z.string().nullable(),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});

const jobSchema = z.object({
  id: z.number(),
  status: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  accounts: z.array(accountSchema),
});

const timeRoute = createRoute({
  method: "get",
  path: "/time",
  responses: { 200: { content: { "application/json": { schema: z.object({ now: z.string(), tz: z.string() }) } }, description: "server time" } },
});

const scheduleRoute = createRoute({
  method: "get",
  path: "/schedule",
  responses: { 200: { content: { "application/json": { schema: scheduleSchema } }, description: "schedule state" } },
});

const setScheduleRoute = createRoute({
  method: "put",
  path: "/schedule",
  request: { body: { content: { "application/json": { schema: z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: scheduleSchema } }, description: "updated" },
    400: { description: "time must be HH:MM (server/UTC)" },
    500: { content: { "application/json": { schema: scheduleSchema } }, description: "failed" },
  },
});

const scanRoute = createRoute({
  method: "post",
  path: "/scan",
  request: { body: { content: { "application/json": { schema: z.object({ accounts: z.array(z.string()).optional() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), jobId: z.number(), totalAccounts: z.number() }) } }, description: "scan started" },
    409: { description: "scan already running" },
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/scan/status",
  responses: { 200: { content: { "application/json": { schema: z.object({ running: z.boolean(), job: jobSchema.nullable() }) } }, description: "current job" } },
});

const historyRoute = createRoute({
  method: "get",
  path: "/scan/history",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            jobs: z.array(
              z.object({
                id: z.number(),
                status: z.string(),
                started_at: z.number(),
                finished_at: z.number().nullable(),
                total_accounts: z.number(),
                accounts_done: z.number(),
                accounts_failed: z.number(),
                accounts: z.array(
                  z.object({
                    account_name: z.string(),
                    status: z.string(),
     
                    chars_total: z.number(),
                    chars_done: z.number(),
                    chars_failed: z.number(),
                    error: z.string().nullable(),
                  }),
                ),
              }),
            ),
          }),
        },
      },
      description: "job history",
    },
  },
});

const retryRoute = createRoute({
  method: "post",
  path: "/scan/:jobId/retry",
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), jobId: z.number(), totalAccounts: z.number() }) } }, description: "retry started" },
    409: { description: "scan already running" },
  },
});

const targetsRoute = createRoute({
  method: "get",
  path: "/scan/targets",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(z.object({ account: z.string(), chars: z.array(z.string()) })),
        },
      },
      description: "available scan targets",
    },
  },
});

type RunFn = (cmd: string) => string;

const TIMER_UNIT = "gsiv-invdb-scan";
const TIMER_FILE = `/etc/systemd/system/${TIMER_UNIT}.timer`;
const SERVICE_FILE = `/etc/systemd/system/${TIMER_UNIT}.service`;
const SERVICE_BODY = `[Unit]
Description=GSIV invdb scan (oneshot)
After=network-online.target gsiv-platform.service
Wants=gsiv-platform.service

[Service]
Type=oneshot
User=ubuntu
EnvironmentFile=/etc/gsiv-scan.env
ExecStart=/opt/gsiv-platform/scripts/gsiv-scan.sh
`;
const timerBody = (t: string): string => `[Unit]
Description=GSIV invdb scan (daily ${t} UTC)

[Timer]
OnCalendar=*-*-* ${t}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

function scheduleState(exec: RunFn) {
  const fail = (enabled = false, error: string | null = null) => ({ enabled, time: null, next_run: null, error });
  try {
    const active = exec(`systemctl is-active ${TIMER_UNIT}.timer`) === "active";
    let time: string | null = null;
    try {
      const body = exec(`cat ${TIMER_FILE}`);
      const m = body.match(/OnCalendar=\S+ (\d{2}):(\d{2})/);
      time = m ? `${m[1]}:${m[2]}` : null;
    } catch {
      time = null;
    }
    let next_run: string | null = null;
    try {
      next_run = exec(`systemctl show ${TIMER_UNIT}.timer -p NextElapseOnRealTime --value`) || null;
    } catch {
      next_run = null;
    }
    return { enabled: active, time, next_run, error: null };
  } catch (e) {
    return fail(false, (e as Error).message);
  }
}

export interface ScansModuleOptions {
  exec?: RunFn;
}

export function createScansModule(store: ScansStore, options: ScansModuleOptions = {}): Module {
  const exec: RunFn = options.exec ?? ((cmd) => execSync(cmd, { encoding: "utf8", timeout: 20000 }).trim());
  return {
    name: "scans",
    prefix: "/api/modules/scans",
    scopes: [
      { name: "scans.read", description: "Read scan schedule, status, history, targets" },
      { name: "scans.write", description: "Start/retry scans and manage the schedule" },
    ],
    nav: { path: "/scans", title: "Scans", group: "operations", order: 30, icon: "📡" },
    routeScopes: {
      "GET /time": ["scans.read"],
      "GET /schedule": ["scans.read"],
      "PUT /schedule": ["scans.write"],
      "POST /scan": ["scans.write"],
      "GET /scan/status": ["scans.read"],
      "GET /scan/history": ["scans.read"],
      "POST /scan/:jobId/retry": ["scans.write"],
      "GET /scan/targets": ["scans.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(timeRoute, (c) => c.json({ now: new Date().toISOString(), tz: "UTC" }));
      router.openapi(scheduleRoute, (c) => c.json(scheduleState(exec)));
      router.openapi(setScheduleRoute, (c) => {
        const { time } = c.req.valid("json");
        try {
          writeFileSync(`/tmp/${TIMER_UNIT}.timer`, timerBody(time));
          exec(`sudo cp /tmp/${TIMER_UNIT}.timer ${TIMER_FILE}`);
          writeFileSync(`/tmp/${TIMER_UNIT}.service`, SERVICE_BODY);
          exec(`sudo cp /tmp/${TIMER_UNIT}.service ${SERVICE_FILE}`);
          exec("sudo systemctl daemon-reload");
          try {
            exec(`sudo systemctl stop ${TIMER_UNIT}.timer`);
          } catch {
            /* not running yet */
          }
          exec(`sudo systemctl enable --now ${TIMER_UNIT}.timer`);
          return c.json(scheduleState(exec));
        } catch (e) {
          return c.json({ enabled: false, time: null, next_run: null, error: (e as Error).message }, 500);
        }
      });
      router.openapi(scanRoute, (c) => {
        const { accounts } = c.req.valid("json");
        const res = store.start(accounts);
        if (!res.ok) return c.json({ error: res.error }, 409);
        return c.json({ ok: true, jobId: res.jobId ?? 0, totalAccounts: res.totalAccounts ?? 0 }, 200);
      });
      router.openapi(statusRoute, (c) => c.json({ running: store.scanRunning(), job: store.currentJob() }));
      router.openapi(historyRoute, (c) => c.json(store.history()));
      router.openapi(retryRoute, (c) => {
        const jobId = Number(c.req.valid("param").jobId);
        if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "invalid jobId" }, 400);
        const res = store.retry(jobId);
        if (!res.ok) return c.json({ error: res.error }, 409);
        return c.json({ ok: true, jobId: res.jobId ?? 0, totalAccounts: res.totalAccounts ?? 0 }, 200);
      });
      router.openapi(targetsRoute, (c) => c.json(store.targets()));
    },
  };
}
```

- [ ] **Step 4: Add the WS event types**

In `backend/src/core/ws-bridge.ts`, change the `EVENT_TYPES` const to:

```ts
const EVENT_TYPES = [
  "jars_update",
  "jars_claimed",
  "queue_update",
  "healer_update",
  "heal_request",
  "heal_accepted",
  "heal_complete",
  "sale_update",
  "scan_update",
  "scan_alert",
] as const;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/modules/scans/routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/modules/scans/index.ts backend/src/core/ws-bridge.ts backend/tests/modules/scans/routes.test.ts
git commit -m "feat(scans): HTTP routes + scan_update/scan_alert WS events"
```

---

### Task 5: Wire `scans` into `index.ts` + remove the old inventory scheduler

Register the scans module with its real capabilities (Systemd + InvDb + LichStore), and delete the scheduler routes from the inventory module.

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/modules/inventory/index.ts`
- Modify: `backend/src/modules/inventory/store.ts` (one notice string)
- Modify: `backend/tests/modules/inventory/routes.test.ts` (drop the scheduler describe block)
- Regenerate: `frontend/src/generated/modules.json` (`cd backend && npm run gen:manifest`)

**Interfaces:**
- Consumes: `createScansModule`, `ScansStore` (Task 4), `ScanRunner` (Task 2).
- Produces: the registered `scans` module (nav `/scans`), `inventory.write` scope removed.

- [ ] **Step 1: Wire the module in index.ts**

Add two imports to `backend/src/index.ts` (alphabetical, next to the other module imports):

```ts
import { ScanRunner } from "./core/scan-runner.js";
import { createScansModule } from "./modules/scans/index.js";
import { ScansStore } from "./modules/scans/store.js";
```

Hoist the EventBus so the ScansStore can emit during a scan. Immediately after `const kv = await createKV();` insert:

```ts
const eventBus = new EventBus();
```

and delete the later line `const eventBus = new EventBus();` (just above `const app = createApp(...)`).

Then, immediately after the accounts registration block (`registry.register(createAccountsModule(accountsStore, totp));`), insert:

```ts
// Scans: invdb scan orchestrator (5 concurrent accounts) via review-gated capabilities.
const scanRunner = new ScanRunner({
  systemd: new Systemd(),
  invDb: new InvDb(),
  sendScript: async (char, script) => {
    await lichStore.pushCommand(char, "scan", script);
  },
  isOnline: async (char) => {
    const state = await lichStore.status(char);
    return lichStore.isOnline(state);
  },
});
const scansStore = new ScansStore(
  db,
  new EntryYaml(),
  scanRunner,
  (type, payload) => eventBus.emit(type, payload),
  (type, char, detail, source) => eventLog.log(type, char, detail, source),
  {
    skipAccounts: (process.env.SCAN_SKIP_ACCOUNTS ?? "UNFOCUSEDPIE")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
);
registry.register(createScansModule(scansStore));
```

- [ ] **Step 2: Remove the scheduler routes from inventory/index.ts**

Delete from `backend/src/modules/inventory/index.ts`:

1. The `import { execSync } from "node:child_process";` line.
2. The `import { readdirSync, readFileSync, writeFileSync } from "node:fs";` line.
3. The `import { join } from "node:path";` line.
4. The route consts `time`, `schedule`, `setSchedule`, `scanStart`, `scanStatus` (the block starting `time: createRoute({` through the `scanStatus` route).
5. The `type RunFn = (cmd: string) => string;` line and everything through the end of `scheduleState(...)` — i.e. `TIMER_UNIT`, `TIMER_FILE`, `SERVICE_FILE`, `SCAN_SCRIPT`, `SCAN_LOGS_DIR`, `SERVICE_BODY`, `timerBody`, the `InventoryModuleOptions` interface, and the `scheduleState` function.
6. The `registerRoutes` handlers for `routes.time`, `routes.schedule`, `routes.setSchedule`, `routes.scanStart`, `routes.scanStatus`.
7. Change the module factory signature `createInventoryModule(store: InventoryStore, options: InventoryModuleOptions = {}): Module` → `createInventoryModule(store: InventoryStore): Module`, and delete the two lines inside it that build `exec` and `logsDir`.
8. In `scopes`, remove the `inventory.write` entry and update the `inventory.read` description to drop "scan status".
9. In `routeScopes`, remove `"GET /time"`, `"GET /schedule"`, `"PUT /schedule"`, `"POST /scan/start"`, `"GET /scan/status"`.

After these edits, `inventory` keeps only: `summary`, `characters`, `locations`, `bank`, `search`, `resources`, `tickets`, `lumnis`, `overview`.

- [ ] **Step 3: Update the overview notice copy**

In `backend/src/modules/inventory/store.ts`, change:

```ts
message: "No scan data yet - run a scan (Inventory > Run scan now) or wait for the daily scan.",
```

to:

```ts
message: "No scan data yet - run a scan (Scans > Scan now) or wait for the daily scan.",
```

- [ ] **Step 4: Remove the scheduler route tests**

In `backend/tests/modules/inventory/routes.test.ts`, delete the entire `describe("inventory scheduler routes", ...)` block (it tests the now-removed `/time`, `/schedule`, `/scan/start`, `/scan/status` routes). The first `describe` (summary/search/bank/etc.) and the `describe("inventory overview route", ...)` block stay.

- [ ] **Step 5: Regenerate the manifest**

Run: `cd backend && npm run gen:manifest`
Expected: `frontend/src/generated/modules.json` now contains a `navItems` entry `{ "id": "scans", "path": "/scans", ... }` and `scopes` no longer lists `inventory.write`.

- [ ] **Step 6: Run the backend gate**

Run: `cd backend && npm test && npm run typecheck && npm run lint`
Expected: all green (the scans store + routes tests pass; inventory scheduler tests gone; no unused-scope registry error).

- [ ] **Step 7: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/index.ts backend/src/modules/inventory/index.ts backend/src/modules/inventory/store.ts backend/tests/modules/inventory/routes.test.ts frontend/src/generated/modules.json
git commit -m "feat(scans): register orchestrator module; remove inventory scheduler"
```

---

### Task 6: Frontend `/scans` page + nav + alerting + remove InventoryScheduler

**Files:**
- Create: `frontend/src/pages/scans/index.tsx`
- Create: `frontend/src/shell/ScanAlerts.tsx`
- Modify: `frontend/src/core/manifest.ts` (add `scans` loader + component)
- Modify: `frontend/src/shell/AppShell.tsx` (mount `ScanAlerts`)
- Modify: `frontend/src/styles.css` (add a pulse keyframe)
- Modify: `frontend/src/pages/inventory/index.tsx` (drop the scheduler card)
- Delete: `frontend/src/pages/inventory/Scheduler.tsx`

**Interfaces:**
- Consumes: `/api/modules/scans/{time,schedule,scan,scan/status,scan/history,scan/targets}` (Task 4); `useWsEvents`, `api`, `can` (core).
- Produces: the `/scans` page and a global `scan_alert` toast.

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/scans/index.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Input, useToast } from "../../components";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";

interface ScanAccountState {
  account: string;
  chars: string[];
  status: string;
  charsDone: number;
  charsFailed: number;
  current: string | null;
  stage: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
interface ScanJob {
  id: number;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  accounts: ScanAccountState[];
}
interface ScanStatus {
  running: boolean;
  job: ScanJob | null;
}
interface HistoryAccount {
  account_name: string;
  status: string;
  chars_total: number;
  chars_done: number;
  chars_failed: number;
  error: string | null;
}
interface HistoryJob {
  id: number;
  status: string;
  started_at: number;
  finished_at: number | null;
  total_accounts: number;
  accounts_done: number;
  accounts_failed: number;
  accounts: HistoryAccount[];
}
interface Target {
  account: string;
  chars: string[];
}
interface ScheduleState {
  enabled: boolean;
  time: string | null;
  next_run: string | null;
  error: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  starting: "starting",
  waiting_online: "waiting online",
  scanning: "scanning",
  tickets: "tickets",
  done: "done",
  failed: "failed",
  timeout: "timed out",
};

export default function Scans({ auth }: { auth: AuthState }) {
  const [status, setStatus] = useState<ScanStatus>({ running: false, job: null });
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [sched, setSched] = useState<ScheduleState | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [schedTime, setSchedTime] = useState("");
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();
  const canWrite = can(auth, ["scans.write"]);

  async function refreshStatus() {
    try {
      setStatus(await api<ScanStatus>("/modules/scans/scan/status", auth));
    } catch {
      /* degrade silently; the page still renders history */
    }
  }
  async function refreshAll() {
    try {
      const [st, h, t, sc, tm] = await Promise.all([
        api<ScanStatus>("/modules/scans/scan/status", auth),
        api<{ jobs: HistoryJob[] }>("/modules/scans/scan/history", auth),
        api<Target[]>("/modules/scans/scan/targets", auth),
        api<ScheduleState>("/modules/scans/schedule", auth),
        api<{ now: string }>("/modules/scans/time", auth),
      ]);
      setStatus(st);
      setHistory(h.jobs);
      setTargets(t);
      setSched(sc);
      setServerNow(new Date(tm.now));
    } catch (err) {
      addToast({ tone: "bad", title: "Scans unavailable", message: (err as Error).message });
    }
  }

  useEffect(() => {
    if (!can(auth, ["scans.read"])) return;
    void refreshAll();
    const timer = setInterval(() => setServerNow((d) => (d ? new Date(d.getTime() + 1000) : d)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useWsEvents(["scan_update"], () => void refreshStatus());

  async function scanNow() {
    setBusy(true);
    try {
      const body = selected.size > 0 ? { accounts: [...selected] } : {};
      const res = await api<{ ok: boolean; jobId: number; totalAccounts: number }>("/modules/scans/scan", auth, {
        method: "POST",
        body: JSON.stringify(body),
      });
      addToast({ tone: "good", title: "Scan started", message: `${res.totalAccounts} account(s) queued.` });
      void refreshStatus();
    } catch (err) {
      addToast({ tone: "bad", title: "Scan start failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId: number) {
    setBusy(true);
    try {
      await api("/modules/scans/scan/" + jobId + "/retry", auth, { method: "POST", body: "{}" });
      addToast({ tone: "good", title: "Retry started", message: "Failed accounts re-queued." });
      void refreshStatus();
    } catch (err) {
      addToast({ tone: "bad", title: "Retry failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function setSchedule(time: string) {
    setBusy(true);
    try {
      await api("/modules/scans/schedule", auth, { method: "PUT", body: JSON.stringify({ time }) });
      setSched(await api<ScheduleState>("/modules/scans/schedule", auth));
      addToast({ tone: "good", title: "Schedule set", message: `Daily scan at ${time} UTC.` });
    } catch (err) {
      addToast({ tone: "bad", title: "Set schedule failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const job = status.job;
  const running = job?.accounts.filter((a) => a.status === "running") ?? [];
  const queued = job?.accounts.filter((a) => a.status === "queued") ?? [];
  const clock = serverNow ? serverNow.toISOString().slice(11, 19) : "--:--:--";

  return (
    <div>
      <header className="page-header">
        <h1 className="page-header-title">Scans</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          InvDB collection orchestrator — {job?.accounts.length ?? 0} account(s), 5 at a time.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <div className="card" style={{ flex: "1 1 260px" }}>
          <div className="card-title">Schedule</div>
          <div className="muted">Server clock (UTC)</div>
          <div style={{ fontSize: "var(--font-size-xl)", fontVariantNumeric: "tabular-nums" }}>{clock}</div>
          <div className="muted" style={{ marginTop: "var(--space-2)" }}>
            {sched
              ? sched.enabled
                ? `Daily at ${sched.time} UTC` + (sched.next_run ? ` · next ${sched.next_run}` : "")
                : "No schedule set"
              : "…"}
          </div>
          {canWrite && (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginTop: "var(--space-2)" }}>
              <Input
                id="schedTime"
                placeholder="03:00"
                value={schedTime}
                onChange={setSchedTime}
                style={{ maxWidth: 90 }}
                label="Daily time (UTC)"
              />
              <Button size="sm" disabled={!/^\d{2}:\d{2}$/.test(schedTime) || busy} onClick={() => void setSchedule(schedTime)} ariaLabel="Set scan schedule">
                Set
              </Button>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: "1 1 340px" }}>
          <div className="card-title">Run a scan</div>
          {targets.length > 0 && (
            <div style={{ marginBottom: "var(--space-2)", maxHeight: 180, overflowY: "auto" }}>
              {targets.map((t) => (
                <label key={t.account} style={{ display: "block", fontSize: "var(--font-size-sm)"
                }}>
                  {t.account} <span className="muted">({t.chars.length} chars)</span>
                </label>
              ))}
            </div>
          )}
          {canWrite ? (
            <Button onClick={scanNow} loading={busy} disabled={status.running} ariaLabel="Run invdb scan now">
              {status.running ? "Scan running…" : selected.size > 0 ? `Scan ${selected.size} account(s)` : "Scan all accounts"}
            </Button>
          ) : (
            <span className="muted">read-only token</span>
          )}
        </div>
      </div>

      {job && (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <div className="card-title">{status.running ? "Scan in progress" : `Last scan — ${job.status}`}</div>
          {[...running, ...queued].map((a) => {
            const pct = a.chars.length === 0 ? 0 : Math.round((a.charsDone / a.chars.length) * 100);
            return (
              <div key={a.account} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{a.account}</strong>
                  <span className="muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    {a.charsDone}/{a.chars.length} chars · {a.status}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, margin: "var(--space-1) 0", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width 0.3s" }} />
                </div>
                {a.current && (
                  <div className="muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    <span className="scan-pulse">●</span> {a.current} — {STAGE_LABEL[a.stage ?? ""] ?? a.stage}
                  </div>
                )}
                {a.error && <div className="muted" style={{ fontSize: "var(--font-size-sm)", color: "var(--bad)" }}>{a.error}</div>}
              </div>
            );
          })}
          {job.accounts.filter((a) => a.status === "failed" || a.status === "partial").length > 0 && !status.running && canWrite && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <Button size="sm" onClick={() => void retry(job.id)} loading={busy} ariaLabel="Retry failed accounts">
                Retry failed accounts
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">History</div>
        {history.length === 0 ? (
          <div className="muted">No scans yet.</div>
        ) : (
          history.slice(0, 10).map((h) => (
            <div key={h.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}>
              <strong>#{h.id}</strong> {h.status} · {h.accounts_done} ok / {h.accounts_failed} failed ·{" "}
              {new Date(h.started_at).toISOString().slice(0, 16)}Z
              {h.accounts_failed > 0 && canWrite && (
                <Button size="sm" variant="ghost" style={{ marginLeft: "var(--space-2)" }} onClick={() => void retry(h.id)} ariaLabel={`Retry job ${h.id}`}>
                  retry
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav loader**

In `frontend/src/core/manifest.ts`, add to the `LOADERS` map:

```ts
  scans: () => import("../pages/scans"),
```

and to `NAV_COMPONENTS`:

```ts
  scans: lazy(LOADERS.scans),
```

- [ ] **Step 3: Add the pulse keyframe**

Append to `frontend/src/styles.css`:

```css
@keyframes scan-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.scan-pulse { animation: scan-pulse 1.1s ease-in-out infinite; }
```

- [ ] **Step 4: Global scan_alert toast**

Create `frontend/src/shell/ScanAlerts.tsx`:

```tsx
import { useEffect } from "react";
import { useToast } from "../components";
import { can, type AuthState } from "../core/auth";
import { onWs } from "../core/ws";

/** Global (any-page) toast when a scan finishes with failures. */
export function ScanAlerts({ auth }: { auth: AuthState }) {
  const { addToast } = useToast();
  useEffect(() => {
    if (!can(auth, ["scans.read"])) return;
    return onWs((e) => {
      if (e.type !== "scan_alert") return;
      const p = e.payload as { failedAccounts?: string[]; message?: string };
      addToast({ tone: "bad", title: "⚠ Scan problem", message: p.message ?? "a scan failed" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);
  return null;
}
```

Mount it in `frontend/src/shell/AppShell.tsx` — add `import { ScanAlerts } from "./ScanAlerts";` and render `<ScanAlerts auth={auth} />` next to `<Bell auth={auth} />` in the topbar.

- [ ] **Step 5: Remove the scheduler from the Inventory page**

In `frontend/src/pages/inventory/index.tsx`: delete `import { InventoryScheduler } from "./Scheduler";` and delete the `<InventoryScheduler auth={auth} />` line. Then delete the file `frontend/src/pages/inventory/Scheduler.tsx`.

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: PASS (the `scans` nav item resolves to the new page; no unresolved loader).

- [ ] **Step 7: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add frontend/src/pages/scans/index.tsx frontend/src/shell/ScanAlerts.tsx frontend/src/core/manifest.ts frontend/src/shell/AppShell.tsx frontend/src/styles.css frontend/src/pages/inventory/index.tsx
git rm frontend/src/pages/inventory/Scheduler.tsx
git commit -m "feat(scans): /scans page with live animated progress + scan_alert toast"
```

---

### Task 7: Deploy + live smoke

Deploy to the server and verify a real scan on Fisternar/Neleourg (Amn off-limits).

**Files (server-side, not in git):**
- `/opt/gsiv-platform/scripts/gsiv-scan.sh`, `/etc/gsiv-scan.env` (0600)
- `/etc/systemd/system/gsiv-invdb-scan.service`
- `/opt/gsiv-platform/backend/.env` (machine token scopes)

- [ ] **Step 1: Add scan scopes to the machine token**

On the server, edit `/opt/gsiv-platform/backend/.env` — append `,scans.read,scans.write` to the machine token's scope list. The machine token line ends with `...,accounts.read,accounts.write`; make it `...,accounts.read,accounts.write,scans.read,scans.write`. (Keep the admin token unchanged.)

- [ ] **Step 2: Install the timer wrapper + env**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@51.68.235.144
sudo tee /opt/gsiv-platform/scripts/gsiv-scan.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Daily: invdb scan orchestrator (full re-scan of auth-ok accounts).
set -euo pipefail
TOKEN="${GS4SD_TOKEN:?GS4SD_TOKEN (machine token) is required}"
BASE="${GSIV_API:-http://localhost:3102}"
curl -fsS -X POST "$BASE/api/modules/scans/scan" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
EOF
sudo chmod +x /opt/gsiv-platform/scripts/gsiv-scan.sh
echo "GS4SD_TOKEN=abdb3594-b6dd-4eef-89de-b083197f6798" | sudo tee /etc/gsiv-scan.env >/dev/null
sudo chmod 600 /etc/gsiv-scan.env
```

- [ ] **Step 3: Update the oneshot service**

```bash
sudo tee /etc/systemd/system/gsiv-invdb-scan.service >/dev/null <<'EOF'
[Unit]
Description=GSIV invdb scan (oneshot)
After=network-online.target gsiv-platform.service
Wants=gsiv-platform.service

[Service]
Type=oneshot
User=ubuntu
EnvironmentFile=/etc/gsiv-scan.env
ExecStart=/opt/gsiv-platform/scripts/gsiv-scan.sh
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now gsiv-invdb-scan.timer
```

- [ ] **Step 4: Rebuild + redeploy backend and frontend**

Follow `deploy/V2-DEPLOYMENT.md` (backend `dist/` → `/opt/gsiv-platform/backend`, `sudo systemctl restart gsiv-platform.service`; frontend `dist/` **contents** → `/opt/gsiv-platform/frontend`, the Caddy root — never `dist/` itself). Then confirm the public bundle is served as `text/javascript` (Cloudflare cache-poisoning gotcha: hard refresh / incognito).

- [ ] **Step 5: Verify the machine token has the new scopes**

```bash
curl -s -H "Authorization: Bearer abdb3594-b6dd-4eef-89de-b083197f6798" http://localhost:3102/api/me
```
Expected: `scopes` includes `scans.read` and `scans.write`.

- [ ] **Step 6: Live smoke on Fisternar (BUCKWHEET account)**

```bash
# list targets (should include BUCKWHEET with Fisternar + Zepherus)
curl -s -H "Authorization: Bearer <admin>" http://localhost:3102/api/modules/scans/scan/targets

# start a single-account scan
curl -s -X POST -H "Authorization: Bearer <admin>" -H "Content-Type: application/json" \
  -d '{"accounts":["BUCKWHEET"]}' http://localhost:3102/api/modules/scans/scan

# watch progress (per-account + per-char stages)
watch -n2 'curl -s -H "Authorization: Bearer <admin>" http://localhost:3102/api/modules/scans/scan/status'
```
Expected: the job runs; Fisternar goes `starting → waiting_online → scanning → tickets → done`; the job ends `done`; `GET /scan/history` shows the job with per-account status. Then repeat for ALT (Neleourg).

- [ ] **Step 7: Confirm the timer triggers the orchestrator (force-run)**

```bash
sudo systemctl start gsiv-invdb-scan.service
sleep 3
curl -s -H "Authorization: Bearer <admin>" http://localhost:3102/api/modules/scans/scan/status
```
Expected: a new job is running (the timer service `curl`-ed `POST /scan`).

- [ ] **Step 8: Final gate + commit any deploy notes**

Run: `cd backend && npm test && npm run typecheck && npm run lint` and `cd frontend && npm run build` (confirm green), then update `docs/STATUS.md` §7 and open the PR:

```bash
cd "D:/Code Projects/GSIVPlatform"
gh pr create --base main --title "Scan orchestrator + scheduler UX redesign" --body "Backend TS scan orchestrator (5 concurrent accounts, full re-scan, manual retry) + live /scans page with scan_alert alerting."
```
