import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createLichModule, type GameProbe } from "../../../src/modules/lich/index.js";
import { LichStore } from "../../../src/modules/lich/store.js";

describe("lich module routes", () => {
  let db: CoreDb;
  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => db.close());

  function makeApp(tokensEnv: string, probe: GameProbe = async () => true) {
    const kv = new InMemoryKV();
    const store = new LichStore(kv);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createLichModule(store, { gameProbe: probe }));
    registry.validate();
    const auth = new Auth(kv);
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv, db, auth, eventBus: new EventBus() });
  }

  const auth = { Authorization: "Bearer tok" };

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/lich/watchdog");
    expect(res.status).toBe(401);
  });

  it("denies write routes without lich.write (403)", async () => {
    const app = makeApp("limited:tok:lich.read");
    const res = await app.request("/api/modules/lich/publish", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ character: "fisternar", room_id: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /publish stores state; GET /status/:char returns it; unknown char 404s", async () => {
    const app = makeApp("limited:tok:lich.read,lich.write");
    const pub = await app.request("/api/modules/lich/publish", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", room_id: 555 }),
    });
    expect(pub.status).toBe(200);
    expect((await pub.json()) as { ok: boolean }).toEqual({ ok: true });

    const got = await app.request("/api/modules/lich/status/fisternar", { headers: auth });
    expect(got.status).toBe(200);
    const state = (await got.json()) as { character: string; room_id: number; ts: number };
    expect(state.character).toBe("fisternar");
    expect(state.room_id).toBe(555);
    expect(state.ts).toBeGreaterThan(0);

    const missing = await app.request("/api/modules/lich/status/ghost", { headers: auth });
    expect(missing.status).toBe(404);
  });

  it("GET /watchdog reports gameUp + per-char online/ageSec from the managed list", async () => {
    const kv = new InMemoryKV();
    const store = new LichStore(kv);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createLichModule(store, { gameProbe: async () => true }));
    registry.validate();
    const auth2 = new Auth(kv);
    auth2.loadFromEnv("admin:tok:*");
    const app = createApp({ registry, kv, db, auth: auth2, eventBus: new EventBus() });

    await kv.set("characters:managed", JSON.stringify(["fisternar", "neleourg"]));
    await store.publish("fisternar", { room_id: 1 });
    const res = await app.request("/api/modules/lich/watchdog", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gameUp: boolean;
      checkedAt: string;
      characters: { name: string; online: boolean; lastSeen: number | null; ageSec: number | null }[];
    };
    expect(body.gameUp).toBe(true);
    expect(body.characters).toHaveLength(2);
    const fisternar = body.characters.find((c) => c.name === "fisternar");
    expect(fisternar?.online).toBe(true);
    expect(fisternar?.ageSec).toBeLessThan(1);
    const neleourg = body.characters.find((c) => c.name === "neleourg");
    expect(neleourg?.online).toBe(false);
    expect(neleourg?.lastSeen).toBeNull();
    expect(neleourg?.ageSec).toBeNull();
  });

  it("watchdog reflects game down via the injected probe", async () => {
    const app = makeApp("admin:tok:*", async () => false);
    const res = await app.request("/api/modules/lich/watchdog", { headers: auth });
    expect(((await res.json()) as { gameUp: boolean }).gameUp).toBe(false);
  });

  it("POST /commands queues; GET /commands/:char pops FIFO then reports cmd:null", async () => {
    const app = makeApp("admin:tok:*");
    const post = await app.request("/api/modules/lich/commands", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ target: "fisternar", cmd: ";invdb" }),
    });
    expect(post.status).toBe(200);
    const body = (await post.json()) as { cmdType: string };
    expect(body.cmdType).toBe("script");

    const got = await app.request("/api/modules/lich/commands/fisternar", { headers: auth });
    expect(((await got.json()) as { cmd: string }).cmd).toBe(";invdb");
    const empty = await app.request("/api/modules/lich/commands/fisternar", { headers: auth });
    expect(((await empty.json()) as { cmd: null }).cmd).toBeNull();
  });

  it("POST /commands rejects missing target/cmd (400)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/lich/commands", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ target: "", cmd: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /premium saves premium info", async () => {
    const app = makeApp("admin:tok:*");
    const post = await app.request("/api/modules/lich/premium", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", subscription: "Premium", premium_points: 42 }),
    });
    expect(post.status).toBe(200);
  });
});
