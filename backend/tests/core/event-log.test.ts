import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { EventLog } from "../../src/core/event-log.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { createLogsModule } from "../../src/modules/logs/index.js";

function makeApp(db: CoreDb, tokensEnv: string) {
  const registry = new Registry();
  registry.register(createLogsModule(new EventLog(db)));
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv(tokensEnv);
  return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
}

describe("EventLog", () => {
  it("log() appends and list() returns newest-first with filters", () => {
    const db = new CoreDb(":memory:");
    const log = new EventLog(db);
    log.log("server_start", null, "Platform started");
    log.log("char_online", "Mejora", "Character came online", "lich");
    log.log("char_online", "Buckwheet", "Character came online", "lich");

    const all = log.list({});
    expect(all.map((e) => e.type)).toEqual(["char_online", "char_online", "server_start"]);
    expect(all[0].character).toBe("Buckwheet");
    expect(all[0].source).toBe("lich");

    expect(log.list({ type: "char_online" })).toHaveLength(2);
    expect(log.list({ character: "Mejora" })).toHaveLength(1);
    expect(log.list({ limit: 1 })).toHaveLength(1);
    expect(log.list({ limit: 1, offset: 2 })[0].type).toBe("server_start");
  });

  it("prunes events older than 30 days on write", () => {
    const db = new CoreDb(":memory:");
    const log = new EventLog(db);
    log.log("old", null, "stale");
    const oldTs = Math.floor(Date.now() / 1000) - 31 * 86400;
    db.get().prepare("UPDATE events SET ts = ? WHERE type = 'old'").run(oldTs);
    log.log("fresh", null, "new");
    const rows = log.list({});
    expect(rows.map((e) => e.type)).toEqual(["fresh"]);
  });
});

describe("GET /api/logs", () => {
  it("requires logs.read and returns the event list", async () => {
    const db = new CoreDb(":memory:");
    const app = makeApp(db, "admin:tok:*");
    const res = await app.request("/api/logs", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("denies a token without logs.read", async () => {
    const db = new CoreDb(":memory:");
    const app = makeApp(db, "limited:tok:health.read");
    const res = await app.request("/api/logs", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });
});
