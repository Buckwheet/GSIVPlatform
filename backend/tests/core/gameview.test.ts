import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { createGameviewModule } from "../../src/modules/gameview/index.js";

function makeApp(env: { baseUrl?: string; streams?: string; probe?: (port: number) => Promise<boolean> }) {
  const registry = new Registry();
  registry.register(createGameviewModule({ baseUrl: env.baseUrl, streams: env.streams, probe: env.probe }));
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv("admin:tok:*");
  return createApp({ registry, kv: new InMemoryKV(), db: new CoreDb(":memory:"), auth, eventBus: new EventBus() });
}

describe("gameview module", () => {
  it("exposes per-character stream URLs built from config", async () => {
    const app = makeApp({
      baseUrl: "https://vellum.phylactery.ovh",
      streams: "Fisternar:9101:9201,Neleourg:9102:9202",
      probe: async () => true,
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      Fisternar: {
        url: "https://vellum.phylactery.ovh/play#rhost=127.0.0.1&rport=9101",
        up: true,
      },
      Neleourg: {
        url: "https://vellum.phylactery.ovh/play#rhost=127.0.0.1&rport=9102",
        up: true,
      },
    });
  });

  it("reports a down stream when the web port is unreachable", async () => {
    const app = makeApp({
      baseUrl: "https://vellum.phylactery.ovh",
      streams: "Fisternar:9101:9201",
      probe: async () => false,
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    const body = await res.json();
    expect(body.Fisternar.up).toBe(false);
  });

  it("returns an empty map when streams config is absent", async () => {
    const app = makeApp({});
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    expect(await res.json()).toEqual({});
  });

  it("requires gameview.read", async () => {
    const registry = new Registry();
    registry.register(
      createGameviewModule({ baseUrl: "https://vellum.phylactery.ovh", streams: "Fisternar:9101:9201" }),
    );
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("limited:tok:health.read");
    const app = createApp({
      registry,
      kv: new InMemoryKV(),
      db: new CoreDb(":memory:"),
      auth,
      eventBus: new EventBus(),
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });
});
