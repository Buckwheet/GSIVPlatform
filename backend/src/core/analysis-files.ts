import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that touches
// the analysis data dir (ANALYSIS_DATA_DIR) and the Lich game-log dir
// (LICH_LOG_DIR). Uploads are filename-sanitized, .log-only, size-capped, and
// character names are strictly validated (v1 used the raw character as a path
// segment — a traversal risk).
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const LOG_DIR_PREFIX = "GSIV-";
const MAX_TAIL_LINES = 500;

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; code: "bad_name" | "bad_char" | "too_large" };

export class AnalysisFiles {
  constructor(private opts: { dataDir: string; logDir: string }) {}

  /** Analysis output/status/usage files; missing files degrade to empty (v1). */
  async readAnalysis(): Promise<{ output: string; status: string; usage: unknown | null }> {
    const output = this.readOr("analysis-output.txt", "");
    const status = this.readOr("analysis-status.txt", "");
    let usage: unknown | null = null;
    try {
      usage = JSON.parse(this.readOr("groq-usage.json", "null")) as unknown;
    } catch {
      usage = null;
    }
    return { output, status, usage };
  }

  /** Analysis history array; missing/corrupt → [] (v1). */
  async readHistory(): Promise<unknown[]> {
    try {
      const raw = this.readOr("analysis-history.json", "[]");
      return JSON.parse(raw) as unknown[];
    } catch {
      return [];
    }
  }

  /** Store an uploaded combat log under mejora-logs/<Char>/<YYYY>/<MM>/. */
  async uploadLog(
    character: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<Ok<{ path: string; size: number }> | Fail> {
    try {
      validateCharName(character);
    } catch {
      return { ok: false, code: "bad_char" };
    }
    if (buffer.length > MAX_UPLOAD_BYTES) return { ok: false, code: "too_large" };
    const name = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!name.endsWith(".log") || name === ".log") return { ok: false, code: "bad_name" };
    const now = new Date();
    const dir = join(
      this.opts.dataDir,
      "mejora-logs",
      character,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
    );
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, name);
    writeFileSync(dest, buffer);
    return { ok: true, path: dest, size: buffer.length };
  }

  /** Tail the latest game log for a character (recursive search, push/pop filtered). */
  async tailGameLog(char: string, lines = 80): Promise<Ok<{ lines: string[]; file: string | null }> | Fail> {
    try {
      validateCharName(char);
    } catch {
      return { ok: false, code: "bad_char" };
    }
    const dir = join(
      this.opts.logDir,
      `${LOG_DIR_PREFIX}${char.charAt(0).toUpperCase() + char.slice(1).toLowerCase()}`,
    );
    if (!existsSync(dir)) return { ok: true, lines: [], file: null };
    let latest = "";
    let latestMtime = 0;
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          walk(join(d, e.name));
        } else if (e.name.endsWith(".log")) {
          const full = join(d, e.name);
          const mt = statSync(full).mtimeMs;
          if (mt > latestMtime) {
            latest = full;
            latestMtime = mt;
          }
        }
      }
    };
    walk(dir);
    if (!latest) return { ok: true, lines: [], file: null };
    const n = Number(lines);
    const count = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_TAIL_LINES) : 80;
    const content = readFileSync(latest, "utf-8");
    const tail = content
      .split("\n")
      .slice(-count)
      .filter((l) => !l.startsWith("<pushStream") && !l.startsWith("<popStream"));
    return { ok: true, lines: tail, file: join(latest).split(/[/\\]/).pop() ?? null };
  }

  private readOr(name: string, fallback: string): string {
    const full = join(this.opts.dataDir, name);
    return existsSync(full) ? readFileSync(full, "utf-8") : fallback;
  }
}
