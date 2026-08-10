import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { ConfigFiles } from "../../../src/core/config-files.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { LichDb } from "../../../src/core/lich-db.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { createConfigModule } from "../../../src/modules/config/index.js";
import { healthModule } from "../../../src/modules/health/index.js";

const TMP = mkdtempSync(join(tmpdir(), "config-routes-"));
const GSIV = join(TMP, "GSIV");
const GST = join(TMP, "GST");
mkdirSync(join(GSIV, "Fisternar"), { recursive: true });
mkdirSync(join(GST, "Neleourg"), { recursive: true });
writeFileSync(join(GSIV, "Fisternar", "go2.lic"), "alpha");
writeFileSync(join(GST, "Neleourg", "custom.txt"), "beta");

describe("config module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => {
    db.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string) {
    const lichDb = new LichDb(async () => ({ stdout: JSON.stringify({ delay: 1, stock: 3 }), stderr: "", code: 0 }));
    const configFiles = new ConfigFiles({ gsivDir: GSIV, gstDir: GST });
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createConfigModule(lichDb, configFiles));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  const auth = { Authorization: "Bearer tok" };
  const json = { ...auth, "Content-Type": "application/json" };

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    expect((await app.request("/api/modules/config/config/fisternar")).status).toBe(401);
  });

  it("denies write routes without config.write (403)", async () => {
    const app = makeApp("limited:tok:config.read");
    const res = await app.request("/api/modules/config/config/fisternar/file", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ path: "go2.lic", content: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("lists and reads config files", async () => {
    const app = makeApp("limited:tok:config.read");
    const list = await app.request("/api/modules/config/config/fisternar", { headers: auth });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { files: { path: string }[] };
    expect(body.files.map((f) => f.path)).toEqual(["go2.lic"]);

    const read = await app.request("/api/modules/config/config/fisternar/file?path=go2.lic", { headers: auth });
    expect(read.status).toBe(200);
    expect((await read.json()) as { content: string }).toEqual({
      character: "fisternar",
      file: "go2.lic",
      content: "alpha",
    });
    const missing = await app.request("/api/modules/config/config/fisternar/file?path=nope.txt", { headers: auth });
    expect(missing.status).toBe(404);
  });

  it("rejects path traversal (400) and writes with backup (200)", async () => {
    const app = makeApp("limited:tok:config.read,config.write");
    const evil = await app.request("/api/modules/config/config/fisternar/file?path=../evil", { headers: auth });
    expect(evil.status).toBe(400);

    const put = await app.request("/api/modules/config/config/fisternar/file", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ path: "go2.lic", content: "omega" }),
    });
    expect(put.status).toBe(200);
    expect(readFileSync(join(GSIV, "Fisternar", "go2.lic"), "utf-8")).toBe("omega");
  });

  it("copy-from copies files between characters", async () => {
    const app = makeApp("limited:tok:config.read,config.write");
    const res = await app.request("/api/modules/config/config/neleourg/copy-from/fisternar", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ files: ["go2.lic"] }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { copied: string[] }).copied).toEqual(["go2.lic"]);
    expect(readFileSync(join(GST, "Neleourg", "go2.lic"), "utf-8")).toBe("omega");
  });

  it("go2/eherbs get returns settings; put writes", async () => {
    const app = makeApp("limited:tok:config.read,config.write");
    const get = await app.request("/api/modules/config/go2/fisternar", { headers: auth });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ delay: 1, stock: 3 });
    const put = await app.request("/api/modules/config/go2/fisternar", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ delay: 5 }),
    });
    expect(put.status).toBe(200);
    const eherbs = await app.request("/api/modules/config/eherbs/neleourg", { headers: auth });
    expect(await eherbs.json()).toEqual({ delay: 1, stock: 3 });
  });

  it("exposes config routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: auth });
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/config/config/:char"]).toBeDefined();
    expect(spec.paths["/api/modules/config/go2/:char"]).toBeDefined();
    expect(spec.paths["/api/modules/config/eherbs/:char"]).toBeDefined();
    expect(spec.paths["/api/modules/config/config/:char/copy-from/:source"]).toBeDefined();
  });
});
