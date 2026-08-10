import { describe, expect, it } from "vitest";
import { InMemoryKV } from "../../../src/core/kv.js";
import { GemsStore } from "../../../src/modules/gems/store.js";

describe("GemsStore", () => {
  function makeStore() {
    return new GemsStore(new InMemoryKV());
  }

  it("setJar stores a status with a timestamp and getJar round-trips it", async () => {
    const store = makeStore();
    const saved = await store.setJar("Fisternar", {
      full_jars: [
        { id: 123, type: "uncut emeralds", portions: 10 },
        { id: 456, type: "uncut rubies", portions: 8 },
      ],
      full_jar_count: 2,
    });
    expect(saved.character).toBe("fisternar");
    expect(saved.full_jar_count).toBe(2);
    expect(saved.ts).toBeGreaterThan(0);
    const got = await store.getJar("Fisternar");
    expect(got.full_jars).toHaveLength(2);
    expect(got.full_jars[0]).toEqual({ id: 123, type: "uncut emeralds", portions: 10 });
    expect(got.character).toBe("fisternar");
  });

  it("getJar returns an empty default when no jar data exists", async () => {
    const store = makeStore();
    const got = await store.getJar("Nobody");
    expect(got).toEqual({ character: "nobody", full_jars: [], full_jar_count: 0, ts: 0 });
  });

  it("getJars lists all jar statuses sorted by character", async () => {
    const store = makeStore();
    await store.setJar("zeta", { full_jars: [], full_jar_count: 0 });
    await store.setJar("alpha", { full_jars: [], full_jar_count: 1 });
    const jars = await store.getJars();
    expect(jars.map((j) => j.character)).toEqual(["alpha", "zeta"]);
  });

  it("claimJar sets responder and claimed_at", async () => {
    const store = makeStore();
    await store.setJar("Fisternar", { full_jars: [], full_jar_count: 1 });
    const claimed = await store.claimJar("fisternar", "Neleourg");
    expect(claimed).not.toBeNull();
    expect(claimed?.responder).toBe("neleourg");
    expect(claimed?.claimed_at).toBeGreaterThan(0);
  });

  it("claimJar returns null when the holder has no jar data", async () => {
    const store = makeStore();
    expect(await store.claimJar("ghost", "Neleourg")).toBeNull();
  });

  it("clearJar removes jar data", async () => {
    const store = makeStore();
    await store.setJar("Fisternar", { full_jars: [], full_jar_count: 2 });
    await store.clearJar("fisternar");
    expect(await store.getJar("fisternar")).toEqual({
      character: "fisternar",
      full_jars: [],
      full_jar_count: 0,
      ts: 0,
    });
  });

  it("queueJoin appends in FIFO order and reports 0-based position", async () => {
    const store = makeStore();
    const first = await store.queueJoin("gembank", "Zepherus");
    expect(first).toEqual({ position: 0 });
    const second = await store.queueJoin("gembank", "Arli");
    expect(second).toEqual({ position: 1 });
    expect(await store.queueStatus("gembank")).toEqual(["zepherus", "arli"]);
  });

  it("queueJoin deduplicates an already-queued character", async () => {
    const store = makeStore();
    await store.queueJoin("gembank", "Zepherus");
    const again = await store.queueJoin("gembank", "zepherus");
    expect(again).toEqual({ position: "already_queued" });
    expect(await store.queueStatus("gembank")).toEqual(["zepherus"]);
  });

  it("queueNext returns the first in line, queueDone removes it", async () => {
    const store = makeStore();
    await store.queueJoin("gembank", "Zepherus");
    await store.queueJoin("gembank", "Arli");
    expect(await store.queueNext("gembank")).toBe("zepherus");
    await store.queueDone("gembank", "Zepherus");
    expect(await store.queueStatus("gembank")).toEqual(["arli"]);
    expect(await store.queueNext("gembank")).toBe("arli");
  });

  it("queueNext returns null for an empty queue", async () => {
    const store = makeStore();
    expect(await store.queueNext("healer")).toBeNull();
  });
});
