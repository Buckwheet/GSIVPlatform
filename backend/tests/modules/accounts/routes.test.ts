import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOTP as OTPAuthTOTP, Secret } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../../../src/core/auth.js";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { Registry } from "../../../src/core/registry.js";
import { Ruby } from "../../../src/core/ruby.js";
import { createApp } from "../../../src/core/server.js";
import { Sge } from "../../../src/core/sge.js";
import { Totp } from "../../../src/core/totp.js";
import { EventBus } from "../../../src/core/ws.js";
import { createAccountsModule } from "../../../src/modules/accounts/index.js";
import { AccountsStore } from "../../../src/modules/accounts/store.js";
import { healthModule } from "../../../src/modules/health/index.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");
const TMP = mkdtempSync(join(tmpdir(), "accounts-routes-"));
const ENTRY_YAML = join(TMP, "entry.yaml");
const TOTP_SECRET = join(TMP, "totp_secret");
copyFileSync(FIXTURE, ENTRY_YAML);

describe("accounts module routes", () => {
  let db: CoreDb;

  beforeAll(() => {
    db = new CoreDb(":memory:");
  });
  afterAll(() => {
    db.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  function makeApp(tokensEnv: string, rubyOverride?: Ruby) {
    const ruby = rubyOverride ?? new Ruby(async () => ({ stdout: "ENC:fake", stderr: "", code: 0 }));
    const sge = new Sge((_h, _p, _onData, onError) => {
      setImmediate(() => onError(new Error("no network")));
      return { write: () => {}, destroy: () => {} };
    });
    const store = new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, { delayMs: 0 });
    const totp = new Totp(TOTP_SECRET);
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createAccountsModule(store, totp));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });
  }

  function currentCode(secret: string): string {
    return new OTPAuthTOTP({ secret: Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 }).generate();
  }

  async function ensureSecret(app: ReturnType<typeof makeApp>): Promise<string> {
    const status = await app.request("/api/modules/accounts/totp/status", { headers: auth });
    if (!((await status.json()) as { setup: boolean }).setup) {
      await post(app, "/api/modules/accounts/totp/setup", {});
    }
    return readFileSync(TOTP_SECRET, "utf-8").trim();
  }

  const auth = { Authorization: "Bearer tok" };
  const json = { ...auth, "Content-Type": "application/json" };
  const post = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) });

  it("requires auth (401)", async () => {
    const app = makeApp("admin:tok:*");
    expect((await app.request("/api/modules/accounts/accounts")).status).toBe(401);
  });

  it("denies write routes without accounts.write (403)", async () => {
    const app = makeApp("limited:tok:accounts.read");
    expect((await post(app, "/api/modules/accounts/accounts/scan", {})).status).toBe(403);
  });

  it("GET /accounts returns the (empty) scan list", async () => {
    const app = makeApp("limited:tok:accounts.read");
    const res = await app.request("/api/modules/accounts/accounts", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [], characters: [] });
  });

  it("totp setup/status/verify flow works", async () => {
    new Totp(TOTP_SECRET).reset();
    const app = makeApp("limited:tok:accounts.read,accounts.write");
    expect(await (await app.request("/api/modules/accounts/totp/status", { headers: auth })).json()).toEqual({
      setup: false,
    });

    const setup = await post(app, "/api/modules/accounts/totp/setup", {});
    expect(setup.status).toBe(200);
    const { secret } = (await setup.json()) as { secret: string };

    expect((await app.request("/api/modules/accounts/totp/status", { headers: auth })).json).toBeDefined();
    const ok = await post(app, "/api/modules/accounts/totp/verify", { code: currentCode(secret) });
    expect(await ok.json()).toEqual({ valid: true });
    const bad = await post(app, "/api/modules/accounts/totp/verify", { code: "000000" });
    expect(await bad.json()).toEqual({ valid: false });
  });

  it("entry mutations require TOTP setup and a valid code (403s)", async () => {
    new Totp(TOTP_SECRET).reset();
    const app = makeApp("limited:tok:accounts.read,accounts.write");
    // no TOTP setup yet
    const noSetup = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "X",
      password: "pw",
      totp_code: "",
    });
    expect(noSetup.status).toBe(403);
    expect((await noSetup.json()) as { error: string }).toEqual({ error: "2FA not configured — set up TOTP first" });

    const secret = await ensureSecret(app);
    const wrong = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "X",
      password: "pw",
      totp_code: "000000",
    });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()) as { error: string }).toEqual({ error: "invalid TOTP code" });

    const ok = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "NEWACCT",
      password: "pw",
      totp_code: currentCode(secret),
    });
    expect(ok.status).toBe(200);
  });

  it("adds a duplicate account (409), add/delete characters, delete account (steps)", async () => {
    const app = makeApp("limited:tok:accounts.read,accounts.write");
    const secret = await ensureSecret(app);
    const code = currentCode(secret);
    const dup = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "BUCKWHEET",
      password: "pw",
      totp_code: code,
    });
    expect(dup.status).toBe(409);

    const addChar = await post(app, "/api/modules/accounts/entry/account/BUCKWHEET/character", {
      char_name: "Newchar",
      game_code: "GS3",
      totp_code: code,
    });
    expect(addChar.status).toBe(200);
    const dupChar = await post(app, "/api/modules/accounts/entry/account/BUCKWHEET/character", {
      char_name: "newchar",
      totp_code: code,
    });
    expect(dupChar.status).toBe(409);

    const delChar = await app.request("/api/modules/accounts/entry/account/BUCKWHEET/character/newchar", {
      method: "DELETE",
      headers: json,
      body: JSON.stringify({ totp_code: code }),
    });
    expect(delChar.status).toBe(200);
    const steps = ((await delChar.json()) as { steps: { result: string }[] }).steps;
    expect(steps.map((st) => st.result)).toEqual(["ok", "not found"]);

    const delAcct = await app.request("/api/modules/accounts/entry/account/BUCKWHEET", {
      method: "DELETE",
      headers: json,
      body: JSON.stringify({ totp_code: code }),
    });
    expect(delAcct.status).toBe(200);
    expect(((await delAcct.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("scan routes work with a write token (background; lock released)", async () => {
    copyFileSync(FIXTURE, ENTRY_YAML);
    const app = makeApp("limited:tok:accounts.read,accounts.write");
    const res = await post(app, "/api/modules/accounts/accounts/scan", {});
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean; total: number }).toEqual(
      expect.objectContaining({ ok: true, total: 2 }),
    );
    await new Promise((r) => setTimeout(r, 50));
    const status = await app.request("/api/modules/accounts/accounts/scan/status", { headers: auth });
    expect(((await status.json()) as { running: boolean }).running).toBe(false);
  });

  it("totp/reset requires a valid code and clears the secret", async () => {
    const app = makeApp("limited:tok:accounts.read,accounts.write");
    const secret = await ensureSecret(app);
    const bad = await post(app, "/api/modules/accounts/totp/reset", { code: "000000" });
    expect(bad.status).toBe(403);
    const ok = await post(app, "/api/modules/accounts/totp/reset", { code: currentCode(secret) });
    expect(ok.status).toBe(200);
    expect((await app.request("/api/modules/accounts/totp/status", { headers: auth })).json).toBeDefined();
    const status = await app.request("/api/modules/accounts/totp/status", { headers: auth });
    expect((await status.json()) as { setup: boolean }).toEqual({ setup: false });
  });

  it("maps a password-encryption failure to 500 (not 409)", async () => {
    const failingRuby = new Ruby(async () => ({ stdout: "", stderr: "No such file", code: 1 }));
    const app = makeApp("limited:tok:accounts.read,accounts.write", failingRuby);
    const secret = await ensureSecret(app);
    const res = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "NEWACCT",
      password: "pw",
      totp_code: currentCode(secret),
    });
    expect(res.status).toBe(500);
    const missing = await post(app, "/api/modules/accounts/entry/account", {
      account_name: "BUCKWHEET",
      password: "pw",
      totp_code: currentCode(secret),
    });
    expect(missing.status).toBe(500);
  });

  it("exposes accounts routes in OpenAPI spec", async () => {
    const app = makeApp("admin:tok:*");
    const res = await app.request("/api/spec", { headers: auth });
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/modules/accounts/accounts"]).toBeDefined();
    expect(spec.paths["/api/modules/accounts/entry/account/:name/character"]).toBeDefined();
  });

  it("GET /accounts/stale requires auth and read scope", async () => {
    const app = makeApp("limited:tok:accounts.read");
    expect((await app.request("/api/modules/accounts/accounts/stale")).status).toBe(401);
    const res = await app.request("/api/modules/accounts/accounts/stale", { headers: auth });
    expect(res.status).toBe(200);
  });

  it("GET /accounts/stale returns entry_only chars and problem accounts", async () => {
    copyFileSync(FIXTURE, ENTRY_YAML);
    const ruby = new Ruby(async () => ({ stdout: "PLAINTEXT", stderr: "", code: 0 }));
    const sge = new Sge((_h, _p, onData, _onError) => {
      const chunks = ["MASK", "A\tKEY=abc", "M", "N", "G", "C\t1\tGS3\t1\t2\t1\tZepherus"];
      let i = 0;
      const deliver = (idx: number) => {
        if (idx < chunks.length) setImmediate(() => onData(Buffer.from(chunks[idx], "binary")));
      };
      deliver(0);
      return {
        write: () => {
          i += 1;
          deliver(i);
        },
        destroy: () => {},
      };
    });
    const store = new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, { delayMs: 0 });
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createAccountsModule(store, new Totp(TOTP_SECRET)));
    registry.validate();
    const appAuth = new Auth(new InMemoryKV());
    appAuth.loadFromEnv("limited:tok:accounts.read");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth: appAuth, eventBus: new EventBus() });

    await store.scanOne("BUCKWHEET");
    const res = await app.request("/api/modules/accounts/accounts/stale", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { account_name: string; char_name: string; status: string }[];
      accounts: { account_name: string; auth_status: string }[];
    };
    const buckwheet = body.characters.filter((c) => c.account_name === "BUCKWHEET");
    expect(buckwheet.map((c) => c.char_name).sort()).toEqual(["Fisternar"]);
    expect(buckwheet.every((c) => c.status === "entry_only")).toBe(true);
    expect(Array.isArray(body.accounts)).toBe(true);
  });
});
