import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createInventoryModule } from "../../../src/modules/inventory/index.js";
import { InventoryStore } from "../../../src/modules/inventory/store.js";
import { buildInvFixture } from "../../fixtures/inv-fixture.js";

describe("inventory module routes", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gsiv-inv-routes-"));
    dbPath = join(dir, "inv.db3");
    const db = buildInvFixture();
    db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
    db.close();
  });

  const stores: InventoryStore[] = [];

  afterAll(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string) {
    const store = new InventoryStore(dbPath);
    stores.push(store);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createInventoryModule(store));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    const db = new CoreDb(":memory:");
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/inventory/summary");
    expect(res.status).toBe(401);
  });

  it("denies without inventory.read scope (403)", async () => {
    const app = makeApp("limited:tok:health.read");
    const res = await app.request("/api/modules/inventory/summary", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(403);
  });

  it("returns summary for admin", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/modules/inventory/summary", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { characters: number; items: number; totalSilver: number };
    expect(body.characters).toBe(2);
    expect(body.items).toBe(5);
  });

  it("returns search results", async () => {
    const app = makeApp("limited:tok:inventory.read");
    const res = await app.request("/api/modules/inventory/search?q=sapphire", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: string }[];
    expect(body.length).toBe(1);
    expect(body[0].item).toBe("sapphire");
  });

  it("returns bank silvers with character metadata", async () => {
    const app = makeApp("limited:tok:inventory.read");
    const res = await app.request("/api/modules/inventory/bank", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      character: string;
      bank: string;
      silvers: number;
      account: string;
      prof: string;
      level: number;
    }[];
    expect(body.length).toBeGreaterThanOrEqual(2);
    const fis = body.find((b) => b.character === "Fisternar" && b.bank === "Ta'Vaalor");
    expect(fis).toMatchObject({ silvers: 125000, account: "main", prof: "warrior", level: 100 });
  });

  it("returns resources with account", async () => {
    const app = makeApp("limited:tok:inventory.read");
    const res = await app.request("/api/modules/inventory/resources", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { character: string; account: string; favor: number }[];
    expect(body.length).toBe(2);
    expect(body[0]).toMatchObject({ character: "Fisternar", account: "main" });
  });

  it("exposes inventory routes in the OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/inventory/summary"]).toBeDefined();
    expect(spec.paths["/api/modules/inventory/search"]).toBeDefined();
  });
});

describe("inventory scheduler routes", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gsiv-inv-sched-"));
    dbPath = join(dir, "inv.db3");
    const db = buildInvFixture();
    db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
    db.close();
  });

  const stores: InventoryStore[] = [];

  afterAll(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string, exec: (cmd: string) => string) {
    const store = new InventoryStore(dbPath);
    stores.push(store);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createInventoryModule(store, { exec, scanLogsDir: dir }));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    const db = new CoreDb(":memory:");
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  const H = { Authorization: "Bearer tok" };

  it("GET /time returns server time as UTC", async () => {
    const app = makeApp("limited:tok:inventory.read", () => "");
    const res = await app.request("/api/modules/inventory/time", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: string; tz: string };
    expect(body.tz).toBe("UTC");
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
  });

  it("GET /schedule reads the timer state via exec", async () => {
    const exec = (cmd: string) => {
      if (cmd.includes("is-active")) return "active";
      if (cmd.includes("cat /etc/systemd/system/gsiv-invdb-scan.timer")) return "[Timer]\nOnCalendar=*-*-* 03:15:00\n";
      if (cmd.includes("NextElapse")) return "Tue 2026-08-12 03:15:00 UTC";
      return "";
    };
    const app = makeApp("limited:tok:inventory.read", exec);
    const res = await app.request("/api/modules/inventory/schedule", { headers: H });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, time: "03:15" });
  });

  it("GET /schedule degrades gracefully when systemctl fails", async () => {
    const app = makeApp("limited:tok:inventory.read", () => {
      throw new Error("no systemd in tests");
    });
    const res = await app.request("/api/modules/inventory/schedule", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; error: string | null };
    expect(body.enabled).toBe(false);
    expect(body.error).toContain("no systemd");
  });

  it("PUT /schedule rejects bad time", async () => {
    const app = makeApp("limited:tok:inventory.write", () => "");
    const res = await app.request("/api/modules/inventory/schedule", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ time: "25:99" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /schedule writes the timer and enables it", async () => {
    const cmds: string[] = [];
    const exec = (cmd: string) => {
      cmds.push(cmd);
      if (cmd.includes("is-active")) return "active";
      if (cmd.includes("NextElapse")) return "Wed 2026-08-13 03:30:00 UTC";
      return "";
    };
    const app = makeApp("limited:tok:inventory.write", exec);
    const res = await app.request("/api/modules/inventory/schedule", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ time: "03:30" }),
    });
    expect(res.status).toBe(200);
    const joined = cmds.join("\n");
    expect(joined).toContain("sudo cp /tmp/gsiv-invdb-scan.timer /etc/systemd/system/gsiv-invdb-scan.timer");
    expect(joined).toContain("sudo systemctl daemon-reload");
    expect(joined).toContain("sudo systemctl enable --now gsiv-invdb-scan.timer");
  });

  it("requires inventory.write for PUT /schedule and POST /scan/start (403)", async () => {
    const app = makeApp("limited:tok:inventory.read", () => "");
    const put = await app.request("/api/modules/inventory/schedule", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ time: "03:00" }),
    });
    expect(put.status).toBe(403);
    const start = await app.request("/api/modules/inventory/scan/start", { method: "POST", headers: H });
    expect(start.status).toBe(403);
  });

  it("POST /scan/start triggers the scan-all script", async () => {
    const cmds: string[] = [];
    const app = makeApp("limited:tok:inventory.write", (cmd) => {
      cmds.push(cmd);
      return "";
    });
    const res = await app.request("/api/modules/inventory/scan/start", { method: "POST", headers: H });
    expect(res.status).toBe(200);
    expect(cmds.some((c) => c.includes("invdb-scan-all.sh"))).toBe(true);
  });

  it("GET /scan/status reports running + counts + data freshness", async () => {
    const cmds: string[] = [];
    const exec = (cmd: string) => {
      cmds.push(cmd);
      if (cmd.includes("pgrep -f")) return "yes";
      return "";
    };
    const app = makeApp("limited:tok:inventory.read", exec);
    const res = await app.request("/api/modules/inventory/scan/status", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { running: boolean; chars: number; items: number; data_as_of: string | null };
    expect(body.running).toBe(true);
    expect(body.chars).toBe(2);
    expect(body.items).toBe(5);
    expect(body.data_as_of).toBe(new Date(1786000100 * 1000).toISOString());
    expect(cmds.some((c) => c.includes('pgrep -f "[i]nvdb-parallel.sh"'))).toBe(true);
  });

  it("GET /scan/status reports not running when no invdb process exists", async () => {
    const app = makeApp("limited:tok:inventory.read", () => "");
    const res = await app.request("/api/modules/inventory/scan/status", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { running: boolean };
    expect(body.running).toBe(false);
  });
});
