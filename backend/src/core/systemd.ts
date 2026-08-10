import { execFile } from "node:child_process";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that executes
// systemd (SECURITY.md: no shell execution except via dedicated capabilities).
// - Actions are allowlisted; anything else fails closed.
// - Character names are strictly validated before the unit name is derived.
// - execFile is called with an args array (never a shell string) and a timeout.
// - The exec function is injectable so tests verify the exact argv.
// ---------------------------------------------------------------------------

export type SystemdAction = "start" | "stop" | "restart";

export interface SystemdStatus {
  active: boolean;
  sub: string;
  uptime: number | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFn = (cmd: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

export class SystemdError extends Error {}

const CHAR_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const ACTIONS: ReadonlySet<string> = new Set(["start", "stop", "restart"]);
const ACTION_TIMEOUT_MS = 15_000;

export function validateCharName(name: string): void {
  if (typeof name !== "string" || !CHAR_NAME_RE.test(name)) {
    throw new SystemdError(`invalid character name: ${JSON.stringify(name)}`);
  }
}

function defaultExec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      } else {
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: 0 });
      }
    });
  });
}

export class Systemd {
  constructor(
    private exec: ExecFn = defaultExec,
    private opts: { sudoActions?: boolean } = {},
  ) {}

  /** Validate the name and derive the Lich systemd unit (callers never supply a unit). */
  unitFor(name: string): string {
    validateCharName(name);
    return `gs4sd-lich@${name.charAt(0).toUpperCase() + name.slice(1)}.service`;
  }

  /** Run a systemctl action (prod shape: sudo systemctl <action> <unit>). */
  async action(action: SystemdAction, name: string): Promise<{ ok: boolean; error?: string }> {
    if (!ACTIONS.has(action)) return { ok: false, error: `unknown action: ${action}` };
    const unit = this.unitFor(name);
    const useSudo = this.opts.sudoActions !== false;
    const cmd = useSudo ? "sudo" : "systemctl";
    const args = useSudo ? ["systemctl", action, unit] : [action, unit];
    const res = await this.exec(cmd, args, ACTION_TIMEOUT_MS);
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || `systemctl ${action} failed (code ${res.code})` };
    }
    return { ok: true };
  }

  /** Read a unit's status without sudo (read-only systemctl show). */
  async show(name: string): Promise<SystemdStatus> {
    const unit = this.unitFor(name);
    const res = await this.exec(
      "systemctl",
      ["show", unit, "--property=ActiveState,SubState,ActiveEnterTimestampMonotonic"],
      ACTION_TIMEOUT_MS,
    );
    if (res.code !== 0) return { active: false, sub: "unknown", uptime: null };
    const props: Record<string, string> = {};
    for (const line of res.stdout.trim().split("\n")) {
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      props[line.slice(0, idx)] = line.slice(idx + 1);
    }
    const active = props.ActiveState === "active";
    const enterUsec = Number(props.ActiveEnterTimestampMonotonic) || 0;
    const nowUsec = Number(process.hrtime.bigint() / 1000n);
    const uptime = active && enterUsec ? Math.round((nowUsec - enterUsec) / 1_000_000) : null;
    return { active, sub: props.SubState || "unknown", uptime };
  }
}
