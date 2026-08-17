import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that
// provisions a VellumFE stream for a character at launch time (writes the Lich
// drop-in + vellum-fe drop-in, enables/starts the stream, extends the Caddy
// site and the server .env VELLUM_STREAMS entry). This is the automated form
// of the manual "stream more chars" recipe in deploy/V2-DEPLOYMENT.md §VellumFE.
//
// All host mutations are backup-then-write and reversible: on a partial
// failure the provisioner restores every backup it created before returning,
// so a failed launch never leaves half-applied state. No shell strings are ever
// built — every exec is `execFile(cmd, args)` with an args array, and every
// char-derived path is gated by the same strict `validateCharName` check the
// Systemd capability uses (no unit/file escape / traversal).
// ---------------------------------------------------------------------------

const DETACH_BASE = 9100;
const WEB_BASE = 9200;
const MAX_TRY = 200; // generous cap on port scanning

export interface StreamPorts {
  detach: number;
  web: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFn = (cmd: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

export type FsFn = (path: string, content: string) => void;

export interface StreamProvisionPaths {
  systemdDir: string;
  caddyfile: string;
  envPath: string;
}

/** Result of a successful (or already-complete) provisioning. */
export interface StreamProvisionResult {
  char: string;
  ports: StreamPorts;
  /** True when this call wrote + applied the provisioning; false when it was a no-op. */
  provisioned: boolean;
  url: string;
}

/** Parse "Char:detach:web,Char:detach:web" → map (same grammar as gameview). */
export function parseStreams(raw?: string): Record<string, StreamPorts> {
  const out: Record<string, StreamPorts> = {};
  for (const part of (raw ?? "").split(",").map((s) => s.trim())) {
    if (!part) continue;
    const [char, detach, web] = part.split(":");
    const d = Number(detach);
    const w = Number(web);
    if (!char || !Number.isInteger(d) || !Number.isInteger(w)) continue;
    out[char] = { detach: d, web: w };
  }
  return out;
}

/** Serialize the streams map back to the VELLUM_STREAMS string grammar. */
export function serializeStreams(streams: Record<string, StreamPorts>): string {
  return Object.entries(streams)
    .map(([char, { detach, web }]) => `${char}:${detach}:${web}`)
    .join(",");
}

// --- argv extraction helpers -------------------------------------------------

const EXEC_START_MARKER = "argv[]=";
const EXEC_START_END = " ; ";

/**
 * Pull the argv command array out of `systemctl show -p ExecStart` output
 * (e.g. `ExecStart={ path=… ; argv[]=a b c ; … }`). Returns the individual
 * tokens, or null if it cannot be located.
 */
export function parseExecStartArgv(stdout: string): string[] | null {
  const idx = stdout.indexOf(EXEC_START_MARKER);
  if (idx === -1) return null;
  const rest = stdout.slice(idx + EXEC_START_MARKER.length);
  const end = rest.indexOf(EXEC_START_END);
  const body = end === -1 ? rest.trim() : rest.slice(0, end).trim();
  if (!body) return null;
  // Tokens are shell words, but in practice these units carry no quote/space
  // separators (paths + `--key=value` flags). We still handle the common
  // `--start-scripts=a,b,c` (commas are not separators) and quoted values.
  return splitShellWords(body);
}

function splitShellWords(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Return the value of a `--name=value` argument, else undefined. */
function flagValue(argv: string[], flag: string): string | undefined {
  for (const a of argv) if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  return undefined;
}

/** Remove any `--detachable-client=…` argument (guard against double-add). */
function stripDetach(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith("--detachable-client="));
}

/** Replace the `--port` / `--web-port` values (vellum-fe). */
function withPorts(argv: string[], detach: number, web: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--port" && i + 1 < argv.length) {
      out.push(a, String(detach));
      i += 2;
    } else if (a === "--web-port" && i + 1 < argv.length) {
      out.push(a, String(web));
      i += 2;
    } else {
      out.push(a);
      i += 1;
    }
  }
  return out;
}

