import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

// ---------------------------------------------------------------------------
// Review-gated core capability: TOTP 2FA (the "TOTP-gated" protection for the
// accounts module's entry.yaml mutations). Secret is persisted at
// TOTP_SECRET_PATH with mode 0600; verify uses a window of 1 step.
// ---------------------------------------------------------------------------

const DEFAULT_PATH = process.env.TOTP_SECRET_PATH || join(process.cwd(), "data", "totp_secret");
const ISSUER = "Phylactery";
const LABEL = "Dashboard";

export class Totp {
  constructor(private secretPath: string = DEFAULT_PATH) {}

  private loadSecret(): string | null {
    try {
      return readFileSync(this.secretPath, "utf-8").trim() || null;
    } catch {
      return null;
    }
  }

  isSetup(): boolean {
    return this.loadSecret() !== null;
  }

  /** Generate a new secret, persist it (mode 0600), and return enrollment data. */
  setup(): { secret: string; uri: string; qrDataUrl: Promise<string> } {
    const totp = new TOTP({ issuer: ISSUER, label: LABEL, algorithm: "SHA1", digits: 6, period: 30 });
    const secret = totp.secret.base32;
    writeFileSync(this.secretPath, secret, { mode: 0o600 });
    const uri = totp.toString();
    return { secret, uri, qrDataUrl: QRCode.toDataURL(uri) };
  }

  /** Verify a 6-digit code within a 1-step window; false when not set up. */
  verify(code: string): boolean {
    const secret = this.loadSecret();
    if (!secret) return false;
    const totp = new TOTP({
      issuer: ISSUER,
      label: LABEL,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  reset(): void {
    try {
      unlinkSync(this.secretPath);
    } catch {
      // already absent
    }
  }
}

/** Mode check helper for tests/debug: 0600 enforced at setup time. */
export function secretFileMode(path: string): number {
  return existsSync(path) ? statSync(path).mode & 0o777 : -1;
}
