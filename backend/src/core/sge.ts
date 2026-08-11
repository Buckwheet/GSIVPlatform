import * as tls from "node:tls";

// ---------------------------------------------------------------------------
// Review-gated core capability: SGE (eaccess.play.net:7910) authentication +
// character list, ported from v1. The transport is injectable so the protocol
// is fully testable without network access. Plaintext passwords are only ever
// passed to the TLS socket and are never logged.
// ---------------------------------------------------------------------------

export interface SgeChar {
  slot: string;
  name: string;
}

export interface SgeSocket {
  write(data: Buffer | string, encoding?: BufferEncoding): void;
  destroy(): void;
}

export type SgeConnect = (
  host: string,
  port: number,
  onData: (data: Buffer) => void,
  onError: (err: Error) => void,
) => SgeSocket;

const SGE_HOST = "eaccess.play.net";
const SGE_PORT = 7910;
const TIMEOUT_MS = 15_000;

const SGE_CERT_PIN = "10:B7:37:E6:61:98:7D:15:BC:5C:82:45:E3:F8:B7:82:91:D4:1E:D8:AB:C7:66:72:EC:B0:2F:E7:8E:D0:21:8A";

/** True when the peer certificate matches the pinned Simutronics cert (see below). */
export function matchesPinnedCert(cert: { fingerprint256?: string } | undefined | null): boolean {
  return cert?.fingerprint256 === SGE_CERT_PIN;
}

function defaultConnect(
  host: string,
  port: number,
  onData: (d: Buffer) => void,
  onError: (err: Error) => void,
): SgeSocket {
  const sock = tls.connect({ host, port, rejectUnauthorized: false }, () => {
    // eaccess.play.net serves a self-signed cert (Simutronics, valid to 3017), so
    // normal verification can't be enabled — pin the exact fingerprint instead, so
    // a MITM cannot substitute their own cert. Update the pin only if Simutronics
    // ever rotates it. (The SGE protocol additionally masks the password on the wire.)
    if (!matchesPinnedCert(sock.getPeerCertificate())) {
      onError(new Error("SGE certificate fingerprint mismatch"));
      sock.destroy();
      return;
    }
    sock.write("K");
  });
  sock.on("data", onData);
  sock.on("error", onError);
  return { write: (d, enc) => sock.write(d, enc), destroy: () => sock.destroy() };
}

function hashChar(c: string, mask: number): number {
  return (mask ^ (c.charCodeAt(0) - 32)) + 32;
}

function sendAuth(socket: SgeSocket, account: string, password: string, mask: string): void {
  const masked = password.split("").map((c, i) => hashChar(c, mask.charCodeAt(i)));
  socket.write(Buffer.concat([Buffer.from(`A\t${account}\t`), Buffer.from(masked)]), "binary");
}

function tsvToRecord(list: string[]): Record<string, string> {
  const r: Record<string, string> = {};
  for (let i = 0; i < list.length - 1; i += 2) r[list[i]] = list[i + 1];
  return r;
}

export class Sge {
  constructor(private connect: SgeConnect = defaultConnect) {}

  /** Authenticate and list active characters for an account. */
  listCharacters(account: string, password: string, gameCode: string): Promise<SgeChar[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SGE timeout")), TIMEOUT_MS);
      let state = 0; // 0=handshaking, 1=authed
      const socket = this.connect(SGE_HOST, SGE_PORT, onData, (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      function onData(data: Buffer): void {
        const msg = data.toString();
        if (state === 0) {
          state = 1;
          sendAuth(socket, account, password, msg);
          return;
        }
        if (msg.includes("PASSWORD")) {
          fail(new Error("invalid_password"));
          return;
        }
        if (msg.includes("REJECT")) {
          fail(new Error("account_rejected"));
          return;
        }
        if (msg.includes("NORECORD")) {
          fail(new Error("account_not_found"));
          return;
        }
        if (msg.endsWith("PROBLEM")) {
          fail(new Error(msg));
          return;
        }
        if (msg.startsWith("A") && msg.includes("KEY")) {
          state = 2;
          socket.write("M");
          return;
        }
        if (msg.startsWith("M")) {
          socket.write(`N\t${gameCode}\n`);
          return;
        }
        if (msg.startsWith("N")) {
          socket.write(`G\t${gameCode}\n`);
          return;
        }
        if (msg.startsWith("G")) {
          socket.write("C\n");
          return;
        }
        if (msg.startsWith("C")) {
          const parts = msg.trim().split("\t").slice(5);
          const rec = tsvToRecord(parts);
          const chars = Object.entries(rec).map(([slot, name]) => ({ slot, name }));
          clearTimeout(timeout);
          socket.destroy();
          resolve(chars);
        }
      }

      function fail(err: Error): void {
        clearTimeout(timeout);
        socket.destroy();
        reject(err);
      }
    });
  }

  /** Lightweight auth check used by the scan (true when SGE accepts the credentials). */
  async testAuth(account: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.listCharacters(account, password, "GS3");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
