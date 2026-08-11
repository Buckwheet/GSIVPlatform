import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: Ruby execution, used ONLY for the Lich
// PasswordCipher (entry.yaml account passwords).
// - The scripts are FIXED templates; user input (account name, password,
//   entry.yaml path) is passed via ARGV — never interpolated into Ruby source
//   (v1 interpolated account_name: an injection risk).
// - execFile with an args array + timeout; cwd = the lich dir so the script's
//   `require_relative "lib/common/gui/password_cipher"` resolves.
// - Injectable exec for tests.
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFn = (cmd: string, args: string[], timeoutMs: number, input?: string) => Promise<ExecResult>;

const RUBY_TIMEOUT_MS = 10_000;

const ENCRYPT_SCRIPT = `
require_relative "lib/common/gui/password_cipher"
password = STDIN.read
account_name = ARGV[0]
print Lich::Common::GUI::PasswordCipher.encrypt(password, mode: :standard, account_name: account_name)
`;

const DECRYPT_SCRIPT = `
require_relative "lib/common/gui/password_cipher"
require "yaml"
account_name = ARGV[1]
yaml_path = ARGV[2]
data = YAML.load_file(yaml_path)
account = (data["accounts"] || {}).find { |k, _| k.casecmp(account_name).zero? }
enc = account && account[1]["password"]
print Lich::Common::GUI::PasswordCipher.decrypt(enc, mode: :standard, account_name: account_name)
`;

export function defaultExec(cmd: string, args: string[], timeoutMs: number, input?: string): Promise<ExecResult> {
  // spawn (not execFile): the password travels via stdin — execFile input is
  // unreliable on Windows and ARGV would leak the secret in the process table.
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      // spawn failure (ENOENT etc.) — surface stderr if the process never ran
      resolve({ stdout, stderr: stderr || (err as Error).message, code: null });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? null });
    });
    // ruby may exit before reading stdin (missing binary, bad require) — a write
    // then hits EPIPE; ignore it or the unhandled error would crash the server.
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(input ?? "");
    } catch {
      // stdin already closed
    }
    child.stdin.end();
  });
}

function lichDirFromEntryYaml(entryYamlPath: string): string {
  return dirname(entryYamlPath).replace(/[/]data$/, "");
}

export class Ruby {
  constructor(
    private exec: ExecFn = defaultExec,
    private opts: { lichDir?: string } = {},
  ) {}

  /** Encrypt a plaintext password for storage in entry.yaml (PasswordCipher). */
  async encryptPassword(
    accountName: string,
    plainPassword: string,
  ): Promise<{ ok: true; encrypted: string } | { ok: false; error: string }> {
    try {
      validateCharName(accountName);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    const cwd =
      this.opts.lichDir ?? lichDirFromEntryYaml(process.env.ENTRY_YAML_PATH ?? "/opt/gs4sd/lich5/data/entry.yaml");
    // password travels via stdin — never ARGV (argv is visible in `ps`)
    const res = await this.run(ENCRYPT_SCRIPT, [accountName], cwd, plainPassword);
    if (res.code !== 0) return { ok: false, error: res.stderr.trim() || `ruby failed (code ${res.code})` };
    return { ok: true, encrypted: res.stdout.trim() };
  }

  /** Decrypt a stored password for the scan (PasswordCipher + entry.yaml read, server-side only). */
  async decryptPassword(
    accountName: string,
    entryYamlPath: string,
  ): Promise<{ ok: true; plain: string } | { ok: false; error: string }> {
    try {
      validateCharName(accountName);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    const cwd = this.opts.lichDir ?? lichDirFromEntryYaml(entryYamlPath);
    const res = await this.run(DECRYPT_SCRIPT, ["", accountName, entryYamlPath], cwd);
    if (res.code !== 0) return { ok: false, error: res.stderr.trim() || `ruby failed (code ${res.code})` };
    return { ok: true, plain: res.stdout.trim() };
  }

  private run(script: string, args: string[], cwd: string, input?: string): Promise<ExecResult> {
    // ruby -C <lichDir>: chdir before running so require_relative resolves (v1 used execFile cwd).
    return this.exec("ruby", ["-C", cwd, "-e", script, ...args], RUBY_TIMEOUT_MS, input);
  }
}