/** Rebuild a systemd service file from an argv list. */
function serviceExecStart(argv: string[]): string {
  return argv.map((a) => (/\s/.test(a) && !/^['"]/.test(a) ? `"${a}"` : a)).join(" ");
}

// --- default + injected exec/fs --------------------------------------------------

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

const fallbackFs: FsFn = (path, content) => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf-8");
};

function defaultRead(path: string): string {
  return readFileSync(path, "utf-8");
}

function defaultExists(path: string): boolean {
  return existsSync(path);
}

function defaultRemove(paths: string[]): void {
  for (const p of paths) rmSync(p, { force: true });
}

// ---------------------------------------------------------------------------

export interface StreamProvisionOpts {
  // Paths (server-only; injected via env in index.ts). Never derived from request input.
  paths: StreamProvisionPaths;
  streamDomain: string;
  baseUrl?: string;
  token?: string;
  /** Current in-memory streams map (parity with the module's live view). */
  currentStreams: () => Record<string, StreamPorts>;
  /** Next-free port allocation strategy (injectable for tests). */
  allocator?: Allocator;
  exec?: ExecFn;
  write?: FsFn;
  read?: typeof defaultRead;
  exists?: typeof defaultExists;
  /** Remover(s) used during rollback (defaults to node fs rmSync force). Injectable for tests. */
  remove?: (paths: string[]) => void;
  timeoutMs?: number;
}

export type Allocator = (used: ReadonlySet<number>) => { detach: number; web: number } | null;

/**
 * Default allocator: lowest pair (910X / 920X) where neither port is occupied.
 * A single `used` set holds every occupied port number (detach + web) so a
 * pair is only free when both its ports are unused.
 */
function defaultAllocator(used: ReadonlySet<number>): { detach: number; web: number } | null {
  for (let n = 1; n < MAX_TRY; n++) {
    if (!used.has(DETACH_BASE + n) && !used.has(WEB_BASE + n)) {
      return { detach: DETACH_BASE + n, web: WEB_BASE + n };
    }
  }
  return null;
}

/** Error carrying a user-safe message for the launch route. */
export class StreamProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamProvisionError";
  }
}

export class StreamProvisioner {
  private exec: ExecFn;
  private write: FsFn;
  private read: typeof defaultRead;
  private exists: typeof defaultExists;
  private remove: (paths: string[]) => void;
  private allocator: Allocator;
  private timeoutMs: number;

