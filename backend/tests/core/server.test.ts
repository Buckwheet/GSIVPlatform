import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { healthModule } from "../../src/modules/health/index.js";

describe("createApp", () => {
  it("serves public health and authed module status with scope enforcement", async () => {
    const registry = new Registry();
    registry.register(healthModule);
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("admin:tok:*");
    const db = new CoreDb(":memory:");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });

    const pub = await app.request("/health");
    expect(pub.status).toBe(200);

    const noAuth = await app.request("/api/modules/health/status");
    expect(noAuth.status).toBe(401);

    const ok = await app.request("/api/modules/health/status", { headers: { Authorization: "Bearer tok" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");

    const spec = await app.request("/api/spec", { headers: { Authorization: "Bearer tok" } });
    expect(spec.status).toBe(200);
    expect((await spec.json()).paths["/api/modules/health/status"]).toBeDefined();
  });
});
