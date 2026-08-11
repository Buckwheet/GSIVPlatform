import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigFiles } from "../../src/core/config-files.js";

const TMP = mkdtempSync(join(tmpdir(), "config-files-"));
const GSIV = join(TMP, "GSIV");
const GST = join(TMP, "GST");
mkdirSync(join(GSIV, "Fisternar", "scripts"), { recursive: true });
mkdirSync(join(GSIV, "Fisternar", "data"));
mkdirSync(join(GST, "Neleourg"), { recursive: true });
writeFileSync(join(GSIV, "Fisternar", "scripts", "go2.lic"), "one");
writeFileSync(join(GSIV, "Fisternar", "data", "var.txt"), "two");
writeFileSync(join(GST, "Neleourg", "custom.txt"), "gst");
mkdirSync(join(GSIV, "Bothchar"), { recursive: true });
mkdirSync(join(GST, "Bothchar"), { recursive: true });
writeFileSync(join(GSIV, "Bothchar", "same.txt"), "gsiv-version");
writeFileSync(join(GST, "Bothchar", "same.txt"), "gst-version");

describe("ConfigFiles capability", () => {
  let cf: ConfigFiles;

  beforeAll(() => {
    cf = new ConfigFiles({ gsivDir: GSIV, gstDir: GST });
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("list() walks the char dir with sizes and modification times", async () => {
    const res = await cf.list("Fisternar");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.character).toBe("Fisternar");
    const files = res.files.map((f) => f.path).sort();
    expect(files).toEqual(["data/var.txt", "scripts/go2.lic"]);
    expect(res.files[0].size).toBeGreaterThan(0);
    expect(res.files[0].modified).toMatch(/^\d{4}-/);
  });

  it("list() returns an empty file list for an unknown char (v1)", async () => {
    expect(await cf.list("Ghost")).toEqual({ ok: true, character: "Ghost", files: [] });
  });

  it("read() returns content and reports missing", async () => {
    expect(await cf.read("Fisternar", "scripts/go2.lic")).toEqual({ ok: true, content: "one" });
    expect(await cf.read("Fisternar", "nope.txt")).toEqual({ ok: false, code: "missing" });
  });

  it("rejects path traversal (bad_path) before any fs access", async () => {
    for (const bad of ["../x", "../../etc/passwd", "/etc/passwd", "a/../../b", "", "a/../.."]) {
      const res = await cf.read("Fisternar", bad);
      expect(res.ok || res.code === "missing", `should reject ${JSON.stringify(bad)}`).toBe(false);
      if (!res.ok) expect(res.code, `code for ${JSON.stringify(bad)}`).toBe("bad_path");
    }
  });

  it("write() creates dirs, backs up the existing file, and stores content", async () => {
    const res = await cf.write("Fisternar", "scripts/go2.lic", "new");
    expect(res).toEqual(expect.objectContaining({ ok: true }));
    expect(readFileSync(join(GSIV, "Fisternar", "scripts", "go2.lic"), "utf-8")).toBe("new");
    const backups = readdirNames(join(GSIV, "Fisternar", "scripts")).filter((f) => f.includes(".bak."));
    expect(backups.length).toBeGreaterThan(0);
    expect(readFileSync(join(GSIV, "Fisternar", "scripts", backups[0]), "utf-8")).toBe("one");
  });

  it("copyFrom copies selected files source→target with backups", async () => {
    const res = await cf.copyFrom("Neleourg", "Fisternar", ["scripts/go2.lic"]);
    expect(res.ok).toBe(true);
    expect(res.ok && res.copied).toEqual(["scripts/go2.lic"]);
    expect(readFileSync(join(GST, "Neleourg", "scripts", "go2.lic"), "utf-8")).toBe("new");
  });

  it("resolves the GST dir for instance=GST and falls back otherwise", async () => {
    expect((await cf.read("Neleourg", "custom.txt", "GST")).ok).toBe(true);
    // v1 fallback: a GST-only char resolves to GST even with instance=GSIV
    const gsivRead = await cf.read("Neleourg", "custom.txt", "GSIV");
    expect(gsivRead.ok).toBe(true);
    if (gsivRead.ok) expect(gsivRead.content).toBe("gst");
    expect((await cf.read("Neleourg", "custom.txt", undefined)).ok).toBe(true);
    // instance resolution when the char exists in BOTH dirs
    const fromGST = await cf.read("Bothchar", "same.txt", "GST");
    const fromGSIV = await cf.read("Bothchar", "same.txt", "GSIV");
    if (fromGST.ok && fromGSIV.ok) {
      expect(fromGST.content).toBe("gst-version");
      expect(fromGSIV.content).toBe("gsiv-version");
    }
  });

  it("write() rejects content over the size cap (too_large)", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    expect(await cf.write("Fisternar", "big.txt", big)).toEqual({ ok: false, code: "too_large" });
    expect(existsSync(join(GSIV, "Fisternar", "big.txt"))).toBe(false);
  });

  it("rejects symlinked paths inside the char dir (containment)", async () => {
    const outside = join(TMP, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "secret");
    const link = join(GSIV, "Fisternar", "evil-link");
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // no symlink privilege on this host — skip
    }
    expect(await cf.read("Fisternar", "evil-link/secret.txt")).toEqual({ ok: false, code: "bad_path" });
    expect(await cf.write("Fisternar", "evil-link/out.txt", "x")).toEqual({ ok: false, code: "bad_path" });
  });

  it("rejects a symlinked char dir itself (root escape)", async () => {
    const outside = join(TMP, "outside-root");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "root.txt"), "root-secret");
    const link = join(GSIV, "Rootchar");
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // no symlink privilege on this host — skip
    }
    expect(await cf.list("Rootchar")).toEqual({ ok: true, character: "Rootchar", files: [] });
    expect(await cf.read("Rootchar", "root.txt")).toEqual({ ok: false, code: "bad_path" });
  });

  it("rotates .bak backups — only the newest 5 remain", async () => {
    for (let i = 0; i < 8; i++) await cf.write("Fisternar", "data/var.txt", `v${i}`);
    const backups = readdirNames(join(GSIV, "Fisternar", "data")).filter((f) => f.startsWith("var.txt.bak."));
    expect(backups.length).toBe(5);
    expect(readFileSync(join(GSIV, "Fisternar", "data", "var.txt"), "utf-8")).toBe("v7");
  });

  it("rejects invalid character names", async () => {
    expect((await cf.read("../x", "a.txt")).ok).toBe(false);
    expect((await cf.list("bad name!")).ok).toBe(false);
  });
});

function readdirNames(dir: string): string[] {
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readdirSync(dir);
}
