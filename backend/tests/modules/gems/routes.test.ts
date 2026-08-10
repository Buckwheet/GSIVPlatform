import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { createGemsModule } from "../../../src/modules/gems/index.js";
import { GemsStore } from "../../../src/modules/gems/store.js";
import { healthModule } from "../../../src/modules/health/index.js";

describe("gems module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => db.close());

  function makeApp(tokensEnv: string, bus = new EventBus()) {
    const store = new GemsStore(new InMemoryKV());
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createGemsModule(store));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: bus });
  }

  const auth = { Authorization: "Bearer tok" };

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/gems/jars");
    expect(res.status).toBe(401);
  });

  it("denies write routes without gems.write (403)", async () => {
    const app = makeApp("limited:tok:gems.read");
    const res = await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", full_jars: [], full_jar_count: 0 }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /jars and GET /jars/:char work with gems.read", async () => {
    const app = makeApp("limited:tok:gems.read");
    const list = await app.request("/api/modules/gems/jars", { headers: auth });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
    const single = await app.request("/api/modules/gems/jars/Fisternar", { headers: auth });
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ character: "fisternar", full_jars: [], full_jar_count: 0, ts: 0 });
  });

  it("POST /jars publishes a status visible on GET (200 + 400 for missing character)", async () => {
    const app = makeApp("limited:tok:gems.read,gems.write");
    const res = await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        character: "Fisternar",
        full_jars: [{ id: 123, type: "uncut emeralds", portions: 10 }],
        full_jar_count: 1,
      }),
    });
    expect(res.status).toBe(200);
    const got = await app.request("/api/modules/gems/jars/fisternar", { headers: auth });
    const body = (await got.json()) as { character: string; full_jars: unknown[]; full_jar_count: number; ts: number };
    expect(body.character).toBe("fisternar");
    expect(body.full_jars).toEqual([{ id: 123, type: "uncut emeralds", portions: 10 }]);
    expect(body.full_jar_count).toBe(1);
    expect(body.ts).toBeGreaterThan(0);

    const missing = await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ full_jars: [] }),
    });
    expect(missing.status).toBe(400);
  });
  it("claim returns 404 without jar data, then 200 with write scope and sets responder", async () => {
    const app = makeApp("limited:tok:gems.read,gems.write");
    const noData = await app.request("/api/modules/gems/jars/claim", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ holder: "ghost", responder: "Neleourg" }),
    });
    expect(noData.status).toBe(404);

    await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", full_jars: [], full_jar_count: 1 }),
    });
    const claim = await app.request("/api/modules/gems/jars/claim", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ holder: "Fisternar", responder: "Neleourg" }),
    });
    expect(claim.status).toBe(200);
    const claimed = (await claim.json()) as { holder: string; responder: string };
    expect(claimed).toEqual({ ok: true, holder: "fisternar", responder: "neleourg" });

    const got = await app.request("/api/modules/gems/jars/fisternar", { headers: auth });
    const body = (await got.json()) as { responder: string; claimed_at: number };
    expect(body.responder).toBe("neleourg");
    expect(body.claimed_at).toBeGreaterThan(0);
  });

  it("clear removes jar data (200)", async () => {
    const app = makeApp("limited:tok:gems.read,gems.write");
    await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", full_jars: [], full_jar_count: 2 }),
    });
    const clear = await app.request("/api/modules/gems/jars/clear", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "fisternar" }),
    });
    expect(clear.status).toBe(200);
    const got = await app.request("/api/modules/gems/jars/fisternar", { headers: auth });
    expect((await got.json()) as { full_jar_count: number }).toEqual(
      expect.objectContaining({ full_jars: [], full_jar_count: 0 }),
    );
  });

  it("queue join/status/next/done work and dedupe", async () => {
    const app = makeApp("limited:tok:gems.read,gems.write");
    const join = async (service: string, character: string) =>
      app.request(`/api/modules/gems/queue/join`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ service, character }),
      });

    const first = await join("gembank", "Zepherus");
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true, position: 0 });
    const second = await join("gembank", "Arli");
    expect(await second.json()).toEqual({ ok: true, position: 1 });
    const dup = await join("gembank", "zepherus");
    expect(dup.status).toBe(200);
    expect(await dup.json()).toEqual({ position: "already_queued" });

    const status = await app.request("/api/modules/gems/queue/status/gembank", { headers: auth });
    expect(await status.json()).toEqual(["zepherus", "arli"]);

    const next = await app.request("/api/modules/gems/queue/next/gembank", { headers: auth });
    expect(await next.json()).toEqual({ next: "zepherus" });

    const done = await app.request("/api/modules/gems/queue/done", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ service: "gembank", character: "Zepherus" }),
    });
    expect(done.status).toBe(200);
    const after = await app.request("/api/modules/gems/queue/next/gembank", { headers: auth });
    expect(await after.json()).toEqual({ next: "arli" });
  });
  it("emits jars_update and queue_update on the event bus", async () => {
    const bus = new EventBus();
    const jarEvents: unknown[] = [];
    const queueEvents: unknown[] = [];
    bus.on("gems", "jars_update", (p) => jarEvents.push(p));
    bus.on("gems", "queue_update", (p) => queueEvents.push(p));
    const app = makeApp("limited:tok:gems.write", bus);

    await app.request("/api/modules/gems/jars", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ character: "Fisternar", full_jars: [], full_jar_count: 3 }),
    });
    expect(jarEvents).toHaveLength(1);
    expect(jarEvents[0]).toEqual(
      expect.objectContaining({ character: "fisternar", data: expect.objectContaining({ full_jar_count: 3 }) }),
    );

    await app.request("/api/modules/gems/queue/join", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ service: "gembank", character: "Zepherus" }),
    });
    expect(queueEvents).toHaveLength(1);
    expect(queueEvents[0]).toEqual({ service: "gembank", queue: ["zepherus"] });
  });

  it("exposes gems routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: auth });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/gems/jars"]).toBeDefined();
    expect(spec.paths["/api/modules/gems/jars/claim"]).toBeDefined();
    expect(spec.paths["/api/modules/gems/queue/status/:service"]).toBeDefined();
  });
});
