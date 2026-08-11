import { describe, expect, it } from "vitest";
import { InMemoryKV } from "../../../src/core/kv.js";
import { LichStore, STALE_MS } from "../../../src/modules/lich/store.js";

describe("LichStore", () => {
  function makeStore() {
    return new LichStore(new InMemoryKV());
  }

  it("publish stores state with lowercased character and ts; status round-trips", async () => {
    const store = makeStore();
    const saved = await store.publish("Fisternar", { room_id: 1234, resources: { mana: 100 } });
    expect(saved.character).toBe("fisternar");
    expect(saved.room_id).toBe(1234);
    expect(saved.ts).toBeGreaterThan(0);
    const got = await store.status("Fisternar");
    expect(got?.character).toBe("fisternar");
    expect(got?.room_id).toBe(1234);
    expect(got?.resources).toEqual({ mana: 100 });
  });

  it("status returns null for an unknown character", async () => {
    const store = makeStore();
    expect(await store.status("ghost")).toBeNull();
  });

  it("listStates returns all publisher states", async () => {
    const store = makeStore();
    await store.publish("alpha", { room_id: 1 });
    await store.publish("zeta", { room_id: 2 });
    const states = await store.listStates();
    expect(states.map((s) => s.character).sort()).toEqual(["alpha", "zeta"]);
  });

  it("managed reads the characters module's managed KV list", async () => {
    const kv = new InMemoryKV();
    await kv.set("characters:managed", JSON.stringify(["fisternar", "neleourg"]));
    const store = new LichStore(kv);
    expect(await store.managed()).toEqual(["fisternar", "neleourg"]);
  });

  it("isOnline is true within STALE_MS and false after", async () => {
    const store = makeStore();
    const state = await store.publish("Fisternar", {});
    expect(store.isOnline(state, state.ts + STALE_MS - 1)).toBe(true);
    expect(store.isOnline(state, state.ts + STALE_MS)).toBe(false);
    expect(store.isOnline(null)).toBe(false);
  });

  it("pushCommand queues FIFO; popCommand consumes and empties", async () => {
    const store = makeStore();
    const first = await store.pushCommand("fisternar", "admin", ";invdb");
    expect(first.cmdType).toBe("script");
    await store.pushCommand("fisternar", "admin", "look");
    expect((await store.popCommand("fisternar"))?.cmd).toBe(";invdb");
    const second = await store.popCommand("fisternar");
    expect(second?.cmd).toBe("look");
    expect(second?.cmdType).toBe("game");
    expect(await store.popCommand("fisternar")).toBeNull();
  });

  it("popCommand is per-character", async () => {
    const store = makeStore();
    await store.pushCommand("fisternar", "admin", ";invdb");
    expect(await store.popCommand("neleourg")).toBeNull();
  });

  it("savePremium stores premium info per character", async () => {
    const store = makeStore();
    await store.savePremium("Fisternar", { subscription: "Premium", premium_points: 100 });
    const got = await store.premium("fisternar");
    expect(got?.subscription).toBe("Premium");
    expect(got?.premium_points).toBe(100);
    expect(got?.ts).toBeGreaterThan(0);
    expect(await store.premium("neleourg")).toBeNull();
  });
});
