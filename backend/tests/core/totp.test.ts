import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOTP as OTPAuthTOTP, Secret } from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { Totp } from "../../src/core/totp.js";

const TMP = mkdtempSync(join(tmpdir(), "totp-test-"));
const SECRET_PATH = join(TMP, "totp_secret");

function currentCode(secret: string): string {
  const totp = new OTPAuthTOTP({ secret: Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 });
  return totp.generate();
}

describe("Totp capability", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("isSetup is false before setup", () => {
    expect(new Totp(SECRET_PATH).isSetup()).toBe(false);
  });

  it("setup persists a base32 secret and returns uri + qr data url", async () => {
    const t = new Totp(SECRET_PATH);
    const { secret, uri, qrDataUrl } = t.setup();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(uri).toContain("otpauth://totp/");
    expect(await qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(t.isSetup()).toBe(true);
  });

  it("secret file is written with mode 0600 (POSIX; Windows lacks mode bits)", () => {
    expect(existsSync(SECRET_PATH)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(SECRET_PATH).mode & 0o777).toBe(0o600);
    }
  });

  it("verify accepts a current code and rejects a wrong code", async () => {
    const t = new Totp(SECRET_PATH);
    const secret = t.setup().secret;
    expect(t.verify(currentCode(secret))).toBe(true);
    expect(t.verify("000000")).toBe(false);
    expect(t.verify("")).toBe(false);
  });

  it("verify returns false when not setup", () => {
    expect(new Totp(join(TMP, "missing_secret")).verify("123456")).toBe(false);
  });

  it("reset clears the secret", () => {
    const t = new Totp(SECRET_PATH);
    t.reset();
    expect(t.isSetup()).toBe(false);
    expect(t.verify("000000")).toBe(false);
  });
});
