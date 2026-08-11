import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { EventBus } from "../../core/ws.js";
import type { GemsStore } from "./store.js";

const jarEntrySchema = z.object({
  id: z.union([z.string(), z.number()]),
  type: z.string().nullable(),
  portions: z.number(),
});

const jarStatusSchema = z.object({
  character: z.string(),
  full_jars: z.array(jarEntrySchema),
  full_jar_count: z.number(),
  ts: z.number(),
  responder: z.string().nullable().optional(),
  claimed_at: z.number().nullable().optional(),
});

const jarPublishBody = z.object({
  character: z.string(),
  full_jars: z.array(jarEntrySchema).optional(),
  full_jar_count: z.number().optional(),
});

const claimBody = z.object({ holder: z.string(), responder: z.string() });
const charBody = z.object({ character: z.string() });
const queueBody = z.object({ service: z.string(), character: z.string() });

const okSchema = z.object({ ok: z.boolean() });

const jarsListRoute = createRoute({
  method: "get",
  path: "/jars",
  responses: {
    200: { content: { "application/json": { schema: z.array(jarStatusSchema) } }, description: "all jar statuses" },
  },
});

const jarGetRoute = createRoute({
  method: "get",
  path: "/jars/:char",
  request: { params: z.object({ char: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: jarStatusSchema } }, description: "single jar status" },
  },
});

const jarPublishRoute = createRoute({
  method: "post",
  path: "/jars",
  request: { body: { content: { "application/json": { schema: jarPublishBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "published" },
    400: { description: "character required" },
  },
});

const jarClaimRoute = createRoute({
  method: "post",
  path: "/jars/claim",
  request: { body: { content: { "application/json": { schema: claimBody } } } },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), holder: z.string(), responder: z.string() }),
        },
      },
      description: "claimed",
    },
    400: { description: "holder and responder required" },
    404: { description: "no jar data for holder" },
  },
});

const jarClearRoute = createRoute({
  method: "post",
  path: "/jars/clear",
  request: { body: { content: { "application/json": { schema: charBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "cleared" },
    400: { description: "character required" },
  },
});

const queueStatusRoute = createRoute({
  method: "get",
  path: "/queue/status/:service",
  request: { params: z.object({ service: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(z.string()) } }, description: "ordered queue" },
  },
});

const queueNextRoute = createRoute({
  method: "get",
  path: "/queue/next/:service",
  request: { params: z.object({ service: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ next: z.string().nullable() }) } },
      description: "next in queue",
    },
  },
});

const queueJoinRoute = createRoute({
  method: "post",
  path: "/queue/join",
  request: { body: { content: { "application/json": { schema: queueBody } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ position: z.literal("already_queued") }) } },
      description: "already queued",
    },
    201: {
      content: { "application/json": { schema: z.object({ ok: z.boolean(), position: z.number() }) } },
      description: "joined",
    },
    400: { description: "service and character required" },
  },
});

const queueDoneRoute = createRoute({
  method: "post",
  path: "/queue/done",
  request: { body: { content: { "application/json": { schema: queueBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "done" },
    400: { description: "service and character required" },
  },
});

export function createGemsModule(store: GemsStore): Module {
  return {
    name: "gems",
    prefix: "/api/modules/gems",
    scopes: [
      { name: "gems.read", description: "Read jar statuses and service queues" },
      { name: "gems.write", description: "Publish jar status, claim/clear, manage queues" },
    ],
    nav: { path: "/jars", title: "Jars", group: "operations", order: 30, icon: "🫙" },
    routeScopes: {
      "GET /jars": ["gems.read"],
      "GET /jars/:char": ["gems.read"],
      "POST /jars": ["gems.write"],
      "POST /jars/claim": ["gems.write"],
      "POST /jars/clear": ["gems.write"],
      "GET /queue/status/:service": ["gems.read"],
      "GET /queue/next/:service": ["gems.read"],
      "POST /queue/join": ["gems.write"],
      "POST /queue/done": ["gems.write"],
    },
    registerRoutes(router: OpenAPIHono, deps: unknown): void {
      const { eventBus } = deps as { eventBus: EventBus };

      router.openapi(jarsListRoute, async (c) => c.json(await store.getJars()));
      router.openapi(jarGetRoute, async (c) => c.json(await store.getJar(c.req.valid("param").char)));

      router.openapi(jarPublishRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.character) return c.json({ error: "character required" }, 400);
        const status = await store.setJar(body.character, {
          full_jars: body.full_jars ?? [],
          full_jar_count: body.full_jar_count ?? 0,
        });
        eventBus.emit("jars_update", { character: status.character, data: status });
        return c.json({ ok: true }, 200);
      });

      router.openapi(jarClaimRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.holder || !body.responder) return c.json({ error: "holder and responder required" }, 400);
        const status = await store.claimJar(body.holder, body.responder);
        if (!status) return c.json({ error: "no jar data for holder" }, 404);
        eventBus.emit("jars_claimed", { holder: status.character, responder: status.responder });
        return c.json({ ok: true, holder: status.character, responder: status.responder }, 200);
      });

      router.openapi(jarClearRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.character) return c.json({ error: "character required" }, 400);
        await store.clearJar(body.character);
        return c.json({ ok: true }, 200);
      });

      router.openapi(queueStatusRoute, async (c) => c.json(await store.queueStatus(c.req.valid("param").service)));
      router.openapi(queueNextRoute, async (c) =>
        c.json({ next: await store.queueNext(c.req.valid("param").service) }),
      );

      router.openapi(queueJoinRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.service || !body.character) return c.json({ error: "service and character required" }, 400);
        const result = await store.queueJoin(body.service, body.character);
        const queue = await store.queueStatus(body.service);
        eventBus.emit("queue_update", { service: body.service, queue });
        if (result.position === "already_queued") return c.json({ position: "already_queued" }, 200);
        return c.json({ ok: true, position: result.position }, 201);
      });

      router.openapi(queueDoneRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.service || !body.character) return c.json({ error: "service and character required" }, 400);
        await store.queueDone(body.service, body.character);
        const queue = await store.queueStatus(body.service);
        eventBus.emit("queue_update", { service: body.service, queue });
        return c.json({ ok: true }, 200);
      });
    },
  };
}
