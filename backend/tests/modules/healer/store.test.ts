import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryKV } from "../../../src/core/kv.js";
import { HealerStore } from "../../../src/modules/healer/store.js";

describe("HealerStore", () => {
  let store: HealerStore;

  beforeEach(() => {
    store = new HealerStore(new InMemoryKV());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("register stores a healer and status lists it", async () => {
    const h = await store.register("Fisternar", 1234, "Cleric", 50);
    expect(h.character).toBe("Fisternar");
    expect(h.room_id).toBe(1234);
    expect(h.prof).toBe("Cleric");
    expect(h.level).toBe(50);
    expect(h.last_heartbeat).toBeGreaterThan(0);
    const s = await store.status();
    expect(s.healers).toHaveLength(1);
    expect(s.healers[0].character).toBe("Fisternar");
  });

  it("heartbeat upserts and refreshes the timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await store.register("Fisternar", 1);
    vi.setSystemTime(2_000_000);
    const h = await store.heartbeat("fisternar", 999);
    expect(h.room_id).toBe(999);
    expect(h.last_heartbeat).toBe(2_000_000);
    // heartbeat for an unregistered char creates it
    const created = await store.heartbeat("Neleourg", 42);
    expect(created.character).toBe("Neleourg");
    expect(created.room_id).toBe(42);
  });

  it("request creates a pending request with a unique id", async () => {
    const a = await store.request("Zepherus", 100, { hp: 80, max_hp: 100, wounds: true });
    const b = await store.request("Arli", 100);
    expect(a.status).toBe("pending");
    expect(a.request_id).not.toBe(b.request_id);
    expect(a.request_id).toMatch(/^heal_\d+_\d+$/);
    expect(a.hp).toBe(80);
    const all = await store.requests();
    expect(all).toHaveLength(2);
  });

  it("nextFor returns the oldest pending request in the same room", async () => {
    await store.register("Healbob", 500);
    await store.request("Zepherus", 500, { hp: 10 });
    await store.request("Arli", 500, { hp: 20 });
    await store.request("Other", 999);
    const next = await store.nextFor("healbob");
    expect(next).toEqual({ target: "Zepherus", room_id: 500, request_id: expect.stringMatching(/^heal_/) });
  });

  it("nextFor returns null for a different room or an unknown healer", async () => {
    await store.register("Healbob", 500);
    await store.request("Zepherus", 999);
    expect(await store.nextFor("healbob")).toBeNull();
    expect(await store.nextFor("ghost")).toBeNull();
  });

  it("accept marks the request accepted and records the healer", async () => {
    const req = await store.request("Zepherus", 500);
    await store.accept(req.request_id, "healbob");
    const all = await store.requests();
    expect(all[0].status).toBe("accepted");
    expect(all[0].healer).toBe("healbob");
    // accepted request is no longer next
    await store.register("Healbob", 500);
    expect(await store.nextFor("healbob")).toBeNull();
  });

  it("complete sets the status and prunes requests to the last 50", async () => {
    const first = await store.request("Zepherus", 500);
    const keep = await store.request("Arli", 500);
    await store.complete(keep.request_id, "not_in_room");
    const all = await store.requests();
    expect(all.find((r) => r.request_id === keep.request_id)?.status).toBe("not_in_room");
    for (let i = 0; i < 50; i++) await store.request(`Char${i}`, 500);
    await store.complete(first.request_id, "complete");
    const pruned = await store.requests();
    expect(pruned).toHaveLength(50);
    expect(pruned.every((r) => r.request_id !== first.request_id)).toBe(true);
  });

  it("status prunes healers with no heartbeat in 30s and counts pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await store.register("Stale", 1);
    vi.setSystemTime(1_000_000 + 5_000);
    await store.register("Fresh", 2);
    await store.request("Zepherus", 500);
    vi.setSystemTime(1_000_000 + 31_000);
    const s = await store.status();
    expect(s.healers.map((h) => h.character)).toEqual(["Fresh"]);
    expect(s.pending).toBe(1);
  });
});
