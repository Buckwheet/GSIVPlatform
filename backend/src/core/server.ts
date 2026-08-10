import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { Auth } from "./auth.js";
import type { CoreDb } from "./db.js";
import type { KV } from "./kv.js";
import { rateLimit } from "./rate-limit.js";
import type { Registry } from "./registry.js";
import { buildSpec } from "./spec.js";
import type { EventBus } from "./ws.js";

export interface AppDeps {
  registry: Registry;
  kv: KV;
  db: CoreDb;
  auth: Auth;
  eventBus: EventBus;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const moduleDeps = { kv: deps.kv, db: deps.db, eventBus: deps.eventBus };

  app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

  for (const m of deps.registry.list()) {
    const router = new OpenAPIHono();
    router.use(
      "*",
      deps.auth.authMiddleware(),
      rateLimit({ kv: deps.kv, windowMs: 60_000, max: 120, keyFn: (c) => (c.get("user") as { name: string }).name }),
    );
    m.registerRoutes(router, moduleDeps);
    app.route(m.prefix, router);
  }

  app.get("/api/spec", deps.auth.authMiddleware(), async (c) => {
    const spec = await buildSpec(deps.registry);
    return c.json(spec);
  });

  return app;
}
