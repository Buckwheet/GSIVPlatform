import { describe, expect, it } from "vitest";
import { ScanRunner, type ScanRunnerDeps } from "../../src/core/scan-runner.js";

const FAST = {
  onlineTimeoutMs: 50,
  scanTimeoutMs: 50,
  settleMs: 0,
  ticketsSettleMs: 0,
  pollMs: 5,
};

function makeDeps(overrides: Partial<ScanRunnerDeps> = {}) {
  const ts = new Map<string, number | null>();
  const deps = {
    ts,
    starts: [] as string[],
    stops: [] as string[],
    scripts: [] as string[],
    systemd: {
      async action(action: "start" | "stop", name: string) {
        (action === "start" ? deps.starts : deps.stops).push(name);
        return { ok: true };
      },
    },
    invDb: { charTimestamp: (name: string) => ts.get(name) ?? null },
    async sendScript(char: string, script: string) {
      deps.scripts.push(`${char}:${script}`);
      if (script === ";invdb") ts.set(char, (ts.get(char) ?? 0) + 1);
    },
    async isOnline() {
      return true;
    },
    ...overrides,
  };
  return deps;
}

describe("ScanRunner", () => {
  it("runs the full cycle and reports done", async () => {
    const deps = makeDeps();
    const runner = new ScanRunner(deps, FAST);
    const stages: string[] = [];
    const res = await runner.scanChar("Fisternar", (s) => stages.push(s));
    expect(res).toEqual({ char: "Fisternar", result: "done" });
    expect(deps.starts).toEqual(["Fisternar"]);
    expect(deps.stops).toEqual(["Fisternar"]);
    expect(deps.scripts).toEqual(["Fisternar:;invdb", "Fisternar:;invdb tickets"]);
    expect(stages).toEqual(["starting", "waiting_online", "scanning", "tickets", "done"]);
  });

  it("fails when systemd start errors", async () => {
    const deps = makeDeps({
      systemd: {
        async action() {
          return { ok: false, error: "no unit" };
        },
      },
    });
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("failed");
    expect(res.error).toBe("no unit");
  });

  it("times out when the char never comes online", async () => {
    const deps = makeDeps({ isOnline: async () => false });
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("timeout");
    expect(deps.stops).toEqual(["Fisternar"]); // cleaned up the unit
  });

  it("times out when invdb produces no write", async () => {
    const deps = makeDeps();
    // sendScript advances ts only for ";invdb" — override to NOT advance
    deps.sendScript = async (c, s) => {
      deps.scripts.push(`${c}:${s}`);
    };
    const runner = new ScanRunner(deps, FAST);
    const res = await runner.scanChar("Fisternar");
    expect(res.result).toBe("timeout");
    expect(res.error).toBe("no invdb write");
  });
});
