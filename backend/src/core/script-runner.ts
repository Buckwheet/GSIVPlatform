import { execFile } from "node:child_process";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that executes
// the server-side analysis scripts. A FIXED allowlist of scripts under the
// analysis data dir — the script name is never user-controlled and no
// arguments are ever passed. Fire-and-forget (v1 unref semantics).
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFn = (cmd: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

export type AnalysisScript = "run-analysis" | "shiva-loop";

const SCRIPTS: Record<AnalysisScript, string> = {
  "run-analysis": "run-analysis.sh",
  "shiva-loop": "shiva-loop.sh",
};

const DEFAULT_DATA_DIR = process.env.ANALYSIS_DATA_DIR || "/opt/gs4sd/data";

function defaultExec(cmd: string): Promise<ExecResult> {
  // No timeout and unref(): analysis scripts legitimately run for minutes (v1 unref semantics).
  return new Promise((resolve) => {
    const child = execFile(cmd, [], (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      } else {
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: 0 });
      }
    });
    child.unref();
  });
}

export class ScriptRunner {
  constructor(
    private exec: ExecFn = defaultExec,
    private opts: { dataDir?: string } = {},
  ) {}

  /** Kick a known analysis script in the background (fire-and-forget, v1-faithful). */
  async run(script: AnalysisScript): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    const fileName = SCRIPTS[script];
    if (!fileName) return { ok: false, error: `unknown script: ${script}` };
    const path = join(this.opts.dataDir ?? DEFAULT_DATA_DIR, fileName);
    // Fire-and-forget: v1 spawned the script with unref() and returned immediately.
    // Errors are visible via the analysis status file, not the HTTP response.
    void this.exec(path, [], 0);
    return { ok: true, message: `${script} started` };
  }
}
