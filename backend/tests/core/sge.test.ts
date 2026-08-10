import { describe, expect, it, vi } from "vitest";
import { Sge, type SgeConnect } from "../../src/core/sge.js";

function scriptedConnect(chunks: string[], onWrite?: (d: Buffer | string) => void): SgeConnect {
  let i = 0;
  return (_host, _port, onData, _onError) => {
    // deliver chunks asynchronously (real TLS data always arrives async)
    const deliver = (idx: number) => {
      if (idx < chunks.length) setImmediate(() => onData(Buffer.from(chunks[idx], "binary")));
    };
    deliver(0);
    return {
      write: (d) => {
        onWrite?.(d);
        i += 1;
        deliver(i);
      },
      destroy: () => {},
    };
  };
}

describe("Sge capability", () => {
  it("parses the C response into slot/name pairs", async () => {
    const chunks = [
      "MASKING",
      "A\tKEY=abc",
      "M",
      "N",
      "G",
      "C\t1\tGS3\t1\t2\tFisternar\tZepherus\t1\tNeleourg\t2\tArli",
    ];
    const sge = new Sge(scriptedConnect(chunks));
    const chars = await sge.listCharacters("BUCKWHEET", "hunter2", "GS3");
    expect(chars).toEqual([
      // integer-like slot keys sort before string keys in JS object iteration (v1-faithful)
      { slot: "1", name: "Neleourg" },
      { slot: "2", name: "Arli" },
      { slot: "Fisternar", name: "Zepherus" },
    ]);
  });

  it("masks the password with the handshake mask before sending", async () => {
    const writes: string[] = [];
    const chunks = ["X", "A\tKEY=abc", "M", "N", "G", "C\t1\tGS3\t0"];
    const sge = new Sge(scriptedConnect(chunks, (d) => writes.push(String(d))));
    await sge.listCharacters("ACCT", "AB", "GS3");
    // auth message: A\tACCT\t + masked chars; mask chars 'X' -> (X ^ (A-32)) + 32
    const auth = writes[0];
    expect(auth.startsWith("A\tACCT\t")).toBe(true);
    expect(auth).not.toContain("AB");
  });

  it("maps invalid_password / account_rejected / account_not_found errors", async () => {
    for (const [chunk, msg] of [
      ["A\tPASSWORD", "invalid_password"],
      ["A\tREJECT", "account_rejected"],
      ["A\tNORECORD", "account_not_found"],
    ] as const) {
      const sge = new Sge(scriptedConnect(["MASK", chunk]));
      await expect(sge.listCharacters("ACCT", "pw", "GS3")).rejects.toThrow(msg);
    }
  });

  it("rejects with the raw message on a PROBLEM response", async () => {
    const sge = new Sge(scriptedConnect(["MASK", "something PROBLEM"]));
    await expect(sge.listCharacters("ACCT", "pw", "GS3")).rejects.toThrow("something PROBLEM");
  });

  it("times out after 15s with no completion", async () => {
    vi.useFakeTimers();
    try {
      const sge = new Sge(scriptedConnect(["MASK"]));
      const p = sge.listCharacters("ACCT", "pw", "GS3");
      const assertion = expect(p).rejects.toThrow("SGE timeout");
      vi.advanceTimersByTime(16_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
