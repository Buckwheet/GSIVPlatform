import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { healthModule } from "../../src/modules/health/index.js";

describe("scope enforcement", () => {
  function makeApp(tokensEnv: string) {
    const registry = new Registry();
    registry.register(healthModule);
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
});
