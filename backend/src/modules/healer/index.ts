import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { EventBus } from "../../core/ws.js";
import type { HealerInfo, HealerStore, HealRequest, HealStatus } from "./store.js";

const healerInfoSchema = z.object({
  character: z.string(),
  room_id: z.union([z.number(), z.string()]),
  prof: z.string().optional(),
  level: z.number().optional(),
  last_heartbeat: z.number(),
});

const healRequestSchema = z.object({
  request_id: z.string(),
  character: z.string(),
  room_id: z.union([z.number(), z.string()]),
  hp: z.number().optional(),
  max_hp: z.number().optional(),
  wounds: z.boolean().optional(),
  ts: z.number(),
  status: z.enum(["pending", "accepted", "complete", "not_in_room"]),
  healer: z.string().optional(),
});

const okSchema = z.object({ ok: z.boolean() });

const registerBody = z.object({
  character: z.string(),
  room_id: z.union([z.number(), z.string()]),
  prof: z.string().optional(),
  level: z.number().optional(),
});

const heartbeatBody = z.object({
  character: z.string(),
  room_id: z.union([z.number(), z.string()]),
});

const requestBody = z.object({
  character: z.string(),
  room_id: z.union([z.number(), z.string()]),
  hp: z.number().optional(),
  max_hp: z.number().optional(),
  wounds: z.boolean().optional(),
});

const requestIdBody = z.object({
  request_id: z.string(),
  character: z.string(),
  target: z.string(),
  status: z.enum(["pending", "accepted", "complete", "not_in_room"]).optional(),
});

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ healers: z.array(healerInfoSchema), pending: z.number() }),
        },
      },
      description: "active healers + pending count",
    },
  },
});

const requestsRoute = createRoute({
  method: "get",
  path: "/requests",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(healRequestSchema) } },
      description: "recent heal requests",
    },
  },
});

const nextRoute = createRoute({
  method: "get",
  path: "/next/:healer",
  request: { params: z.object({ healer: z.string() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z
            .object({ target: z.string(), room_id: z.union([z.number(), z.string()]), request_id: z.string() })
            .or(z.object({ target: z.null() })),
        },
      },
      description: "oldest pending request in the healer's room",
    },
  },
});

const registerRoute = createRoute({
  method: "post",
  path: "/register",
  request: { body: { content: { "application/json": { schema: registerBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "registered" },
    400: { description: "character required" },
  },
});

const heartbeatRoute = createRoute({
  method: "post",
  path: "/heartbeat",
  request: { body: { content: { "application/json": { schema: heartbeatBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "heartbeat" },
    400: { description: "character required" },
  },
});

const requestRoute = createRoute({
  method: "post",
  path: "/request",
  request: { body: { content: { "application/json": { schema: requestBody } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean(), request_id: z.string() }) } },
      description: "requested",
    },
    400: { description: "character and room_id required" },
  },
});

const acceptRoute = createRoute({
  method: "post",
  path: "/accept",
  request: { body: { content: { "application/json": { schema: requestIdBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "accepted" },
  },
});

const completeRoute = createRoute({
  method: "post",
  path: "/complete",
  request: { body: { content: { "application/json": { schema: requestIdBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "completed" },
  },
});

export function createHealerModule(store: HealerStore): Module {
  return {
    name: "healer",
    prefix: "/api/modules/healer",
    scopes: [
      { name: "healer.read", description: "Read healer status and heal requests" },
      { name: "healer.write", description: "Register/heartbeat, request/accept/complete heals" },
    ],
    nav: { path: "/healer", title: "Healer", group: "operations", order: 60, icon: "⛑️" },
    routeScopes: {
      "GET /status": ["healer.read"],
      "GET /requests": ["healer.read"],
      "GET /next/:healer": ["healer.read"],
      "POST /register": ["healer.write"],
      "POST /heartbeat": ["healer.write"],
      "POST /request": ["healer.write"],
      "POST /accept": ["healer.write"],
      "POST /complete": ["healer.write"],
    },
    registerRoutes(router: OpenAPIHono, deps: unknown): void {
      const { eventBus } = deps as { eventBus: EventBus };

      router.openapi(statusRoute, async (c) => c.json(await store.status()));
      router.openapi(requestsRoute, async (c) => c.json((await store.requests()).slice(-20)));

      router.openapi(nextRoute, async (c) => {
        const next = await store.nextFor(c.req.valid("param").healer);
        return c.json(next ?? { target: null }, 200);
      });

      router.openapi(registerRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.character) return c.json({ error: "character required" }, 400);
        await store.register(body.character, body.room_id, body.prof, body.level);
        eventBus.emit("healer_update", { healers: (await store.status()).healers });
        return c.json({ ok: true }, 200);
      });

      router.openapi(heartbeatRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.character) return c.json({ error: "character required" }, 400);
        await store.heartbeat(body.character, body.room_id);
        return c.json({ ok: true }, 200);
      });

      router.openapi(requestRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.character || !body.room_id) return c.json({ error: "character and room_id required" }, 400);
        const req = await store.request(body.character, body.room_id, {
          hp: body.hp,
          max_hp: body.max_hp,
          wounds: body.wounds,
        });
        eventBus.emit("heal_request", { request: req });
        return c.json({ ok: true, request_id: req.request_id }, 200);
      });

      router.openapi(acceptRoute, async (c) => {
        const body = c.req.valid("json");
        await store.accept(body.request_id, body.character);
        eventBus.emit("heal_accepted", {
          request_id: body.request_id,
          healer: body.character,
          target: body.target,
        });
        return c.json({ ok: true }, 200);
      });

      router.openapi(completeRoute, async (c) => {
        const body = c.req.valid("json");
        await store.complete(body.request_id, body.status as HealStatus | undefined);
        eventBus.emit("heal_complete", {
          request_id: body.request_id,
          healer: body.character,
          target: body.target,
          status: body.status ?? "complete",
        });
        return c.json({ ok: true }, 200);
      });
    },
  };
}

export type { HealerInfo, HealRequest };
