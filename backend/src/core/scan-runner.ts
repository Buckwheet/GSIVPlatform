// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place that runs an invdb scan cycle
// for one character (systemd unit start/stop, lich command dispatch, and
// inv.db3 completion polling). Every side-effecting dependency is injected;
// this file performs no child_process or file IO of its own — it composes the
// Systemd + InvDb capabilities and a caller-supplied lich channel.
// ---------------------------------------------------------------------------

export type ScanStage = "starting" | "waiting_online" | "scanning" | "tickets" | "done" | "failed" | "timeout";

export interface ScanCharResult {
  char: string;
  result: "done" | "timeout" | "failed";
  error?: string;
}

export interface ScanRunnerDeps {
  systemd: { action(action: "start" | "stop", name: string): Promise<{ ok: boolean; error?: string }> };
  invDb: { charTimestamp(name: string): number | null };
  sendScript(char: string, script: string): Promise<void>;
  isOnline(char: string): Promise<boolean>;
}

export interface ScanTimings {
  onlineTimeoutMs: number;
  scanTimeoutMs: number;
  settleMs: number;
  ticketsSettleMs: number;
  pollMs: number;
}

const DEFAULT_TIMINGS: ScanTimings = {
  onlineTimeoutMs: 180_000, // wait for the lich session to come online (<=3 min)
  scanTimeoutMs: 240_000, // wait for the ;invdb write (<=4 min)
  settleMs: 8_000, // let the session finish logging in before sending ;invdb
  ticketsSettleMs: 10_000, // let ;invdb tickets finish before stopping the unit
  pollMs: 2_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ScanRunner {
  private timings: ScanTimings;

  constructor(
    private deps: ScanRunnerDeps,
    timings: Partial<ScanTimings> = {},
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  /** Scan one character end-to-end, reporting each stage transition. */
  async scanChar(char: string, onStage?: (stage: ScanStage, detail: string) => void): Promise<ScanCharResult> {
    const { systemd, invDb, sendScript, isOnline } = this.deps;
    const t = this.timings;
    const stage = (s: ScanStage, detail = char) => onStage?.(s, detail);

    stage("starting");
    const started = await systemd.action("start", char);
    if (!started.ok) {
      stage("failed", started.error ?? "start failed");
      return { char, result: "failed", error: started.error };
    }

    stage("waiting_online");
    const online = await this.waitFor(() => isOnline(char), t.onlineTimeoutMs);
    if (!online) {
      stage("timeout", "never came online");
      await systemd.action("stop", char);
      return { char, result: "timeout", error: "not online" };
    }

    await sleep(t.settleMs);

    const before = invDb.charTimestamp(char);
    stage("scanning");
    await sendScript(char, ";invdb");
    const wrote = await this.waitFor(() => {
      const ts = invDb.charTimestamp(char);
      return before === null ? ts !== null : (ts ?? 0) > before;
    }, t.scanTimeoutMs);
    if (!wrote) {
      stage("timeout", "invdb produced no write");
      await systemd.action("stop", char);
      return { char, result: "timeout", error: "no invdb write" };
    }

    stage("tickets");
    await sendScript(char, ";invdb tickets");
    await sleep(t.ticketsSettleMs);

    await systemd.action("stop", char);
    stage("done");
    return { char, result: "done" };
  }

  private async waitFor(pred: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await pred()) return true;
      await sleep(this.timings.pollMs);
    }
    return await pred();
  }
}
