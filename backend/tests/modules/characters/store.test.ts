import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EntryYaml } from "../../../src/core/entry-yaml.js";
import { InMemoryKV } from "../../../src/core/kv.js";
import { type ExecFn, Systemd } from "../../../src/core/systemd.js";
import { CharactersStore } from "../../../src/modules/characters/store.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "entry-yaml.fixture.yaml");

function makeStore(exec: ExecFn, kv = new InMemoryKV()) {
  const systemd = new Systemd(exec, { sudoActions: false });
  return { kv, store: new CharactersStore(kv, new EntryYaml(FIXTURE), systemd), systemd };
}

describe("CharactersStore", () => {
  it("seedManagedIfEmpty seeds from entry.yaml, then only reconciles", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 1 }));
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["fisternar", "zepherus", "neleourg"]);
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["fisternar", "zepherus", "neleourg"]); // no duplicates
  });

  it("seedManagedIfEmpty re-adds yaml chars missing from an existing managed list", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 1 }));
    await store.seedManagedIfEmpty();
    await store.setManaged("Fisternar", false);
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["zepherus", "neleourg", "fisternar"]);
  });

  it("list() enriches yaml chars with systemd status, unit, and managed flag", async () => {
    const { store } = makeStore(async () => ({ stdout: "ActiveState=active\nSubState=running", stderr: "", code: 0 }));
    await store.seedManagedIfEmpty();
    const rows = await store.list();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      account: "BUCKWHEET",
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

  it("start/restart use the canonical char_name regardless of caller casing", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const { store } = makeStore(async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    });
    await store.start("FiStErNaR");
    await store.start("zepherus");
    expect(records).toEqual([
      { cmd: "systemctl", args: ["start", "gs4sd-lich@Fisternar.service"] },
      { cmd: "systemctl", args: ["start", "gs4sd-lich@Zepherus.service"] },
    ]);
  });

  it("start() re-manages the char so the watchdog covers it again (issue #93)", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 0 }));
    await store.seedManagedIfEmpty();
    await store.stop("fisternar");
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
    expect(await store.start("fisternar")).toEqual({ ok: true });
    expect(await store.managed()).toEqual(["zepherus", "neleourg", "fisternar"]);
  });

  it("start() leaves the char unmanaged when the systemd action fails", async () => {
    const { store } = makeStore(async (_cmd, args) =>
      args[0] === "start" ? { stdout: "", stderr: "Failed to start", code: 1 } : { stdout: "", stderr: "", code: 0 },
    );
    await store.seedManagedIfEmpty();
    await store.stop("fisternar");
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
    expect(await store.start("fisternar")).toEqual({ ok: false, error: "Failed to start" });
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
  });

  it("stop does not unmanage when the systemctl action fails", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "Failed to stop", code: 1 }));
    await store.seedManagedIfEmpty();
    const res = await store.stop("fisternar");
    expect(res).toEqual({ ok: false, error: "Failed to stop", was_managed: true });
    expect(await store.managed()).toEqual(["fisternar", "zepherus", "neleourg"]);
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

  it("keeps a deliberately stopped char unmanaged across a boot reconcile (issue #93)", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 0 }));
    await store.seedManagedIfEmpty();
    await store.stop("fisternar");
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
    await store.seedManagedIfEmpty(); // the next platform boot
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]); // NOT silently re-managed
  });

  it("clears the deliberate-stop mark when the char is started again", async () => {
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 0 }));
    await store.seedManagedIfEmpty();
    await store.stop("fisternar");
    await store.start("fisternar");
    expect(await store.managed()).toEqual(["zepherus", "neleourg", "fisternar"]);
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["zepherus", "neleourg", "fisternar"]); // no duplicate, nothing re-added
  });

  it("does not seed a deliberately stopped char when the managed key is missing", async () => {
    const kv = new InMemoryKV();
    await kv.set("characters:stopped", JSON.stringify(["fisternar"]));
    const { store } = makeStore(async () => ({ stdout: "", stderr: "", code: 1 }), kv);
    await store.seedManagedIfEmpty();
    expect(await store.managed()).toEqual(["zepherus", "neleourg"]);
  });
});
