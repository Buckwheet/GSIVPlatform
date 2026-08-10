import { describe, expect, it } from "vitest";
import { Registry } from "../../src/core/registry.js";
import type { Module } from "../../src/core/types.js";

function module(overrides: Partial<Module>): Module {
  return {
    name: "test",
    prefix: "/api/modules/test",
    scopes: [{ name: "test.read", description: "read" }],
    routeScopes: { "GET /items": ["test.read"] },
    registerRoutes() {},
    ...overrides,
  };
}

describe("Registry", () => {
  it("registers and lists modules", () => {
    const r = new Registry();
    r.register(module({}));
    expect(r.list().map((m) => m.name)).toEqual(["test"]);
    expect(r.get("test")?.name).toBe("test");
  });

  it("rejects duplicate module names", () => {
    const r = new Registry();
    r.register(module({}));
    expect(() => r.register(module({}))).toThrow(/duplicate/i);
  });

  it("rejects duplicate prefixes", () => {
    const r = new Registry();
    r.register(module({ name: "a" }));
    expect(() => r.register(module({ name: "b", prefix: "/api/modules/test" }))).toThrow(/prefix/i);
  });

  it("validate() fails when a declared scope is unused", () => {
    const r = new Registry();
    r.register(module({ scopes: [{ name: "unused.scope", description: "x" }] }));
    expect(() => r.validate()).toThrow(/unused/i);
  });

  it("validate() fails when a route has no scope entry", () => {
    const r = new Registry();
    r.register(module({ routeScopes: {} }));
    expect(() => r.validate()).toThrow(/scope/i);
  });
});
