import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { createApp } from "../../../src/core/server.js";
import { EventBus } from "../../../src/core/ws.js";
import { healthModule } from "../../../src/modules/health/index.js";
import { createScansModule } from "../../../src/modules/scans/index.js";
import { type CharFailureClassifier, ScansStore } from "../../../src/modules/scans/store.js";

const H = { Authorization: "Bearer tok" };
const dir = mkdtempSync(join(tmpdir(), "gsiv-scans-routes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeApp(tokensEnv: string, exec: (cmd: string) => string = () => "") {
  const db = new CoreDb(":memory:");
  const runner = {
    async scanChar(char: string) {
      return { char, result: "done" as const };
    },
  };
  const yamlPath = join(dir, "entry.yaml");
  writeFileSync(yamlPath, "accounts: {}\n"); // valid empty roster
  const yaml = new EntryYaml(yamlPath);
  const store = new ScansStore(
    db,
    yaml,
    runner,
    () => {},
    () => {},
    { okAccounts: () => [] },
  );
  const registry = new Registry();
  registry.register(healthModule);
  registry.register(createScansModule(store, { exec }));
  registry.validate();
  const auth = new Auth(new InMemoryKV());
  auth.loadFromEnv(tokensEnv);
  return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
}

describe("scans module routes", () => {
  it("GET /time returns UTC server time", async () => {
    const app = makeApp("limited:tok:scans.read");
    const res = await app.request("/api/modules/scans/time", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: string; tz: string };
    expect(body.tz).toBe("UTC");
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
  });

  it("GET /schedule reads timer state via exec", async () => {
    const exec = (cmd: string) => {
      if (cmd.includes("is-active")) return "active";
      if (cmd.includes("cat /etc/systemd/system/gsiv-invdb-scan.timer")) return "[Timer]\nOnCalendar=*-*-* 03:15:00\n";
      return "";
    };
    const app = makeApp("limited:tok:scans.read", exec);
    const res = await app.request("/api/modules/scans/schedule", { headers: H });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, time: "03:15" });
  });

  it("requires scans.write for POST /scan (403)", async () => {
    const app = makeApp("limited:tok:scans.read");
    const res = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("POST /scan with no targets returns 409 (clear error, not a crash)", async () => {
    const app = makeApp("limited:tok:scans.write");
    const res = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("no scan targets");
  });

  it("exposes scans routes in the OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: H });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/scans/scan"]).toBeDefined();
    expect(spec.paths["/api/modules/scans/scan/status"]).toBeDefined();
  });

  it("GET /scan/history includes per-char failure detail after a failing scan", async () => {
    const db = new CoreDb(":memory:");
    const yamlPath = join(dir, "entry-fail.yaml");
    writeFileSync(
      yamlPath,
      "accounts:\n  Buckwheet:\n    characters:\n      - char_name: Fisternar\n        game_code: GSIV\n",
    );
    const yaml = new EntryYaml(yamlPath);
    const runner = {
      async scanChar(char: string) {
        return { char, result: "failed" as const, error: "boom" };
      },
    };
    const classifier: CharFailureClassifier = {
      async refreshAndClassify(_account, failed) {
        return failed.map((f) => ({ ...f, code: "start_failed", reason: "systemd start failed: boom" }));
      },
    };
    const store = new ScansStore(
      db,
      yaml,
      runner,
      () => {},
      () => {},
      {
        okAccounts: () => ["BUCKWHEET"],
        classifier,
      },
    );
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createScansModule(store, { exec: () => "" }));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("limited:tok:scans.read,scans.write");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });

    const start = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(start.status).toBe(200);
    await store.whenIdle();

    const res = await app.request("/api/modules/scans/scan/history", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobs: {
        accounts: {
          account_name: string;
          chars: { char_name: string; result: string; code: string; reason: string | null }[];
        }[];
      }[];
    };
    const acct = body.jobs[0].accounts.find((a) => a.account_name === "BUCKWHEET");
    expect(acct?.chars).toEqual([
      { char_name: "Fisternar", result: "failed", code: "start_failed", reason: "systemd start failed: boom" },
    ]);
  });
});
