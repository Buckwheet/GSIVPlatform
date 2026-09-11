import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createUpdatesModule } from "../../../src/modules/updates/index.js";
import { UpdatesStore } from "../../../src/modules/updates/store.js";

interface NotifResponse {
  total: number;
  unread: number;
  notifications: { id: number; tag: string; url: string; acknowledged_at: string | null }[];
  status: { current: string | null; latest: string | null; updateAvailable: boolean };
}

describe("updates module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => {
    db.close();
  });

  function makeApp(tokensEnv: string, currentVersion = "0.3.0-beta.37") {
    const store = new UpdatesStore(db, { currentVersion, now: () => new Date("2026-09-11T12:00:00.000Z") });
    store.applyReleases([
      {
        tag: "v0.3.0-beta.50",
        url: "https://github.com/Nisugi/VellumFE/releases/tag/v0.3.0-beta.50",
        published_at: null,
      },
    ]);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createUpdatesModule(store));
    registry.validate(); // would throw on an unused/unmapped scope
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  const auth = { Authorization: "Bearer tok" };

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/updates/notifications");
    expect(res.status).toBe(401);
  });

  it("denies read without updates.read (403)", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/updates/notifications", { headers: auth });
    expect(res.status).toBe(403);
  });

  it("GET /notifications reports the version status + the unread release for updates.read", async () => {
    const app = makeApp("limited:tok:updates.read");
    const res = await app.request("/api/modules/updates/notifications", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NotifResponse;
    expect(body.status).toMatchObject({ current: "0.3.0-beta.37", latest: "v0.3.0-beta.50", updateAvailable: true });
    expect(body.notifications.map((n) => n.tag)).toContain("v0.3.0-beta.50");
    expect(body.unread).toBeGreaterThan(0);
  });

  it("reports no update available when the deployed version is current", async () => {
    const app = makeApp("admin:tok:*", "0.3.0-beta.50");
    const res = await app.request("/api/modules/updates/notifications", { headers: auth });
    const body = (await res.json()) as NotifResponse;
    expect(body.status).toMatchObject({ current: "0.3.0-beta.50", latest: "v0.3.0-beta.50", updateAvailable: false });
  });

  it("denies ack without updates.write (403) but allows it with it", async () => {
    const denied = makeApp("limited:tok:updates.read");
    const res = await denied.request("/api/modules/updates/notifications/ack", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);

    const allowed = makeApp("limited:tok:updates.read,updates.write");
    const ok = await allowed.request("/api/modules/updates/notifications/ack", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, acked: expect.any(Number) });
  });
});
