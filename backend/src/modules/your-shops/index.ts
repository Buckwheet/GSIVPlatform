import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { CoreDb } from "../../core/db.js";
import type { Module } from "../../core/types.js";
import type { YourShopsStore } from "./store.js";

const shopSchema = z.object({ id: z.number(), name: z.string(), town: z.string().nullable(), created_at: z.string() });
const saleSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  town: z.string(),
  shop: z.string(),
  cost: z.number().nullable(),
  removed_date: z.string(),
});
const notifSchema = z.object({
  id: z.number(),
  item_id: z.string(),
  shop: z.string(),
  name: z.string(),
  cost: z.number().nullable(),
  removed_date: z.string(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
});

const listShopsRoute = createRoute({
  method: "get",
  path: "/shops",
  responses: {
    200: { content: { "application/json": { schema: z.array(shopSchema) } }, description: "configured shops" },
  },
});
const setShopsRoute = createRoute({
  method: "put",
  path: "/shops",
  request: { body: { content: { "application/json": { schema: z.object({ names: z.array(z.string().min(1)) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "ok" } },
});
const salesRoute = createRoute({
  method: "get",
  path: "/sales",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ total: z.number(), sales: z.array(saleSchema) }) } },
      description: "tracked-shop sales",
    },
  },
});
const notificationsRoute = createRoute({
  method: "get",
  path: "/notifications",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ total: z.number(), unread: z.number(), notifications: z.array(notifSchema) }),
        },
      },
      description: "notifications",
    },
  },
});
const ackRoute = createRoute({
  method: "post",
  path: "/notifications/ack",
  request: { body: { content: { "application/json": { schema: z.object({ ids: z.array(z.number()).optional() }) } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean(), acked: z.number() }) } },
      description: "ok",
    },
  },
});
const scanRoute = createRoute({
  method: "post",
  path: "/scan",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ new: z.number(), baselined: z.number() }) } },
      description: "scan result",
    },
  },
});

export function createYourShopsModule(store: YourShopsStore, pricingDb: CoreDb): Module {
  return {
    name: "your-shops",
    prefix: "/api/modules/your-shops",
    scopes: [
      { name: "yourshops.read", description: "Read your shops, sales, notifications" },
      { name: "yourshops.write", description: "Manage shops, ack notifications, run scan" },
    ],
    routeScopes: {
      "GET /shops": ["yourshops.read"],
      "PUT /shops": ["yourshops.write"],
      "GET /sales": ["yourshops.read"],
      "GET /notifications": ["yourshops.read"],
      "POST /notifications/ack": ["yourshops.write"],
      "POST /scan": ["yourshops.write"],
    },
    nav: { path: "/your-shops", title: "Your Shops", group: "market", order: 20, icon: "🏪" },
    registerRoutes(router: OpenAPIHono, deps: unknown): void {
      const eventBus = (deps as { eventBus: { emit(type: string, payload: unknown): void } }).eventBus;
      router.openapi(listShopsRoute, (c) => c.json(store.listShops()));
      router.openapi(setShopsRoute, (c) => {
        const { names } = c.req.valid("json");
        store.setShops([...new Set(names.map((n) => n.trim()).filter(Boolean))]);
        return c.json({ ok: true });
      });
      router.openapi(salesRoute, (c) => {
        const sales = store.sales(pricingDb);
        return c.json({ total: sales.length, sales });
      });
      router.openapi(notificationsRoute, (c) => c.json(store.listNotifications()));
      router.openapi(ackRoute, (c) => {
        const { ids } = c.req.valid("json");
        return c.json({ ok: true, acked: store.ack(ids) });
      });
      router.openapi(scanRoute, (c) => {
        const res = store.scan(pricingDb);
        if (res.new > 0) eventBus.emit("sale_update", { count: res.new });
        return c.json({ new: res.new, baselined: res.baselined });
      });
    },
  };
}
