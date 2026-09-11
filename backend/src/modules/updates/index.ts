/**
 * `updates` — upstream release watch (API-only; the shell's 🔔 bell is its UI).
 *
 * VellumFE is deployed from a built binary, so "a new release is out" is
 * invisible unless something checks. This module polls upstream GitHub
 * *releases* on a timer (see `poller.ts`), compares the newest tag with the
 * deployed `VELLUM_VERSION` using a beta-aware semver compare (`semver.ts` —
 * every upstream release is marked Pre-release, so `/releases/latest` never
 * matches and plain string order puts `beta.44` above `beta.50`), and files one
 * notification per tag that stays unread until acknowledged.
 */
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { UpdatesStore } from "./store.js";

const statusSchema = z.object({
  current: z.string().nullable(),
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
const notifSchema = z.object({
  id: z.number(),
  tag: z.string(),
  url: z.string(),
  published_at: z.string().nullable(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
});

const notificationsRoute = createRoute({
  method: "get",
  path: "/notifications",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            total: z.number(),
            unread: z.number(),
            notifications: z.array(notifSchema),
            status: statusSchema,
          }),
        },
      },
      description: "update notifications + the last version check",
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

export function createUpdatesModule(store: UpdatesStore): Module {
  return {
    name: "updates",
    prefix: "/api/modules/updates",
    scopes: [
      { name: "updates.read", description: "Read upstream release notifications + deployed version status" },
      { name: "updates.write", description: "Acknowledge update notifications" },
    ],
    routeScopes: {
      "GET /notifications": ["updates.read"],
      "POST /notifications/ack": ["updates.write"],
    },
    // API-only: no nav entry. The 🔔 bell in the shell is the UI for this.
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(notificationsRoute, (c) => c.json(store.listNotifications()));
      router.openapi(ackRoute, (c) => {
        const { ids } = c.req.valid("json");
        return c.json({ ok: true, acked: store.ack(ids) });
      });
    },
  };
}
