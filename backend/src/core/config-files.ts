import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that touches
// the Lich character config dirs (GSIV_DATA_DIR / GST_DATA_DIR). Every path is
// resolved and must stay inside the character dir (segment-level traversal
// rejection, not just a startsWith check). Writes are backup-then-write.
// ---------------------------------------------------------------------------

export interface ConfigFileEntry {
  path: string;
  size: number;
  modified: string;
}

export type FileResult = { ok: false; code: "bad_path" | "missing" | "invalid_char" };

type Ok<T> = { ok: true } & T;

export class ConfigFiles {
  constructor(private opts: { gsivDir: string; gstDir: string }) {}

  /** List config files for a character (v1: empty list for an unknown char). */
  async list(
    char: string,
    instance?: string,
  ): Promise<Ok<{ character: string; files: ConfigFileEntry[] }> | FileResult> {
    if (!this.validName(char)) return { ok: false, code: "invalid_char" };
    const charDir = this.resolveCharDir(char, instance);
    if (!charDir) return { ok: true, character: char, files: [] };
    const files: ConfigFileEntry[] = [];
    this.walk(charDir, "", files);
    return { ok: true, character: char, files };
  }

  /** Read one config file. */
  async read(char: string, relPath: string, instance?: string): Promise<Ok<{ content: string }> | FileResult> {
    if (!this.validName(char)) return { ok: false, code: "invalid_char" };
    const full = this.safeResolve(char, relPath, instance);
    if (!full) return { ok: false, code: "bad_path" };
    if (!existsSync(full)) return { ok: false, code: "missing" };
    return { ok: true, content: readFileSync(full, "utf-8") };
  }

  /** Write one config file (creates dirs; backs up the existing file first). */
  async write(
    char: string,
    relPath: string,
    content: string,
    instance?: string,
  ): Promise<Ok<{ character: string; file: string }> | FileResult> {
    if (!this.validName(char)) return { ok: false, code: "invalid_char" };
    let charDir = this.resolveCharDir(char, instance);
    if (!charDir) {
      charDir = join(this.opts.gsivDir, char);
      mkdirSync(charDir, { recursive: true });
    }
    const full = this.safeResolve(char, relPath, instance, charDir);
    if (!full) return { ok: false, code: "bad_path" };
    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(full)) copyFileSync(full, `${full}.bak.${Date.now()}`);
    writeFileSync(full, content);
    return { ok: true, character: char, file: relPath };
  }

  /** Copy config files from one character to another (backup-then-write). */
  async copyFrom(
    target: string,
    source: string,
    files?: string[],
    instance?: string,
  ): Promise<Ok<{ copied: string[] }> | FileResult> {
    if (!this.validName(target) || !this.validName(source)) return { ok: false, code: "invalid_char" };
    const srcDir = this.resolveCharDir(source, instance);
    if (!srcDir) return { ok: false, code: "missing" };
    const tgtDir = this.resolveCharDir(target, instance) ?? join(this.opts.gsivDir, target);
    if (!existsSync(tgtDir)) mkdirSync(tgtDir, { recursive: true });
    const copied: string[] = [];
    const walkCopy = (dir: string, prefix: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walkCopy(join(dir, e.name), rel);
        } else if (!files || files.includes(rel)) {
          const safeTarget = this.safeResolve(target, rel, instance, tgtDir);
          if (!safeTarget) continue;
          const tgtDirPath = dirname(safeTarget);
          if (!existsSync(tgtDirPath)) mkdirSync(tgtDirPath, { recursive: true });
          if (existsSync(safeTarget)) copyFileSync(safeTarget, `${safeTarget}.bak.${Date.now()}`);
          copyFileSync(join(dir, e.name), safeTarget);
          copied.push(rel);
        }
      }
    };
    walkCopy(srcDir, "");
    return { ok: true, copied };
  }

  private validName(name: string): boolean {
    try {
      validateCharName(name);
      return true;
    } catch {
      return false;
    }
  }

  /** v1 resolveCharDir port: instance-aware, prefers the non-empty dir. */
  private resolveCharDir(charName: string, instance?: string): string | null {
    const inst = instance?.toUpperCase();
    if (inst === "GST") {
      const gst = join(this.opts.gstDir, charName);
      if (existsSync(gst)) return gst;
    }
    if (inst === "GSIV" || inst === "GS3") {
      const gsiv = join(this.opts.gsivDir, charName);
      if (existsSync(gsiv)) return gsiv;
    }
    const gsiv = join(this.opts.gsivDir, charName);
    const gst = join(this.opts.gstDir, charName);
    const gsivExists = existsSync(gsiv);
    const gstExists = existsSync(gst);
    if (gsivExists && gstExists) {
      const gsivFiles = readdirSync(gsiv).length;
      const gstFiles = readdirSync(gst).length;
      if (gsivFiles === 0 && gstFiles > 0) return gst;
      return gsiv;
    }
    if (gsivExists) return gsiv;
    if (gstExists) return gst;
    return null;
  }

  /** Resolve relPath inside the char dir; null when traversal is attempted. */
  private safeResolve(char: string, relPath: string, instance?: string, charDirOverride?: string): string | null {
    if (!relPath || relPath.includes("\0") || relPath.startsWith("/") || relPath.startsWith("\\")) return null;
    const segments = relPath.split(/[/\\]/);
    if (segments.some((seg) => seg === ".." || seg === "")) return null;
    const charDir = charDirOverride ?? this.resolveCharDir(char, instance);
    if (!charDir) return null;
    const full = resolve(charDir, ...segments);
    const prefix = `${resolve(charDir)}${sep()}`;
    if (full !== resolve(charDir) && !full.startsWith(prefix)) return null;
    return full;
  }

  private walk(dir: string, prefix: string, out: ConfigFileEntry[]): void {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        this.walk(full, rel, out);
      } else {
        const stat = statSync(full);
        out.push({ path: rel, size: stat.size, modified: stat.mtime.toISOString() });
      }
    }
  }
}

function sep(): string {
  return require("node:path").sep;
}
