import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalysisFiles } from "../../../src/core/analysis-files.js";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { ScriptRunner } from "../../../src/core/script-runner.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { createAnalysisModule } from "../../../src/modules/analysis/index.js";
import { healthModule } from "../../../src/modules/health/index.js";

const TMP = mkdtempSync(join(tmpdir(), "analysis-routes-"));
const DATA = join(TMP, "data");
const LOGS = join(TMP, "logs");
mkdirSync(DATA, { recursive: true });
mkdirSync(join(LOGS, "GSIV-Fisternar"), { recursive: true });
writeFileSync(join(DATA, "analysis-output.txt"), "out");
writeFileSync(join(LOGS, "GSIV-Fisternar", "game.log"), "l1\nl2\nl3");

describe("analysis module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => {
    db.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string) {
    const analysisFiles = new AnalysisFiles({ dataDir: DATA, logDir: LOGS });
    const runner = new ScriptRunner(async () => ({ stdout: "", stderr: "", code: 0 }), { dataDir: DATA });
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createAnalysisModule(analysisFiles, runner));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  const auth = { Authorization: "Bearer tok" };

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    expect((await app.request("/api/modules/analysis/analysis")).status).toBe(401);
  });

  it("denies write routes without analysis.write (403)", async () => {
    const app = makeApp("limited:tok:analysis.read");
    expect((await app.request("/api/modules/analysis/analysis/run", { method: "POST", headers: auth })).status).toBe(
      403,
    );
  });

  it("GET /analysis returns output/status/usage; history returns the array", async () => {
    const app = makeApp("limited:tok:analysis.read");
    const res = await app.request("/api/modules/analysis/analysis", { headers: auth });
    expect(res.status).toBe(200);
    expect((await res.json()) as { output: string }).toEqual(expect.objectContaining({ output: "out" }));
    const hist = await app.request("/api/modules/analysis/analysis/history", { headers: auth });
    expect(await hist.json()).toEqual([]);
  });

  it("POST run/loop return started", async () => {
    const app = makeApp("limited:tok:analysis.read,analysis.write");
    const run = await app.request("/api/modules/analysis/analysis/run", { method: "POST", headers: auth });
    expect(run.status).toBe(200);
    expect((await run.json()) as { ok: boolean }).toEqual(expect.objectContaining({ ok: true }));
    const loop = await app.request("/api/modules/analysis/analysis/loop", { method: "POST", headers: auth });
    expect(loop.status).toBe(200);
  });

  it("POST upload stores a .log file and rejects non-.log", async () => {
    const app = makeApp("limited:tok:analysis.read,analysis.write");
    const form = new FormData();
    form.append("file", new File([Buffer.from("combat-data")], "combat.log"));
    form.append("character", "Fisternar");
    const ok = await app.request("/api/modules/analysis/analysis/upload", {
      method: "POST",
      headers: auth,
      body: form,
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { size: number }).size).toBe(11);

    const bad = new FormData();
    bad.append("file", new File([Buffer.from("x")], "notes.txt"));
    bad.append("character", "Fisternar");
    const reject = await app.request("/api/modules/analysis/analysis/upload", {
      method: "POST",
      headers: auth,
      body: bad,
    });
    expect(reject.status).toBe(400);
  });

  it("GET /logs/game/:char tails the latest log", async () => {
    const app = makeApp("limited:tok:analysis.read");
    const res = await app.request("/api/modules/analysis/analysis/logs/game/fisternar?lines=2", { headers: auth });
    expect(res.status).toBe(200);
    expect((await res.json()) as { lines: string[] }).toEqual({ lines: ["l2", "l3"], file: "game.log" });
  });

  it("exposes analysis routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: auth });
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/analysis/analysis"]).toBeDefined();
    expect(spec.paths["/api/modules/analysis/analysis/upload"]).toBeDefined();
    expect(spec.paths["/api/modules/analysis/analysis/logs/game/:char"]).toBeDefined();
  });
});
