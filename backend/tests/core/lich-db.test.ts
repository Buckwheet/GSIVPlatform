import { describe, expect, it } from "vitest";
import { type ExecFn, LichDb } from "../../src/core/lich-db.js";

function recordExec(out: string, code = 0) {
  const records: { cmd: string; args: string[] }[] = [];
  const exec: ExecFn = async (cmd, args, _timeoutMs) => {
    records.push({ cmd, args });
    return { stdout: out, stderr: code ? "boom" : "", code };
  };
  return { exec, records };
}

describe("LichDb capability", () => {
  it("go2Get derives the scope and passes it + db path via ARGV (no interpolation)", async () => {
    const { exec, records } = recordExec(JSON.stringify({ delay: 1 }));
    const lich = new LichDb(exec, { dbPath: "/opt/gs4sd/lich5/data/lich.db3" });
    const res = await lich.go2Get("fisternar", "GSIV");
    expect(res).toEqual({ ok: true, settings: { delay: 1 } });
    const args = records[0].args;
    expect(records[0].cmd).toBe("ruby");
    expect(args[0]).toBe("-e");
    expect(args[1]).toContain("ARGV[0]");
    expect(args[1]).toContain("ARGV[1]");
    expect(args[1]).not.toContain("Fisternar");
    expect(args[2]).toBe("GSIV:Fisternar");
    expect(args[3]).toBe("/opt/gs4sd/lich5/data/lich.db3");
  });

  it("go2Put passes the settings JSON via ARGV and maps the ok response", async () => {
    const { exec, records } = recordExec('{"ok":true}');
    const lich = new LichDb(exec, { dbPath: "/opt/gs4sd/lich5/data/lich.db3" });
    const settings = { delay: 5, get_silvers: true };
    const res = await lich.go2Put("Fisternar", "GSIV", settings);
    expect(res).toEqual({ ok: true });
    expect(JSON.parse(records[0].args[4])).toEqual(settings);
    expect(records[0].args[2]).toBe("GSIV:Fisternar");
  });

  it("eherbsGet and eherbsPut work", async () => {
    const { exec, records } = recordExec(JSON.stringify({ stock: 3, debug: true }));
    const lich = new LichDb(exec, { dbPath: "/opt/gs4sd/lich5/data/lich.db3" });
    expect(await lich.eherbsGet("Neleourg")).toEqual({ ok: true, settings: { stock: 3, debug: true } });
    expect(records[0].args[2]).toBe("GSIV:Neleourg");
    expect(await lich.eherbsPut("Neleourg", "GST", { stock: 5 })).toEqual({ ok: true });
    expect(records[1].args[2]).toBe("GST:Neleourg");
  });

  it("rejects invalid char names and instances before exec", async () => {
    const { exec, records } = recordExec("{}");
    const lich = new LichDb(exec);
    expect((await lich.go2Get("../x", "GSIV")).ok).toBe(false);
    expect((await lich.go2Get("a b", "GSIV")).ok).toBe(false);
    expect((await lich.go2Get("Fisternar", "EVIL;rm")).ok).toBe(false);
    expect(records.length).toBe(0);
  });

  it("maps an exec failure to {ok:false, error}", async () => {
    const lich = new LichDb(async () => ({ stdout: "", stderr: "no such db", code: 1 }));
    expect(await lich.go2Get("Fisternar")).toEqual({ ok: false, error: "no such db" });
  });

  it("defaults the db path from LICH_DB_PATH-style env at construction", () => {
    const lich = new LichDb(async () => ({ stdout: "", stderr: "", code: 0 }), { dbPath: "/x/lich.db3" });
    expect(lich.dbPath).toBe("/x/lich.db3");
  });
});
