import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { Ruby } from "../../../src/core/ruby.js";
import { Sge } from "../../../src/core/sge.js";
import { AccountsStore } from "../../../src/modules/accounts/store.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");

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

describe("AccountsStore", () => {
  function makeStore(overrides: { ruby?: Ruby; sge?: Sge; delayMs?: number } = {}) {
    const db = new CoreDb(":memory:");
    const store = new AccountsStore(
      db,
      new EntryYaml(FIXTURE),
      overrides.ruby ?? okRuby(),
      overrides.sge ?? sgeError(new Error("no network")),
      {
        delayMs: overrides.delayMs ?? 0,
      },
    );
    return { db, store };
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
});
