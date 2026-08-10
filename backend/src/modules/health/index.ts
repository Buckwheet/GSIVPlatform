import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ status: z.string(), ts: z.number() }) } },
      description: "ok",
    },
  },
});

export const healthModule: Module = {
  name: "health",
  prefix: "/api/modules/health",
  scopes: [{ name: "health.read", description: "Read platform health" }],
  routeScopes: { "GET /status": ["health.read"] },
  registerRoutes(router: OpenAPIHono, _deps: unknown): void {
    router.openapi(statusRoute, (c) => c.json({ status: "ok", ts: Date.now() }));
  },
};
