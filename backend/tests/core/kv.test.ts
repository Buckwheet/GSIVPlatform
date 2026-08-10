import { describe, expect, it } from "vitest";
import { InMemoryKV } from "../../src/core/kv.js";

describe("InMemoryKV", () => {
  it("set/get/del roundtrip", async () => {
    const kv = new InMemoryKV();
    await kv.set("a", "1");
    expect(await kv.get("a")).toBe("1");
    await kv.del("a");
    expect(await kv.get("a")).toBeNull();
  });

  it("expires keys by TTL", async () => {
    const kv = new InMemoryKV();
    await kv.set("a", "1", 20);
    expect(await kv.get("a")).toBe("1");
    await new Promise((r) => setTimeout(r, 40));
    expect(await kv.get("a")).toBeNull();
  });

  it("incr is atomic-ish and starts at 1", async () => {
    const kv = new InMemoryKV();
    expect(await kv.incr("n")).toBe(1);
    expect(await kv.incr("n")).toBe(2);
  });

  it("keys(pattern) glob matching", async () => {
    const kv = new InMemoryKV();
    await kv.set("rl:u:1", "x");
    await kv.set("rl:u:2", "y");
    await kv.set("other", "z");
    const keys = await kv.keys("rl:*");
    expect(keys.sort()).toEqual(["rl:u:1", "rl:u:2"]);
  });
});
