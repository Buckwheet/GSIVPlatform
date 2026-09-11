import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { DEFAULT_POLL_MS, startUpdatesPoller } from "../../../src/modules/updates/poller.js";
import { UpdatesStore } from "../../../src/modules/updates/store.js";

describe("startUpdatesPoller", () => {
  let db: CoreDb;

  afterEach(() => {
    db?.close();
    vi.useRealTimers();
  });

  function setup(currentVersion: string, intervalMs?: number) {
    db = new CoreDb(":memory:");
    const store = new UpdatesStore(db, { currentVersion, now: () => new Date("2026-09-11T00:00:00.000Z") });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => [{ tag_name: "v0.3.0-beta.50" }] };
    };
    const logs: string[] = [];
    const stop = startUpdatesPoller(store, {
      repo: "Nisugi/VellumFE",
      fetchImpl,
      intervalMs,
      log: (m) => logs.push(m),
    });
    return { store, stop, logs, calls: () => calls };
  }

  it("checks at boot, re-checks on the interval, and stops cleanly", async () => {
    vi.useFakeTimers();
    const { store, stop, calls } = setup("0.3.0-beta.37", 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1); // boot check, so the bell isn't blind for a whole interval
    expect(store.listNotifications().unread).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(2);
  });

  it("logs the check outcome", async () => {
    vi.useFakeTimers();
    const { stop, logs } = setup("0.3.0-beta.37", 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(logs[0]).toContain("v0.3.0-beta.50");
    expect(logs[0]).toContain("filed v0.3.0-beta.50");
    stop();
  });

  it("falls back to the default interval when the configured one is unusable", async () => {
    vi.useFakeTimers();
    const { stop, calls } = setup("0.3.0-beta.37", Number.NaN);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000); // no hot loop from a NaN interval
    expect(calls()).toBe(1);
    expect(DEFAULT_POLL_MS).toBe(6 * 60 * 60 * 1000);
    stop();
  });
});
