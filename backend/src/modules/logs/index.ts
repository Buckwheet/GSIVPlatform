import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { EventLog } from "../../core/event-log.js";
import type { Module } from "../../core/types.js";

const listRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
      type: z.string().optional(),
      character: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(z.any()) } },
      description: "Event history, newest first",
    },
  },
});

/** API-only module (no nav): platform event history, v1 /api/logs port. */
export function createLogsModule(eventLog: EventLog): Module {
  return {
    name: "logs",
    prefix: "/api/logs",
    scopes: [{ name: "logs.read", description: "Read platform event history" }],
    routeScopes: { "GET /": ["logs.read"] },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(listRoute, (c) => {
        const q = c.req.valid("query");
        return c.json(eventLog.list({ limit: q.limit, offset: q.offset, type: q.type, character: q.character }));
      });
    },
  };
}
