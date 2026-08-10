import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { Registry } from "../../src/core/registry.js";
import { buildSpec } from "../../src/core/spec.js";
import type { Module } from "../../src/core/types.js";

describe("buildSpec", () => {
  it("merges module specs and validates scope coverage", async () => {
    const registry = new Registry();
    const route = createRoute({
      method: "get",
      path: "/items",
      responses: {
        200: {
          content: { "application/json": { schema: z.array(z.object({ id: z.number() })) } },
          description: "ok",
        },
      },
    });
    const module: Module = {
      name: "inventory",
      prefix: "/api/modules/inventory",
      scopes: [{ name: "inventory.read", description: "r" }],
      routeScopes: { "GET /items": ["inventory.read"] },
      registerRoutes(router) {
        router.openapi(route, (c) => c.json([{ id: 1 }]));
      },
    };
    registry.register(module);
    registry.validate();
    const spec = await buildSpec(registry);
    expect((spec.paths as Record<string, unknown>)["/api/modules/inventory/items"]).toBeDefined();
  });

  it("fails when a route is missing from routeScopes", async () => {
    const registry = new Registry();
    const route = createRoute({
      method: "get",
      path: "/secret",
      responses: { 200: { description: "ok" } },
    });
    registry.register({
      name: "m",
      prefix: "/api/modules/m",
      scopes: [{ name: "m.read", description: "r" }],
      routeScopes: {},
      registerRoutes(router) {
        router.openapi(route, (c) => c.json({}));
      },
    });
    await expect(buildSpec(registry)).rejects.toThrow(/scope/i);
  });
});
