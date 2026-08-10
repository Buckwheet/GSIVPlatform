import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { type ExecFn, Systemd } from "../../../src/core/systemd.js";
import { CharactersStore } from "../../../src/modules/characters/store.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");

function makeStore(exec: ExecFn) {
  const systemd = new Systemd(exec, { sudoActions: false });
  return { store: new CharactersStore(new InMemoryKV(), new EntryYaml(FIXTURE), systemd), systemd };
}

describe("CharactersStore", () => {
  it("seedManagedIfEmpty seeds once from entry.yaml and never re-seeds", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 1 }));
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["fisternar", "zepherus", "neleourg"]);
    await store.setManaged("Fisternar", false);
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
  });

  it("list() enriches yaml chars with systemd status, unit, and managed flag", async () => {
    const { store } = makeStore(async () => ({ stdout: "ActiveState=active\nSubState=running", stderr: "", code: 0 }));
    await store.seedManagedIfEmpty();
    const rows = await store.list();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      account: "Buckwheet",
      char_name: "Fisternar",
      game_code: "GSIV",
      managed: true,
      unit: "gs4sd-lich@Fisternar.service",
      active: true,
      sub: "running",
      uptime: null,
    });
    expect(rows[1].char_name).toBe("Zepherus");
  });

  it("get() returns a row for a known char (case-insensitive) and null otherwise", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 1 }));
    const row = await store.get("fisternar");
    expect(row?.char_name).toBe("Fisternar");
    expect(row?.active).toBe(false);
    expect(await store.get("Ghost")).toBeNull();
  });

  it("start/restart call systemd and return the result; unknown char returns null without exec", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const { store } = makeStore(async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    });
    expect(await store.start("fisternar")).toEqual({ ok: true });
    expect(await store.restart("Zepherus")).toEqual({ ok: true });
    expect(records).toEqual([
      { cmd: "systemctl", args: ["start", "gs4sd-lich@Fisternar.service"] },
      { cmd: "systemctl", args: ["restart", "gs4sd-lich@Zepherus.service"] },
    ]);
    expect(await store.start("Ghost")).toBeNull();
    expect(records).toHaveLength(2);
  });

  it("stop calls systemd and removes the char from managed (was_managed true)", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const { store } = makeStore(async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    });
    await store.seedManagedIfEmpty();
    const res = await store.stop("fisternar");
    expect(res).toEqual({ ok: true, was_managed: true });
    expect(records).toEqual([{ cmd: "systemctl", args: ["stop", "gs4sd-lich@Fisternar.service"] }]);
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
    expect(await store.stop("Ghost")).toBeNull();
  });
});
