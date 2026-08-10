import { execFile } from "node:child_process";
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

export type ExecFn = (cmd: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

const RUBY_TIMEOUT_MS = 10_000;

const ENCRYPT_SCRIPT = `
require_relative "lib/common/gui/password_cipher"
password = ARGV[0]
account_name = ARGV[1]
print Lich::Common::GUI::PasswordCipher.encrypt(password, mode: :standard, account_name: account_name)
`;

const DECRYPT_SCRIPT = `
require_relative "lib/common/gui/password_cipher"
require "yaml"
account_name = ARGV[1]
yaml_path = ARGV[2]
data = YAML.load_file(yaml_path)
enc = data["accounts"][account_name]["password"]
print Lich::Common::GUI::PasswordCipher.decrypt(enc, mode: :standard, account_name: account_name)
`;

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
    const res = await this.run(ENCRYPT_SCRIPT, [plainPassword, accountName], cwd);
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

  private run(script: string, args: string[], cwd: string): Promise<ExecResult> {
    // ruby -C <lichDir>: chdir before running so require_relative resolves (v1 used execFile cwd).
    return this.exec("ruby", ["-C", cwd, "-e", script, ...args], RUBY_TIMEOUT_MS);
  }
}
