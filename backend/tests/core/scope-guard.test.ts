import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import type { Module } from "../../src/core/types.js";
import { EventBus } from "../../src/core/ws.js";
import { healthModule } from "../../src/modules/health/index.js";

describe("scope enforcement", () => {
  function makeApp(tokensEnv: string, extra?: Module) {
    const registry = new Registry();
    registry.register(healthModule);
    if (extra) registry.register(extra);
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    const db = new CoreDb(":memory:");
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  it("denies a token without the required scope", async () => {
    const app = makeApp("limited:tok:other.read");
    const res = await app.request("/api/modules/health/status", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });

  it("allows a token with the required scope", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/health/status", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
  });

  it("allows the admin wildcard", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/health/status", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
  });

  it("prefers literal routes over :param shadowing", async () => {
    const literal = createRoute({
      method: "get",
      path: "/items/special",
      responses: { 200: { description: "ok" } },
    });
    const param = createRoute({
      method: "get",
      path: "/items/:id",
      responses: { 200: { description: "ok" } },
    });
    const module: Module = {
      name: "shadow",
      prefix: "/api/modules/shadow",
      scopes: [
        { name: "shadow.special", description: "s" },
        { name: "shadow.param", description: "p" },
      ],
      routeScopes: { "GET /items/special": ["shadow.special"], "GET /items/:id": ["shadow.param"] },
      registerRoutes(router: OpenAPIHono) {
        router.openapi(param, (c) => c.json({ kind: "param" }));
        router.openapi(literal, (c) => c.json({ kind: "literal" }));
      },
    };
    const app = makeApp("limited:tok:shadow.param", module);
    // token has shadow.param only -> literal route must 403 (param shadow must not grant it)
    const res = await app.request("/api/modules/shadow/items/special", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(403);
    // param route must still be allowed
    const res2 = await app.request("/api/modules/shadow/items/42", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(res2.status).toBe(200);
  });
});
