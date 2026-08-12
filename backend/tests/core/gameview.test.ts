import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { Systemd } from "../../src/core/systemd.js";
import { EventBus } from "../../src/core/ws.js";
import { createGameviewModule } from "../../src/modules/gameview/index.js";

const STREAMS = "Fisternar:9101:9201,Neleourg:9102:9202";
const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";

function makeApp(env: {
  baseUrl?: string;
  streamDomain?: string;
  streams?: string;
  token?: string;
  probe?: (port: number) => Promise<boolean>;
  systemd?: Systemd;
}) {
  const registry = new Registry();
  registry.register(
    createGameviewModule({
      baseUrl: env.baseUrl,
      streamDomain: env.streamDomain,
      streams: env.streams,
      token: env.token,
      probe: env.probe,
      systemd: env.systemd,
    }),
  );
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv("admin:tok:*");
  return createApp({ registry, kv: new InMemoryKV(), db: new CoreDb(":memory:"), auth, eventBus: new EventBus() });
}

/** Fake Systemd: `show` reports `active`, records every execFile call. */
function fakeSystemd(records: { cmd: string; args: string[] }[], active: boolean): Systemd {
  return new Systemd(
    async (cmd, args) => {
      records.push({ cmd, args });
      if (cmd === "systemctl" && args[0] === "show") {
        return {
          stdout: active ? "ActiveState=active\nSubState=running" : "ActiveState=inactive\nSubState=dead",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    { sudoActions: false },
  );
}

describe("gameview module", () => {
  it("exposes per-character stream URLs built from config", async () => {
    const app = makeApp({
      baseUrl: "https://vellum.phylactery.ovh",
      streamDomain: "phylactery.ovh",
      streams: STREAMS,
      token: TOKEN,
      probe: async () => true,
    });
    const res = await app.request("/api/modules/gameview/streams", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      Fisternar: {
        url: `https://fisternar.phylactery.ovh/play#token=${TOKEN}&lich=127.0.0.1:9101&name=Fisternar`,
        up: true,
      },
      Neleourg: {
        url: `https://neleourg.phylactery.ovh/play#token=${TOKEN}&lich=127.0.0.1:9102&name=Neleourg`,
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

  it("requires gameview.read for streams", async () => {
    const registry = new Registry();
    registry.register(createGameviewModule({ baseUrl: "https://vellum.phylactery.ovh", streams: STREAMS }));
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

  describe("POST /launch/:char", () => {
    const URL = `https://fisternar.phylactery.ovh/play#token=${TOKEN}&lich=127.0.0.1:9101&name=Fisternar`;

    it("starts the inactive Lich unit and returns the stream URL", async () => {
      const records: { cmd: string; args: string[] }[] = [];
      const app = makeApp({
        baseUrl: "https://vellum.phylactery.ovh",
        streamDomain: "phylactery.ovh",
        streams: STREAMS,
        token: TOKEN,
        systemd: fakeSystemd(records, false),
      });
      const res = await app.request("/api/modules/gameview/launch/Fisternar", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ char: "Fisternar", url: URL, started: true });
      expect(records).toEqual([
        {
          cmd: "systemctl",
          args: [
            "show",
            "gs4sd-lich@Fisternar.service",
            "--property=ActiveState,SubState,ActiveEnterTimestampMonotonic",
          ],
        },
        { cmd: "systemctl", args: ["start", "gs4sd-lich@Fisternar.service"] },
      ]);
    });

    it("skips the start when the unit is already active (started:false)", async () => {
      const records: { cmd: string; args: string[] }[] = [];
      const app = makeApp({
        baseUrl: "https://vellum.phylactery.ovh",
        streamDomain: "phylactery.ovh",
        streams: STREAMS,
        token: TOKEN,
        systemd: fakeSystemd(records, true),
      });
      const res = await app.request("/api/modules/gameview/launch/Neleourg", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        char: "Neleourg",
        url: `https://neleourg.phylactery.ovh/play#token=${TOKEN}&lich=127.0.0.1:9102&name=Neleourg`,
        started: false,
      });
      expect(records).toHaveLength(1); // show only — no start
      expect(records[0].args[0]).toBe("show");
    });

    it("404s for a char with no configured stream", async () => {
      const app = makeApp({
        baseUrl: "https://vellum.phylactery.ovh",
        streams: STREAMS,
        token: TOKEN,
        systemd: fakeSystemd([], false),
      });
      const res = await app.request("/api/modules/gameview/launch/Ghost", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "no stream configured for Ghost" });
    });

    it("400s on an invalid character name", async () => {
      const app = makeApp({
        baseUrl: "https://vellum.phylactery.ovh",
        streams: STREAMS,
        token: TOKEN,
        systemd: fakeSystemd([], false),
      });
      const res = await app.request("/api/modules/gameview/launch/1bad%20name", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("invalid character name");
    });

    it("500s when the systemd start fails", async () => {
      const records: { cmd: string; args: string[] }[] = [];
      const systemd = new Systemd(
        async (cmd, args) => {
          records.push({ cmd, args });
          if (cmd === "systemctl" && args[0] === "show") {
            return { stdout: "ActiveState=inactive\nSubState=dead", stderr: "", code: 0 };
          }
          return { stdout: "", stderr: "Failed to start unit", code: 1 };
        },
        { sudoActions: false },
      );
      const app = makeApp({
        baseUrl: "https://vellum.phylactery.ovh",
        streams: STREAMS,
        token: TOKEN,
        systemd,
      });
      const res = await app.request("/api/modules/gameview/launch/Fisternar", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to start unit" });
    });

    it("allows either write scope (lich.write OR characters.write)", async () => {
      for (const scopes of ["lich.write", "characters.write", "lich.write,characters.write"]) {
        const registry = new Registry();
        registry.register(
          createGameviewModule({
            baseUrl: "https://vellum.phylactery.ovh",
            streams: STREAMS,
            token: TOKEN,
            systemd: fakeSystemd([], true),
          }),
        );
        registry.validate();
        const auth = new Auth(new InMemoryKV());
        auth.loadFromEnv(`limited:tok:${scopes}`);
        const app = createApp({
          registry,
          kv: new InMemoryKV(),
          db: new CoreDb(":memory:"),
          auth,
          eventBus: new EventBus(),
        });
        const res = await app.request("/api/modules/gameview/launch/Fisternar", {
          method: "POST",
          headers: { Authorization: "Bearer tok" },
        });
        expect(res.status).toBe(200);
        expect((await res.json()).started).toBe(false);
      }
    });

    it("403s without a write scope", async () => {
      const registry = new Registry();
      registry.register(
        createGameviewModule({ baseUrl: "https://vellum.phylactery.ovh", streams: STREAMS, token: TOKEN }),
      );
      registry.validate();
      const auth = new Auth(new InMemoryKV());
      auth.loadFromEnv("limited:tok:gameview.read");
      const app = createApp({
        registry,
        kv: new InMemoryKV(),
        db: new CoreDb(":memory:"),
        auth,
        eventBus: new EventBus(),
      });
      const res = await app.request("/api/modules/gameview/launch/Fisternar", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      });
      expect(res.status).toBe(403);
    });
  });
});
