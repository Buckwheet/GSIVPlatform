import { describe, expect, it } from "vitest";
import { type ExecFn, Systemd, SystemdError } from "../../src/core/systemd.js";

function recordExec(
  records: { cmd: string; args: string[] }[],
  result?: { code: number | null; stdout?: string; stderr?: string },
): ExecFn {
  return async (cmd, args, _timeoutMs) => {
    records.push({ cmd, args });
    return { stdout: result?.stdout ?? "", stderr: result?.stderr ?? "", code: result?.code ?? 0 };
  };
}

describe("Systemd capability", () => {
  it("unitFor derives the unit with a capitalized first letter", () => {
    const s = new Systemd();
    expect(s.unitFor("fisternar")).toBe("gs4sd-lich@Fisternar.service");
    expect(s.unitFor("Zepherus")).toBe("gs4sd-lich@Zepherus.service");
  });

  it("unitFor rejects unsafe names before any exec", () => {
    const s = new Systemd();
    for (const bad of ["../../x", "a b", "foo;rm -rf /", "--help", "", "-n", "a".repeat(40), "名前", "a/b"]) {
      expect(() => s.unitFor(bad), `should reject ${JSON.stringify(bad)}`).toThrow(SystemdError);
    }
  });

  it("action calls sudo systemctl with the exact argv (prod shape)", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const s = new Systemd(recordExec(records));
    const res = await s.action("start", "fisternar");
    expect(res).toEqual({ ok: true });
    expect(records).toEqual([{ cmd: "sudo", args: ["systemctl", "start", "gs4sd-lich@Fisternar.service"] }]);
  });

  it("action with sudoActions:false calls systemctl directly", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const s = new Systemd(recordExec(records), { sudoActions: false });
    await s.action("restart", "zepherus");
    expect(records).toEqual([{ cmd: "systemctl", args: ["restart", "gs4sd-lich@Zepherus.service"] }]);
  });

  it("action maps a nonzero exit to {ok:false, error: stderr}", async () => {
    const s = new Systemd(recordExec([], { code: 1, stderr: "Failed to start unit" }));
    const res = await s.action("start", "fisternar");
    expect(res).toEqual({ ok: false, error: "Failed to start unit" });
  });

  it("action fails closed on an unknown action without exec", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const s = new Systemd(recordExec(records));
    const res = await s.action("reboot" as "start", "fisternar");
    expect(res).toEqual({ ok: false, error: expect.stringContaining("unknown action") });
    expect(records).toHaveLength(0);
  });

  it("show parses ActiveState/SubState/uptime from systemctl output", async () => {
    const stdout = ["ActiveState=active", "SubState=running", "ActiveEnterTimestampMonotonic=1234567890"].join("\n");
    const s = new Systemd(recordExec([], { code: 0, stdout }));
    const st = await s.show("fisternar");
    expect(st.active).toBe(true);
    expect(st.sub).toBe("running");
  });

  it("show degrades gracefully when systemctl fails", async () => {
    const s = new Systemd(recordExec([], { code: 1, stderr: "No such unit" }));
    expect(await s.show("fisternar")).toEqual({ active: false, sub: "unknown", uptime: null });
  });

  it("show treats missing properties as inactive/unknown", async () => {
    const s = new Systemd(recordExec([], { code: 0, stdout: "ActiveState=inactive\nSubState=dead" }));
    const st = await s.show("fisternar");
    expect(st).toEqual({ active: false, sub: "dead", uptime: null });
  });
});
