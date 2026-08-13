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
function makeStore(
  opts: {
    results?: Record<string, "done" | "failed">;
    maxConcurrent?: number;
    okAccounts?: string[];
    skipAccounts?: string[];
  } = {},
) {
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
      return results[char] === "failed" ? { char, result: "failed", error: "boom" } : { char, result: "done" };
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
      okAccounts: () => opts.okAccounts ?? ["BUCKWHEET", "ALT"],
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
