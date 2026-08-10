import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { CharacterRow, CharactersStore } from "./store.js";

const characterRowSchema = z.object({
  account: z.string(),
  char_name: z.string(),
  game_code: z.string(),
  managed: z.boolean(),
  unit: z.string(),
  active: z.boolean(),
  sub: z.string(),
  uptime: z.number().nullable(),
});

const actionResultSchema = z
  .object({ ok: z.boolean(), error: z.string().optional(), was_managed: z.boolean().optional() })
  .passthrough();

const listRoute = createRoute({
  method: "get",
  path: "/characters",
  responses: {
    200: { content: { "application/json": { schema: z.array(characterRowSchema) } }, description: "all characters" },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/characters/:name",
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: characterRowSchema } }, description: "single character" },
    404: { description: "unknown character" },
  },
});

const actionRoute = (action: "start" | "stop" | "restart") =>
  createRoute({
    method: "post",
    path: `/characters/:name/${action}`,
    request: { params: z.object({ name: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: actionResultSchema } }, description: `${action} result` },
      404: { description: "unknown character" },
      500: { description: "systemd action failed" },
    },
  });

const startRoute = actionRoute("start");
const stopRoute = actionRoute("stop");
const restartRoute = actionRoute("restart");

export function createCharactersModule(store: CharactersStore): Module {
  return {
    name: "characters",
    prefix: "/api/modules/characters",
    scopes: [
      { name: "characters.read", description: "List characters and systemd status" },
      { name: "characters.write", description: "Start/stop/restart headless Lich sessions" },
    ],
    routeScopes: {
      "GET /characters": ["characters.read"],
      "GET /characters/:name": ["characters.read"],
      "POST /characters/:name/start": ["characters.write"],
      "POST /characters/:name/stop": ["characters.write"],
      "POST /characters/:name/restart": ["characters.write"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(listRoute, async (c) => c.json((await store.list()) as unknown as CharacterRow[]));
      router.openapi(getRoute, async (c) => {
        const row = await store.get(c.req.valid("param").name);
        if (!row) return c.json({ error: "unknown character" }, 404);
        return c.json(row as unknown as CharacterRow);
      });
      router.openapi(startRoute, async (c) => {
        const res = await store.start(c.req.valid("param").name);
        if (res === null) return c.json({ error: "unknown character" }, 404);
        return c.json(res, res.ok ? 200 : 500);
      });
      router.openapi(stopRoute, async (c) => {
        const res = await store.stop(c.req.valid("param").name);
        if (res === null) return c.json({ error: "unknown character" }, 404);
        return c.json(res, res.ok ? 200 : 500);
      });
      router.openapi(restartRoute, async (c) => {
        const res = await store.restart(c.req.valid("param").name);
        if (res === null) return c.json({ error: "unknown character" }, 404);
        return c.json(res, res.ok ? 200 : 500);
      });
    },
  };
}