  constructor(private opts: StreamProvisionOpts) {
    this.exec = opts.exec ?? defaultExec;
    this.write = opts.write ?? fallbackFs;
    this.read = opts.read ?? defaultRead;
    this.exists = opts.exists ?? defaultExists;
    this.remove = opts.remove ?? defaultRemove;
    this.allocator = opts.allocator ?? defaultAllocator;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Backup `path` by copying its current content to `path.bak.<ts>` (all via the
   *  injected fs layer). No-op+null when the file doesn't exist. */
  private backup(path: string): string | null {
    if (!this.exists(path)) return null;
    const raw = this.read(path);
    const bak = `${path}.bak.${Date.now()}`;
    this.write(bak, raw);
    return bak;
  }

  /**
   * Ensure a VellumFE stream exists for `char` and return its ports/URL.
   * If the char is already provisioned (in `currentStreams()`), it is a no-op.
   * Otherwise provisions it (backup-then-write, rollback on failure).
   */
  async provision(char: string): Promise<StreamProvisionResult> {
    validateCharName(char);
    const existing = this.opts.currentStreams()[char];
    if (existing) {
      return {
        char,
        ports: existing,
        provisioned: false,
        url: this.buildUrl(char, existing.detach),
      };
    }

    const lichUnit = `gs4sd-lich@${char}.service`;
    const vellumUnit = `vellum-fe@${char}.service`;

    // Gather effective argv for the Lich unit (template-resolved by systemd,
    // includes the char's --start-scripts) and for the vellum-fe template.
    const [lichShow, vellShow] = await Promise.all([
      this.exec("systemctl", ["show", lichUnit, "-p", "ExecStart"], this.timeoutMs),
      this.exec("systemctl", ["show", vellumUnit, "-p", "ExecStart"], this.timeoutMs),
    ]);
    const lichArgv = parseExecStartArgv(lichShow.stdout);
    const vellArgv = parseExecStartArgv(vellShow.stdout);
    if (!lichArgv) throw new StreamProvisionError(`cannot read Lich unit for ${char}`);
    if (!vellArgv) throw new StreamProvisionError(`cannot read vellum-fe template for ${char}`);

    // Next-free ports across the current map + any running vellum-fe units.
    const ports = this.allocate(char);
    if (!ports) throw new StreamProvisionError(`no free stream port available`);

    const lichDropinPath = posix.join(this.opts.paths.systemdDir, `gs4sd-lich@${char}.service.d`, "override.conf");
    const vellDropinPath = posix.join(this.opts.paths.systemdDir, `vellum-fe@${char}.service.d`, "override.conf");

    // Track backups so we can roll a partial failure back.
    const backups: { path: string; bak: string | null; raw: string }[] = [];
    const record = (path: string, raw: string, bak: string | null) => backups.push({ path, bak, raw });

    const originals = new Map<string, string>();
    const caddyRaw = this.read(this.opts.paths.caddyfile);
    const envRaw = this.read(this.opts.paths.envPath);
    originals.set(this.opts.paths.caddyfile, caddyRaw);
    originals.set(this.opts.paths.envPath, envRaw);

    try {
      // 1) Lich + vellum drop-ins. Each is `[Service]` + an empty `ExecStart=`
      //    (clearing the unit template) then a full `ExecStart=<command>` line.
      const lichDropin = `[Service]\nExecStart=\nExecStart=${serviceExecStart(
        stripDetach(lichArgv).concat(`--detachable-client=${ports.detach}`),
      )}\n`;
      const vellDropin = `[Service]\nExecStart=\nExecStart=${serviceExecStart(
        withPorts(vellArgv, ports.detach, ports.web),
      )}\n`;
      const lichBak = this.backup(lichDropinPath);
      this.write(lichDropinPath, lichDropin);
      record(lichDropinPath, lichDropin, lichBak);

      const vellBak = this.backup(vellDropinPath);
      this.write(vellDropinPath, vellDropin);
      record(vellDropinPath, vellDropin, vellBak);

      // 2) Caddy: append host matcher + handler block; validate before reload.
      const newCaddy = this.insertCaddy(caddyRaw, char, ports.web);
      const caddyBak = this.backup(this.opts.paths.caddyfile);
      this.write(this.opts.paths.caddyfile, newCaddy);
      record(this.opts.paths.caddyfile, newCaddy, caddyBak);

      // 3) .env: extend VELLUM_STREAMS.
      const newEnv = this.extendEnv(envRaw, char, ports);
      const envBak = this.backup(this.opts.paths.envPath);
      this.write(this.opts.paths.envPath, newEnv);
      record(this.opts.paths.envPath, newEnv, envBak);

      // 4) systemd: daemon-reload, enable+start vellum-fe.
      await this.ok(this.exec("systemctl", ["daemon-reload"], this.timeoutMs), "daemon-reload");
      await this.ok(
        this.exec("systemctl", ["enable", "--now", vellumUnit], this.timeoutMs),
        `enable+start ${vellumUnit}`,
      );

      // 5) Restart the Lich unit IF it is currently active so the fresh
      //    --detachable-client applies. If the char isn't running yet, the
      //    launch handler starts it after provisioning completes (no restart here).
      if (await this.isActive(lichUnit)) {
        await this.ok(this.exec("systemctl", ["restart", lichUnit], this.timeoutMs), `restart ${lichUnit}`);
      }

      // 6) Validate the Caddy config and only then reload; a bad config is
      //    restored + rolled back (never left live).
      const caddyValidate = await this.exec("caddy", ["validate", "--config", this.opts.paths.caddyfile], 30_000);
      if (caddyValidate.code !== 0) {
        throw new StreamProvisionError(`invalid new Caddy config: ${caddyValidate.stderr.trim()}`);
      }
      await this.ok(
        this.exec("caddy", ["reload", "--config", this.opts.paths.caddyfile], this.timeoutMs),
        "caddy reload",
      );
      // NOTE: no synchronous backend restart (it would kill this in-flight
      // response). The module updates its in-memory streams map right after a
      // successful provision; the .env edit above persists for the next boot.
    } catch (err) {
      // Roll back every mutation we made before rethrowing.
      this.rollback(originals, backups, char);
      if (err instanceof StreamProvisionError) throw err;
      throw new StreamProvisionError(
        `provisioning failed and was rolled back: ${String((err as Error)?.message ?? err)}`,
      );
    }

    return {
      char,
      ports,
      provisioned: true,
      url: this.buildUrl(char, ports.detach),
    };
  }

  /** Pick the next-free (detach, web) pair from the current streams map. */
  private allocate(char: string): StreamPorts | null {
    void char;
    const used = new Set<number>();
    for (const { detach, web } of Object.values(this.opts.currentStreams())) {
      used.add(detach);
      used.add(web);
    }
    const res = this.allocator(used);
    return res ? { detach: res.detach, web: res.web } : null;
  }

  /** Whether a systemd unit is currently active (best-effort; false on any read error). */
  private async isActive(unit: string): Promise<boolean> {
    const res = await this.exec("systemctl", ["is-active", unit], this.timeoutMs);
    return res.code === 0 || res.stdout.trim() === "active";
  }

  /** Build the stream URL for the launch response (parity with the module). */
  buildUrl(char: string, detach: number): string {
    const base = (this.opts.baseUrl ?? "").replace(/\/$/, "");
    const frag = this.opts.token ? `token=${this.opts.token}&` : "";
    const host = this.opts.streamDomain
      ? `${char.toLowerCase()}.${this.opts.streamDomain}`
      : base.slice(base.indexOf("://") + 3);
    return `https://${host}/play#${frag}lich=127.0.0.1:${detach}&name=${char}`;
  }

  private async ok(res: Promise<ExecResult>, what: string): Promise<void> {
    const r = await res;
    if (r.code !== 0) throw new StreamProvisionError(`${what} failed: ${r.stderr.trim() || `code ${r.code}`}`);
  }

  /** Insert a `@<char> host <char>.<domain>` matcher + handler block into the Caddyfile. */
  private insertCaddy(raw: string, char: string, web: number): string {
    const host = `${char.toLowerCase()}.${this.opts.streamDomain}`;
    const matcher = `\t@${char.toLowerCase()} host ${host}`;
    const block = `\n\thandle @${char.toLowerCase()} {\n\t\treverse_proxy 127.0.0.1:${web}\n\t}`;
    // Dedupe: if the matcher/handler already exist, return unchanged.
    if (raw.includes(matcher) && raw.includes(`reverse_proxy 127.0.0.1:${web}`)) return raw;

    // Insert the matcher just before the `handle @dashboard` line; append the
    // handler block right before the closing `}` of the :80 site.
    let out = raw;
    if (!raw.includes(matcher)) {
      const anchor = "\n\thandle @dashboard";
      const at = out.indexOf(anchor);
      if (at === -1) {
        out = `${out.trimEnd()}\n${matcher}\n`;
      } else {
        out = out.slice(0, at) + `\n${matcher}` + out.slice(at);
      }
    }
    if (!raw.includes(`reverse_proxy 127.0.0.1:${web}`)) {
      // Insert before the final standalone closing brace at column 0 that ends the site.
      const lastBrace = out.lastIndexOf("\n}");
      if (lastBrace !== -1) {
        out = out.slice(0, lastBrace) + block + "\n" + out.slice(lastBrace + 1);
      } else {
        out = `${out.trimEnd()}\n${block}\n`;
      }
    }
    return out;
  }

  /** Rewrite VELLUM_STREAMS in the server .env, preserving all other keys. */
  private extendEnv(raw: string, char: string, ports: StreamPorts): string {
    const newEntry = `${char}:${ports.detach}:${ports.web}`;
    if (raw.match(/^VELLUM_STREAMS=/m)) {
      const line = raw.match(/^VELLUM_STREAMS=.*$/m)![0];
      // Skip if already present.
      if (line.split(",").some((p) => p.trim().toLowerCase() === char.toLowerCase())) return raw;
      const updated = `${line},${newEntry}`;
      return raw.replace(/(^VELLUM_STREAMS=.*$)/m, updated);
    }
    // No existing key: append.
    return raw.trimEnd() + `\nVELLUM_STREAMS=${newEntry}\n`;
  }

  private rollback(
    originals: Map<string, string>,
    backups: { path: string; bak: string | null; raw: string }[],
    char: string,
  ): void {
    // Restore Caddyfile + .env to their original content.
    for (const [target, raw] of originals) {
      try {
        this.write(target, raw);
      } catch {
        // best-effort
      }
    }
    // Remove the drop-ins we created (and their backups) for this char.
    this.remove([
      posix.join(this.opts.paths.systemdDir, `gs4sd-lich@${char}.service.d`, "override.conf"),
      posix.join(this.opts.paths.systemdDir, `vellum-fe@${char}.service.d`, "override.conf"),
    ]);
    try {
      void this.exec("systemctl", ["daemon-reload"], this.timeoutMs);
      void this.exec("systemctl", ["stop", `vellum-fe@${char}.service`], this.timeoutMs);
      void this.exec("systemctl", ["disable", `vellum-fe@${char}.service`], this.timeoutMs);
    } catch {
      // best-effort
    }
    void backups;
  }
}
