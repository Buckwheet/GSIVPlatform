import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { createHealerModule } from "../../../src/modules/healer/index.js";
import { HealerStore } from "../../../src/modules/healer/store.js";
import { healthModule } from "../../../src/modules/health/index.js";

describe("healer module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => db.close());

  function makeApp(tokensEnv: string, bus = new EventBus()) {
    const store = new HealerStore(new InMemoryKV());
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createHealerModule(store));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: bus });
  }

  const auth = { Authorization: "Bearer tok" };
  const json = { ...auth, "Content-Type": "application/json" };
  const post = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) });

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/healer/status");
    expect(res.status).toBe(401);
  });

  it("denies write routes without healer.write (403)", async () => {
    const app = makeApp("limited:tok:healer.read");
    const res = await post(app, "/api/modules/healer/request", { character: "Zepherus", room_id: 100 });
    expect(res.status).toBe(403);
  });

  it("register then status lists the healer (200)", async () => {
    const app = makeApp("limited:tok:healer.read,healer.write");
    const reg = await post(app, "/api/modules/healer/register", {
      character: "Healbob",
      room_id: 1234,
      prof: "Cleric",
      level: 50,
    });
    expect(reg.status).toBe(200);
    const status = await app.request("/api/modules/healer/status", { headers: auth });
    const body = (await status.json()) as { healers: { character: string; room_id: number }[]; pending: number };
    expect(body.healers).toHaveLength(1);
    expect(body.healers[0]).toEqual(expect.objectContaining({ character: "healbob", room_id: 1234 }));
    expect(body.pending).toBe(0);
  });

  it("request requires character and room_id (400)", async () => {
    const app = makeApp("limited:tok:healer.read,healer.write");
    const res = await post(app, "/api/modules/healer/request", { character: "Zepherus" });
    expect(res.status).toBe(400);
  });

  it("request → next → accept → complete flow works", async () => {
    const app = makeApp("limited:tok:healer.read,healer.write");
    await post(app, "/api/modules/healer/register", { character: "Healbob", room_id: 500 });
    const req = await post(app, "/api/modules/healer/request", { character: "Zepherus", room_id: 500, hp: 70 });
    expect(req.status).toBe(200);
    const { request_id } = (await req.json()) as { request_id: string };

    const next = await app.request("/api/modules/healer/next/healbob", { headers: auth });
    const nextBody = (await next.json()) as { target: string; request_id: string };
    expect(nextBody).toEqual({ target: "zepherus", room_id: 500, request_id });

    const accept = await post(app, "/api/modules/healer/accept", {
      request_id,
      character: "healbob",
      target: "Zepherus",
    });
    expect(accept.status).toBe(200);
    const afterAccept = await app.request("/api/modules/healer/next/healbob", { headers: auth });
    expect(await afterAccept.json()).toEqual({ target: null });

    const complete = await post(app, "/api/modules/healer/complete", {
      request_id,
      character: "healbob",
      target: "Zepherus",
    });
    expect(complete.status).toBe(200);
    const requests = await app.request("/api/modules/healer/requests", { headers: auth });
    const list = (await requests.json()) as { status: string; healer: string }[];
    expect(list[0].status).toBe("complete");
    expect(list[0].healer).toBe("healbob");
  });

  it("emits healer_update, heal_request, heal_accepted, heal_complete on the event bus", async () => {
    const bus = new EventBus();
    const events: Record<string, unknown[]> = {
      healer_update: [],
      heal_request: [],
      heal_accepted: [],
      heal_complete: [],
    };
    for (const t of Object.keys(events)) bus.on("healer", t, (p) => events[t].push(p));
    const app = makeApp("limited:tok:healer.read,healer.write", bus);

    await post(app, "/api/modules/healer/register", { character: "Healbob", room_id: 500 });
    expect(events.healer_update).toHaveLength(1);
    expect(events.healer_update[0]).toEqual(
      expect.objectContaining({ healers: [expect.objectContaining({ character: "healbob" })] }),
    );

    const req = await post(app, "/api/modules/healer/request", { character: "Zepherus", room_id: 500 });
    const { request_id } = (await req.json()) as { request_id: string };
    expect(events.heal_request).toHaveLength(1);
    expect(events.heal_request[0]).toEqual(
      expect.objectContaining({ request: expect.objectContaining({ status: "pending" }) }),
    );

    await post(app, "/api/modules/healer/accept", { request_id, character: "healbob", target: "Zepherus" });
    expect(events.heal_accepted).toHaveLength(1);
    expect(events.heal_accepted[0]).toEqual({ request_id, healer: "healbob", target: "zepherus" });

    await post(app, "/api/modules/healer/complete", {
      request_id,
      character: "healbob",
      target: "Zepherus",
      status: "complete",
    });
    expect(events.heal_complete).toHaveLength(1);
    expect(events.heal_complete[0]).toEqual({ request_id, healer: "healbob", target: "zepherus", status: "complete" });
  });

  it("exposes healer routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: auth });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/healer/status"]).toBeDefined();
    expect(spec.paths["/api/modules/healer/next/:healer"]).toBeDefined();
    expect(spec.paths["/api/modules/healer/request"]).toBeDefined();
  });
});
