import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Auth, AuthedUser } from "./auth.js";
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

function pathMatches(pattern: string, path: string): boolean {
  const pSegs = pattern.split("/").filter(Boolean);
  const rSegs = path.split("/").filter(Boolean);
  if (pSegs.length !== rSegs.length) return false;
  for (let i = 0; i < pSegs.length; i++) {
    if (pSegs[i].startsWith(":")) continue;
    if (pSegs[i] !== rSegs[i]) return false;
  }
  return true;
}

function scopeGuard(m: import("./types.js").Module): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as AuthedUser | undefined;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (user.scopes.includes("*")) return next();
    const rel = c.req.path.slice(m.prefix.length).split("?")[0];
    const method = c.req.method.toUpperCase();
    // Prefer literal segments over :param patterns (most-specific match wins).
    let allowed: string[] | undefined;
    let bestScore = -1;
    for (const [key, scopes] of Object.entries(m.routeScopes)) {
      const [kmethod, kpath] = key.split(" ");
      if (kmethod !== method || !pathMatches(kpath, rel)) continue;
      const literalCount = kpath.split("/").filter((seg) => seg && !seg.startsWith(":")).length;
      if (literalCount > bestScore) {
        bestScore = literalCount;
        allowed = scopes;
      }
    }
    if (!allowed) return c.json({ error: "forbidden", route: `${method} ${rel}` }, 403);
    if (allowed.some((sc) => user.scopes.includes(sc))) return next();
    return c.json({ error: "forbidden", route: `${method} ${rel}` }, 403);
  };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const moduleDeps = { kv: deps.kv, db: deps.db, eventBus: deps.eventBus };

  app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

  for (const m of deps.registry.list()) {
    const router = new OpenAPIHono();
    router.use("*", deps.auth.authMiddleware());
    // Global request-body cap: bounds memory on multipart uploads and all bodies.
    router.use("*", bodyLimit({ maxSize: 50 * 1024 * 1024 }));
    router.use(
      "*",
      rateLimit({ kv: deps.kv, windowMs: 60_000, max: 120, keyFn: (c) => (c.get("user") as { name: string }).name }),
    );
    router.use("*", scopeGuard(m));
    m.registerRoutes(router, moduleDeps);
    app.route(m.prefix, router);
  }

  app.get("/api/spec", deps.auth.authMiddleware(), async (c) => {
    const spec = await buildSpec(deps.registry);
    return c.json(spec);
  });

  return app;
}
