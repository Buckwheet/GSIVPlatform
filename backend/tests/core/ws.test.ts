import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/core/ws.js";

describe("EventBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.on("inventory", "update", (p) => seen.push(p));
    bus.emit("update", { n: 1 });
    bus.emit("update", { n: 2 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    off();
    bus.emit("update", { n: 3 });
    expect(seen).toHaveLength(2);
  });

  it("fans out to every module subscribed to the type", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.on("inventory", "update", (p) => a.push(p));
    bus.on("pricing", "update", (p) => b.push(p));
    bus.emit("update", { x: 1 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("throws on duplicate module registration", () => {
    const bus = new EventBus();
    bus.on("m", "e", () => {});
    expect(() => bus.on("m", "e", () => {})).toThrow(/already/i);
  });
});
