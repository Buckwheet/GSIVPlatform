import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import type { ScanCharResult, ScanStage } from "../../../src/core/scan-runner.js";
import { type CharFailureClassifier, ScansStore } from "../../../src/modules/scans/store.js";

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
    classifier?: CharFailureClassifier;
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
      classifier: opts.classifier,
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
    const retry = store.retry(store.currentJob()?.id ?? 0);
    expect(retry.ok).toBe(true);
    expect(retry.totalAccounts).toBe(1); // only BUCKWHEET
    await store.whenIdle();
  });

  it("classifies failures once per failed account and surfaces them live + in history", async () => {
    const calls: { account: string; failed: { char: string }[] }[] = [];
    const classifier: CharFailureClassifier = {
      async refreshAndClassify(account, failed) {
        calls.push({ account, failed });
        return failed.map((f) => ({ ...f, code: "char_disabled", reason: "character not active on SGE" }));
      },
    };
    const { store } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" }, classifier });
    store.start();
    await store.whenIdle();
    expect(calls).toHaveLength(1); // once per account, not per char
    expect(calls[0].account).toBe("BUCKWHEET");
    expect(calls[0].failed.map((f) => f.char).sort()).toEqual(["Fisternar", "Zepherus"]);
    const acct = store.currentJob()?.accounts.find((a) => a.account === "BUCKWHEET");
    expect(acct?.failures.map((f) => f.code)).toEqual(["char_disabled", "char_disabled"]);
    const hist = store.history();
    const histAcct = hist.jobs[0].accounts.find((a) => a.account_name === "BUCKWHEET");
    expect(histAcct?.chars.map((c) => c.code)).toEqual(["char_disabled", "char_disabled"]);
  });

  it("falls back to transient without crashing when the classifier throws", async () => {
    const classifier: CharFailureClassifier = {
      async refreshAndClassify() {
        throw new Error("boom");
      },
    };
    const { store } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" }, classifier });
    store.start();
    await store.whenIdle();
    const acct = store.currentJob()?.accounts.find((a) => a.account === "BUCKWHEET");
    expect(acct?.failures.every((f) => f.code === "transient")).toBe(true);
    expect(store.currentJob()?.status).toBe("partial");
  });

  it("persists no scan_chars rows for accounts with zero failures", async () => {
    const { store } = makeStore(); // default runner: all done
    store.start();
    await store.whenIdle();
    const hist = store.history();
    expect(hist.jobs[0].accounts.every((a) => a.chars.length === 0)).toBe(true);
  });
});
