import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { createGameviewModule } from "../../src/modules/gameview/index.js";

function makeApp(env: {
  baseUrl?: string;
  streamDomain?: string;
  streams?: string;
  token?: string;
  probe?: (port: number) => Promise<boolean>;
}) {
  const registry = new Registry();
  registry.register(
    createGameviewModule({
      baseUrl: env.baseUrl,
      streamDomain: env.streamDomain,
      streams: env.streams,
      token: env.token,
      probe: env.probe,
    }),
  );
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv("admin:tok:*");
  return createApp({ registry, kv: new InMemoryKV(), db: new CoreDb(":memory:"), auth, eventBus: new EventBus() });
}

describe("gameview module", () => {
  it("exposes per-character stream URLs built from config", async () => {
    const app = makeApp({
      baseUrl: "https://vellum.phylactery.ovh",
      streamDomain: "phylactery.ovh",
      streams: "Fisternar:9101:9201,Neleourg:9102:9202",
      token: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
      probe: async () => true,
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      Fisternar: {
        url: "https://fisternar.phylactery.ovh/play#token=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b&lich=127.0.0.1:9101&name=Fisternar",
        up: true,
      },
      Neleourg: {
        url: "https://neleourg.phylactery.ovh/play#token=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b&lich=127.0.0.1:9102&name=Neleourg",
        up: true,
      },
    });
  });

  it("omits the token from URLs when VELLUM_TOKEN is unset (prefill-only)", async () => {
    const app = makeApp({
      baseUrl: "https://vellum.phylactery.ovh",
      streamDomain: "phylactery.ovh",
      streams: "Fisternar:9101:9201",
      probe: async () => true,
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    const body = await res.json();
    expect(body.Fisternar.url).toBe("https://fisternar.phylactery.ovh/play#lich=127.0.0.1:9101&name=Fisternar");
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
