import { describe, expect, it } from "vitest";
import { defaultExec, type ExecFn, Ruby } from "../../src/core/ruby.js";

function recordExec(records: { cmd: string; args: string[]; input?: string }[], out: string) {
  const exec: ExecFn = async (cmd, args, _timeoutMs, input) => {
    records.push({ cmd, args, input });
    return { stdout: out, stderr: "", code: 0 };
  };
  return exec;
}

describe("Ruby capability", () => {
  it("encryptPassword passes the password via STDIN, never ARGV (no ps disclosure)", async () => {
    const records: { cmd: string; args: string[]; input?: string }[] = [];
    const r = new Ruby(recordExec(records, "ENCRYPTED"), { lichDir: "/opt/gs4sd/lich5" });
    const res = await r.encryptPassword("BUCKWHEET", "hunter2");
    expect(res).toEqual({ ok: true, encrypted: "ENCRYPTED" });
    expect(records).toHaveLength(1);
    const { cmd, args, input } = records[0];
    expect(cmd).toBe("ruby");
    expect(args[0]).toBe("-C");
    expect(args[1]).toBe("/opt/gs4sd/lich5");
    // script reads the password from STDIN and the account from ARGV
    expect(args[3]).toContain("STDIN.read");
    expect(args[3]).toContain("ARGV[0]");
    expect(args[3]).not.toContain("hunter2");
    expect(args[3]).not.toContain("BUCKWHEET");
    expect(args[4]).toBe("BUCKWHEET");
    expect(input).toBe("hunter2"); // the secret travels via stdin
  });

  it("decryptPassword passes the entry.yaml path via ARGV and reads the stored value", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const r = new Ruby(recordExec(records, "PLAINTEXT"), { lichDir: "/opt/gs4sd/lich5" });
    const res = await r.decryptPassword("BUCKWHEET", "/opt/gs4sd/lich5/data/entry.yaml");
    expect(res).toEqual({ ok: true, plain: "PLAINTEXT" });
    expect(records[0].args[3]).toContain("YAML.load_file(yaml_path)");
    expect(records[0].args[3]).toContain("k.casecmp(account_name).zero?");
    expect(records[0].args[3]).toContain("yaml_path = ARGV[2]");
    expect(records[0].args[5]).toBe("BUCKWHEET");
    expect(records[0].args[6]).toBe("/opt/gs4sd/lich5/data/entry.yaml");
  });

  it("rejects invalid account names before exec (fail closed)", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const r = new Ruby(recordExec(records, "x"));
    for (const bad of ["..", "a b", "a;rm -rf /", '"x"', "a/b"]) {
      const res = await r.encryptPassword(bad, "pw");
      expect(res.ok, `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
    expect(records).toHaveLength(0);
  });

  it("defaultExec survives a child that exits before reading stdin (EPIPE)", async () => {
    // node exits immediately; the stdin write then hits EPIPE. Without the
    // error handler this would crash the process as an unhandled 'error'.
    const res = await defaultExec(process.execPath, ["-e", "process.exit(1)"], 5000, "hunter2");
    expect(res.code).toBe(1);
  });

  it("maps a ruby failure to {ok:false, error} without throwing", async () => {
    const exec: ExecFn = async () => ({ stdout: "", stderr: "No such file", code: 1 });
    const r = new Ruby(exec);
    expect(await r.encryptPassword("BUCKWHEET", "pw")).toEqual({ ok: false, error: "No such file" });
  });
});
