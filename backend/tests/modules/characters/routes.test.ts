import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { type ExecFn, Systemd } from "../../../src/core/systemd.js";
import { EventBus } from "../../../src/core/ws.js";
import { createCharactersModule } from "../../../src/modules/characters/index.js";
import { CharactersStore } from "../../../src/modules/characters/store.js";
import { healthModule } from "../../../src/modules/health/index.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");

describe("characters module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => db.close());

  function makeApp(tokensEnv: string, exec: ExecFn) {
    const systemd = new Systemd(exec, { sudoActions: false });
    const store = new CharactersStore(new InMemoryKV(), new EntryYaml(FIXTURE), systemd);
    store.seedManagedIfEmpty();
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createCharactersModule(store));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  const auth = { Authorization: "Bearer tok" };
  const okExec: ExecFn = async () => ({ stdout: "ActiveState=active\nSubState=running", stderr: "", code: 0 });

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*", okExec);
    const res = await app.request("/api/modules/characters/characters");
    expect(res.status).toBe(401);
  });

  it("denies write routes without characters.write (403)", async () => {
    const app = makeApp("limited:tok:characters.read", okExec);
    const res = await app.request("/api/modules/characters/characters/fisternar/start", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(403);
  });

  it("GET /characters lists fixture chars with status and managed flag", async () => {
    const app = makeApp("limited:tok:characters.read", okExec);
    const res = await app.request("/api/modules/characters/characters", { headers: auth });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { char_name: string; managed: boolean; active: boolean; sub: string }[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(
      expect.objectContaining({ char_name: "Fisternar", managed: true, active: true, sub: "running" }),
    );
  });

  it("GET /characters/:name returns a row or 404", async () => {
    const app = makeApp("limited:tok:characters.read", okExec);
    const ok = await app.request("/api/modules/characters/characters/fisternar", { headers: auth });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { char_name: string }).char_name).toBe("Fisternar");
    const missing = await app.request("/api/modules/characters/characters/ghost", { headers: auth });
    expect(missing.status).toBe(404);
  });

  it("start/stop/restart work with characters.write; unknown char 404s", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const exec: ExecFn = async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    };
    const app = makeApp("limited:tok:characters.read,characters.write", exec);

    const start = await app.request("/api/modules/characters/characters/fisternar/start", {
      method: "POST",
      headers: auth,
    });
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ ok: true });

    const stop = await app.request("/api/modules/characters/characters/fisternar/stop", {
      method: "POST",
      headers: auth,
    });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ ok: true, was_managed: true });

    const restart = await app.request("/api/modules/characters/characters/zepherus/restart", {
      method: "POST",
      headers: auth,
    });
    expect(restart.status).toBe(200);

    expect(records).toEqual([
      { cmd: "systemctl", args: ["start", "gs4sd-lich@Fisternar.service"] },
      { cmd: "systemctl", args: ["stop", "gs4sd-lich@Fisternar.service"] },
      { cmd: "systemctl", args: ["restart", "gs4sd-lich@Zepherus.service"] },
    ]);

    const unknown = await app.request("/api/modules/characters/characters/ghost/start", {
      method: "POST",
      headers: auth,
    });
    expect(unknown.status).toBe(404);
    expect(records).toHaveLength(3);
  });

  it("maps a systemd failure to 500 with the error", async () => {
    const app = makeApp("limited:tok:characters.read,characters.write", async () => ({
      stdout: "",
      stderr: "Failed to start unit",
      code: 1,
    }));
    const res = await app.request("/api/modules/characters/characters/fisternar/start", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Failed to start unit" });
  });

  it("exposes characters routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*", okExec);
    const res = await app.request("/api/spec", { headers: auth });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/characters/characters"]).toBeDefined();
    expect(spec.paths["/api/modules/characters/characters/:name/start"]).toBeDefined();
    expect(spec.paths["/api/modules/characters/characters/:name/stop"]).toBeDefined();
  });
});
