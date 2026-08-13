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
      const rows = db.get().prepare("SELECT account_name FROM accounts WHERE auth_status = 'ok'").all() as {
        account_name: string;
      }[];
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
      accounts: {
        account_name: string;
        status: string;
        chars_total: number;
        chars_done: number;
        chars_failed: number;
        error: string | null;
      }[];
    }[];
  } {
    const cap = Math.min(Math.max(limit, 1), 100);
    const jobs = this.db.prepare("SELECT * FROM scan_jobs ORDER BY id DESC LIMIT ?").all(cap) as {
      id: number;
      status: string;
      started_at: number;
      finished_at: number | null;
      total_accounts: number;
      accounts_done: number;
      accounts_failed: number;
    }[];
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
        const acct = queue.shift();
        if (!acct) return;
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
    const jobId = this.current?.id;
    if (jobId == null) return;
    this.db
      .prepare(
        `INSERT INTO scan_accounts (job_id, account_name, status, chars_total, chars_done, chars_failed, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        acct.account,
        acct.status,
        acct.chars.length,
        acct.charsDone,
        acct.charsFailed,
        acct.error,
        acct.startedAt,
        acct.finishedAt,
      );
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
      this.emit("scan_alert", {
        jobId: job.id,
        failedAccounts: failedNames,
        message: `${failedNames.length} account(s) failed`,
      });
      this.log(
        status === "failed" ? "scan_failed" : "scan_partial",
        null,
        `scan job ${job.id}: ${failedNames.join(", ")}`,
        "scan",
      );
    }
  }
}
