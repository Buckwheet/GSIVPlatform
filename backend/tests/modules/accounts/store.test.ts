import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import type { InvDbCleaner } from "../../../src/core/inv-db.js";
import { Ruby } from "../../../src/core/ruby.js";
import { Sge } from "../../../src/core/sge.js";
import { AccountsStore } from "../../../src/modules/accounts/store.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");
const TMP = mkdtempSync(join(tmpdir(), "acct-store-"));
let storeYamlCounter = 0;
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function okRuby(): Ruby {
  return new Ruby(async () => ({ stdout: "PLAINTEXT", stderr: "", code: 0 }));
}

function failingRuby(): Ruby {
  return new Ruby(async () => ({ stdout: "", stderr: "cannot load entry.yaml", code: 1 }));
}

function sgeError(error: Error): Sge {
  return new Sge((_h, _p, _onData, onError) => {
    setImmediate(() => onError(error));
    return { write: () => {}, destroy: () => {} };
  });
}

function sgeOk(chars: { slot: string; name: string }[]): Sge {
  const fields = chars
    .flatMap((c) => [`${c.slot}`, c.name])
    .join("  SEP  ")
    .split("  SEP  ");
  const body = `C\t1\tGS3\t1\t2\t${fields.join("\t")}`;
  const chunks = ["MASK", "A\tKEY=abc", "M", "N", "G", body];
  return new Sge((_h, _p, onData, _onError) => {
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
}

class FakeInvDb implements InvDbCleaner {
  deletedAccounts: string[] = [];
  deletedCharacters: { name: string; account: string }[] = [];
  deleteAccounts(accounts: string[]) {
    this.deletedAccounts.push(...accounts);
    return { ok: true, removedCharacters: accounts.length, removedItems: 0 };
  }
  deleteCharacters(targets: { name: string; account: string }[]) {
    this.deletedCharacters.push(...targets);
    return { ok: true, removedCharacters: targets.length, removedItems: 0 };
  }
}

describe("AccountsStore", () => {
  function makeStore(
    overrides: {
      yaml?: EntryYaml;
      ruby?: Ruby;
      sge?: Sge;
      invDb?: InvDbCleaner;
      delayMs?: number;
      emit?: (type: string, payload: unknown) => void;
      log?: (type: string, char: string | null, detail: string, source: string) => void;
    } = {},
  ) {
    const db = new CoreDb(":memory:");
    const yamlPath = join(TMP, `entry-${++storeYamlCounter}.yaml`);
    copyFileSync(FIXTURE, yamlPath);
    const emitted: { type: string; payload: unknown }[] = [];
    const logged: string[] = [];
    const store = new AccountsStore(
      db,
      overrides.yaml ?? new EntryYaml(yamlPath),
      overrides.ruby ?? okRuby(),
      overrides.sge ?? sgeError(new Error("no network")),
      overrides.invDb ?? new FakeInvDb(),
      {
        delayMs: overrides.delayMs ?? 0,
        emit: overrides.emit ?? ((type, payload) => emitted.push({ type, payload })),
        log: overrides.log ?? ((type, _c, detail) => logged.push(`${type}:${detail}`)),
      },
    );
    return { db, store, emitted, logged };
  }

  it("migrates the scan tables; list() is empty on a fresh db", async () => {
    const { store } = makeStore();
    const list = await store.list();
    expect(list.accounts).toEqual([]);
    expect(list.characters).toEqual([]);
  });

  it("scanOne on an unknown account returns an error", async () => {
    const { store } = makeStore();
    const res = await store.scanOne("GHOST");
    expect(res).toEqual({ ok: false, error: "account not found in entry.yaml" });
  });

  it("scanOne with a decrypt failure stores auth_status decrypt_error + yaml chars", async () => {
    const { store } = makeStore({ ruby: failingRuby() });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const list = await store.list();
    expect(list.accounts[0].auth_status).toBe("decrypt_error");
    expect(list.accounts[0].auth_error).toContain("cannot load entry.yaml");
    expect(list.characters.map((c) => c.char_name)).toEqual(["Fisternar", "Zepherus"]);
  });

  it("scanOne success stores SGE chars + yaml-only chars with sources", async () => {
    const { store } = makeStore({
      sge: sgeOk([
        { slot: "1", name: "Zepherus" },
        { slot: "2", name: "Freshchar" },
      ]),
    });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const list = await store.list();
    expect(list.accounts[0].auth_status).toBe("ok");
    const names = list.characters.map((c) => `${c.char_name}:${c.source}`);
    expect(names).toEqual(["Fisternar:entry_yaml", "Freshchar:sge", "Zepherus:sge"]);
  });

  it("scanOne with invalid_password stores bad_password + yaml chars", async () => {
    const { store } = makeStore({ sge: sgeError(new Error("invalid_password")) });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const list = await store.list();
    expect(list.accounts[0].auth_status).toBe("bad_password");
    expect(list.characters.map((c) => c.char_name)).toEqual(["Fisternar", "Zepherus"]);
  });

  it("scanAll scans every entry.yaml account and reports the total", async () => {
    const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
    const res = await store.scanAll();
    expect(res).toEqual({ ok: true, total: 2, message: "scan started" });
    await store.whenIdle();
    const list = await store.list();
    expect(list.accounts.map((a) => a.account_name).sort()).toEqual(["ALT", "BUCKWHEET"]);
  });

  it("scan lock rejects a concurrent scan", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slowRuby = new Ruby(() => gate.then(() => ({ stdout: "P", stderr: "", code: 0 })));
    const { store } = makeStore({ ruby: slowRuby });
    const p1 = store.scanAll();
    await new Promise((r) => setTimeout(r, 20)); // let the scan start and hit the gate
    const res = await store.scanAll();
    expect(res).toEqual({ ok: false, error: "scan already running" });
    release();
    await p1;
  });

  it("deleteAccount and deleteCharacter remove stored rows", async () => {
    const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
    await store.scanOne("BUCKWHEET");
    await store.deleteCharacter("BUCKWHEET", "fisternar");
    let list = await store.list();
    expect(list.characters.map((c) => c.char_name)).toEqual(["Zepherus"]);
    await store.deleteAccount("BUCKWHEET");
    list = await store.list();
    expect(list.accounts).toEqual([]);
    expect(list.characters).toEqual([]);
  });

  it("upserts per char: keeps stale rows, marks entry_only, preserves last_seen", async () => {
    let sgeChars = [
      { slot: "1", name: "Fisternar" },
      { slot: "2", name: "Zepherus" },
    ];
    const sge = new Sge((_h, _p, onData, _onError) => {
      const fields = sgeChars.flatMap((c) => [c.slot, c.name]);
      const chunks = ["MASK", "A\tKEY=abc", "M", "N", "G", `C\t1\tGS3\t1\t2\t${fields.join("\t")}`];
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
    const { store } = makeStore({ sge });
    await store.scanOne("BUCKWHEET");
    const firstList = await store.list();
    const firstSeen = firstList.characters.find((c) => c.char_name === "Fisternar")?.last_seen;
    expect(firstSeen).toBeTypeOf("number"); // Fisternar was active on SGE in scan 1
    // Fisternar vanishes from SGE; entry.yaml still lists it
    sgeChars = [{ slot: "1", name: "Zepherus" }];
    await store.scanOne("BUCKWHEET");
    const list = await store.list();
    const chars = list.characters.filter((c) => c.account_name === "BUCKWHEET");
    const fisternar = chars.find((c) => c.char_name === "Fisternar");
    expect(fisternar?.status).toBe("entry_only");
    expect(fisternar?.last_seen).toBe(firstSeen); // last_seen preserved, not reset
    const zepherus = chars.find((c) => c.char_name === "Zepherus");
    expect(zepherus?.status).toBe("active");
    expect(zepherus?.last_seen).toBeGreaterThanOrEqual(firstSeen as number);
    // second scan did NOT delete the row set
    expect(chars.map((c) => c.char_name).sort()).toEqual(["Fisternar", "Zepherus"]);
  });

  it("exposes status and auto_added columns on scanned rows", async () => {
    const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
    await store.scanOne("BUCKWHEET");
    const list = await store.list();
    const zepherus = list.characters.find((c) => c.char_name === "Zepherus");
    expect(zepherus).toMatchObject({ status: "active", auto_added: 0 });
    const fisternar = list.characters.find((c) => c.char_name === "Fisternar");
    expect(fisternar).toMatchObject({ status: "entry_only", auto_added: 0 });
  });

  it("auto-adds a new SGE char to entry.yaml (auto_added=1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-auto-"));
    const yamlPath = join(dir, "entry.yaml");
    copyFileSync(FIXTURE, yamlPath);
    const yaml = new EntryYaml(yamlPath);
    const { store } = makeStore({ yaml, sge: sgeOk([{ slot: "1", name: "Freshchar" }]) });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const yamlChars = yaml.read().map((c) => c.char_name);
    expect(yamlChars).toContain("Freshchar");
    const list = await store.list();
    const fresh = list.characters.find((c) => c.char_name === "Freshchar");
    expect(fresh?.auto_added).toBe(1);
    expect(fresh?.status).toBe("active");
    rmSync(dir, { recursive: true, force: true });
  });

  it("auto-add failure records the row but does not abort the scan", async () => {
    class FailingYaml extends EntryYaml {
      override addCharacter(): never {
        throw new Error("boom");
      }
    }
    const dir = mkdtempSync(join(tmpdir(), "acct-auto-fail-"));
    const yamlPath = join(dir, "entry.yaml");
    copyFileSync(FIXTURE, yamlPath);
    const yaml = new FailingYaml(yamlPath);
    const { store } = makeStore({ yaml, sge: sgeOk([{ slot: "1", name: "Freshchar" }]) });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const list = await store.list();
    const fresh = list.characters.find((c) => c.char_name === "Freshchar");
    expect(fresh).toBeDefined();
    expect(fresh?.auto_added).toBe(0);
    expect(fresh?.status).toBe("active");
    expect(list.accounts[0].auth_status).toBe("ok");
    rmSync(dir, { recursive: true, force: true });
  });

  it("cleanupStale removes dead accounts + stale chars from entry.yaml, gsiv.db, and inv.db3", async () => {
    const fake = new FakeInvDb();
    const dir = mkdtempSync(join(tmpdir(), "acct-cleanup-"));
    const yamlPath = join(dir, "entry.yaml");
    copyFileSync(FIXTURE, yamlPath);
    const yaml = new EntryYaml(yamlPath);
    const { db, store } = makeStore({ yaml, invDb: fake });

    // Seed gsiv.db directly (no scan): BUCKWHEET = dead account; ALT = live with a stale char.
    const ins = db.get();
    ins
      .prepare("INSERT INTO accounts (account_name, auth_status, last_scan) VALUES ('BUCKWHEET','bad_password',1)")
      .run();
    ins.prepare("INSERT INTO accounts (account_name, auth_status, last_scan) VALUES ('ALT','ok',1)").run();
    ins
      .prepare(
        "INSERT INTO account_characters (account_name, char_name, status) VALUES ('BUCKWHEET','Fisternar','entry_only')",
      )
      .run();
    ins
      .prepare(
        "INSERT INTO account_characters (account_name, char_name, status) VALUES ('BUCKWHEET','Zepherus','entry_only')",
      )
      .run();
    ins
      .prepare(
        "INSERT INTO account_characters (account_name, char_name, status) VALUES ('ALT','Neleourg','entry_only')",
      )
      .run();

    const res = await store.cleanupStale();
    expect(res.ok).toBe(true);
    expect(res.removedAccounts).toBe(1);
    expect(res.removedCharacters).toBe(1); // ALT's Neleourg; BUCKWHEET chars came with the account

    // entry.yaml: BUCKWHEET account gone, ALT's stale char gone (ALT account stays, empty)
    expect(yaml.read()).toEqual([]);

    // gsiv.db: BUCKWHEET removed, ALT kept; no characters remain
    const list = await store.list();
    expect(list.accounts.map((a) => a.account_name)).toEqual(["ALT"]);
    expect(list.characters).toEqual([]);

    // inv.db3 (fake) received the right calls
    expect(fake.deletedAccounts).toEqual(["BUCKWHEET"]);
    expect(fake.deletedCharacters).toEqual([{ name: "Neleourg", account: "ALT" }]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("cleanupStale dryRun previews without mutating", async () => {
    const fake = new FakeInvDb();
    const dir = mkdtempSync(join(tmpdir(), "acct-cleanup-dry-"));
    const yamlPath = join(dir, "entry.yaml");
    copyFileSync(FIXTURE, yamlPath);
    const yaml = new EntryYaml(yamlPath);
    const { db, store } = makeStore({ yaml, invDb: fake });

    const ins = db.get();
    ins
      .prepare("INSERT INTO accounts (account_name, auth_status, last_scan) VALUES ('BUCKWHEET','bad_password',1)")
      .run();
    ins.prepare("INSERT INTO accounts (account_name, auth_status, last_scan) VALUES ('ALT','ok',1)").run();
    ins
      .prepare(
        "INSERT INTO account_characters (account_name, char_name, status) VALUES ('BUCKWHEET','Fisternar','entry_only')",
      )
      .run();
    ins
      .prepare(
        "INSERT INTO account_characters (account_name, char_name, status) VALUES ('ALT','Neleourg','entry_only')",
      )
      .run();

    const res = await store.cleanupStale(true);
    expect(res.dryRun).toBe(true);
    expect(res.removedAccounts).toBe(1);
    expect(res.removedCharacters).toBe(1); // ALT's Neleourg (BUCKWHEET's Fisternar belongs to the account)

    // nothing mutated
    expect(yaml.read().length).toBe(3); // Fisternar, Zepherus (BUCKWHEET) + Neleourg (ALT)
    const list = await store.list();
    expect(list.accounts.length).toBe(2);
    expect(list.characters.length).toBe(2);
    expect(fake.deletedAccounts).toEqual([]);
    expect(fake.deletedCharacters).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });

  describe("refreshAndClassify", () => {
    it("classifies start_failed without consulting SGE", async () => {
      const { store } = makeStore(); // default sge errors, but result === "failed" short-circuits
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "failed", error: "unit not found" },
      ]);
      expect(res).toEqual([
        {
          char: "Fisternar",
          result: "failed",
          error: "unit not found",
          code: "start_failed",
          reason: "systemd start failed: unit not found",
        },
      ]);
    });

    it("classifies auth_bad_password from a fresh SGE re-check", async () => {
      const { store } = makeStore({ sge: sgeError(new Error("invalid_password")) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "auth_bad_password", reason: "account auth: bad_password" });
    });

    it("classifies auth_decrypt_error when the password can't be decrypted", async () => {
      const { store } = makeStore({ ruby: failingRuby() });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "auth_decrypt_error" });
    });

    it("classifies sge_unreachable for a transport error, not an auth failure", async () => {
      const { store } = makeStore({ sge: sgeError(new Error("SGE timeout")) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "sge_unreachable" });
    });

    it("classifies char_disabled when the char is absent from SGE's active list", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "char_disabled" });
    });

    it("classifies no_write when the char is active but produced no invdb write", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Zepherus", result: "timeout", error: "no invdb write" },
      ]);
      expect(res[0]).toMatchObject({ code: "no_write" });
    });

    it("classifies transient when auth ok + char active but never came online", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Zepherus", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "transient" });
    });
  });

  describe("no_active_chars flag + alert", () => {
    it("flags the account when auth ok but SGE has no active chars", async () => {
      const { store, emitted, logged } = makeStore({ sge: sgeOk([]) });
      await store.refresh("BUCKWHEET");
      const list = await store.list();
      expect(list.accounts[0].no_active_chars).toBe(1);
      expect(emitted.some((e) => e.type === "no_chars_alert")).toBe(true);
      expect(logged.some((l) => l.startsWith("no_active_chars:"))).toBe(true);
    });

    it("clears the flag when the account has active chars", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      await store.refresh("BUCKWHEET");
      const list = await store.list();
      expect(list.accounts[0].no_active_chars).toBe(0);
    });

    it("does not flag on an auth error", async () => {
      const { store } = makeStore({ sge: sgeError(new Error("invalid_password")) });
      await store.refresh("BUCKWHEET");
      const list = await store.list();
      expect(list.accounts[0].no_active_chars).toBe(0);
    });

    it("re-alerts on each detection while the account stays empty", async () => {
      const { store, emitted, logged } = makeStore({ sge: sgeOk([]) });
      await store.refresh("BUCKWHEET");
      await store.refresh("BUCKWHEET");
      expect(emitted.filter((e) => e.type === "no_chars_alert")).toHaveLength(2);
      expect(logged.filter((l) => l.startsWith("no_active_chars:"))).toHaveLength(2);
    });
  });

  describe("transfer detection in stale()", () => {
    it("sets transferred_to when an entry_only char is active under another account", async () => {
      const { db, store } = makeStore();
      const ins = db.get();
      ins
        .prepare(
          "INSERT INTO account_characters (account_name, char_name, status) VALUES ('BUCKWHEET','Fisternar','entry_only')",
        )
        .run();
      ins
        .prepare("INSERT INTO account_characters (account_name, char_name, status) VALUES ('ALT','Fisternar','active')")
        .run();
      const { characters } = await store.stale();
      const fisternar = characters.find((c) => c.account_name === "BUCKWHEET" && c.char_name === "Fisternar");
      expect(fisternar?.transferred_to).toBe("ALT");
    });

    it("leaves transferred_to null when the gone char is not active elsewhere", async () => {
      const { db, store } = makeStore();
      const ins = db.get();
      ins
        .prepare(
          "INSERT INTO account_characters (account_name, char_name, status) VALUES ('BUCKWHEET','Zepherus','entry_only')",
        )
        .run();
      const { characters } = await store.stale();
      const zepherus = characters.find((c) => c.char_name === "Zepherus");
      expect(zepherus?.transferred_to).toBeNull();
    });
  });
});
