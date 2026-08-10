import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ExecFn, ScriptRunner } from "../../src/core/script-runner.js";

describe("ScriptRunner capability", () => {
  it("runs run-analysis.sh with no args and no timeout (fire-and-forget)", async () => {
    const records: { cmd: string; args: string[]; timeout: number }[] = [];
    const exec: ExecFn = async (cmd, args, timeoutMs) => {
      records.push({ cmd, args, timeout: timeoutMs });
      return { stdout: "", stderr: "", code: 0 };
    };
    const runner = new ScriptRunner(exec, { dataDir: "/opt/gs4sd/data" });
    const res = await runner.run("run-analysis");
    expect(res).toEqual({ ok: true, message: expect.stringContaining("started") });
    expect(records).toEqual([{ cmd: join("/opt/gs4sd/data", "run-analysis.sh"), args: [], timeout: 0 }]);
  });

  it("runs shiva-loop.sh the same way", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const exec: ExecFn = async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    };
    const runner = new ScriptRunner(exec, { dataDir: "/opt/gs4sd/data" });
    expect(await runner.run("shiva-loop")).toEqual({ ok: true, message: expect.stringContaining("started") });
    expect(records[0].cmd).toBe(join("/opt/gs4sd/data", "shiva-loop.sh"));
  });

  it("rejects unknown scripts before exec (fail closed)", async () => {
    const records: { cmd: string; args: string[] }[] = [];
    const exec: ExecFn = async (cmd, args) => {
      records.push({ cmd, args });
      return { stdout: "", stderr: "", code: 0 };
    };
    const runner = new ScriptRunner(exec, { dataDir: "/opt/gs4sd/data" });
    expect(await runner.run("rm-rf" as "run-analysis")).toEqual({
      ok: false,
      error: expect.stringContaining("unknown script"),
    });
    expect(records).toHaveLength(0);
  });
});
