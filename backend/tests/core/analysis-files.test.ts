import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalysisFiles } from "../../src/core/analysis-files.js";

const TMP = mkdtempSync(join(tmpdir(), "analysis-files-"));
const DATA = join(TMP, "data");
const LOGS = join(TMP, "logs");
mkdirSync(DATA, { recursive: true });
mkdirSync(join(LOGS, "GSIV-Fisternar", "2026", "08"), { recursive: true });
writeFileSync(join(DATA, "analysis-output.txt"), "the output");
writeFileSync(join(DATA, "analysis-status.txt"), "running");
writeFileSync(join(DATA, "groq-usage.json"), JSON.stringify({ tokens: 123 }));
writeFileSync(join(DATA, "analysis-history.json"), JSON.stringify([{ id: 1 }]));
writeFileSync(join(LOGS, "GSIV-Fisternar", "old.log"), "old");
writeFileSync(join(LOGS, "GSIV-Fisternar", "2026", "08", "latest.log"), "line1\nline2\nline3");

describe("AnalysisFiles capability", () => {
  let af: AnalysisFiles;

  beforeAll(() => {
    af = new AnalysisFiles({ dataDir: DATA, logDir: LOGS });
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("readAnalysis returns output/status/usage; missing files degrade to empty", async () => {
    const res = await af.readAnalysis();
    expect(res).toEqual({ output: "the output", status: "running", usage: { tokens: 123 } });
    const fresh = new AnalysisFiles({ dataDir: join(TMP, "empty"), logDir: LOGS });
    expect(await fresh.readAnalysis()).toEqual({ output: "", status: "", usage: null });
  });

  it("readHistory parses the json file and degrades to [] on missing", async () => {
    expect(await af.readHistory()).toEqual([{ id: 1 }]);
    const fresh = new AnalysisFiles({ dataDir: join(TMP, "empty"), logDir: LOGS });
    expect(await fresh.readHistory()).toEqual([]);
  });

  it("uploadLog sanitizes names, mkdirs YYYY/MM, and writes the buffer", async () => {
    const res = await af.uploadLog("Fisternar", "mycombat.log", Buffer.from("data"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.size).toBe(4);
      expect(res.path).toContain("mejora-logs");
      expect(res.path).toContain("Fisternar");
      expect(res.path).toContain(String(new Date().getFullYear()));
      expect(readFileSync(res.path, "utf-8")).toBe("data");
    }
  });

  it("uploadLog rejects non-.log files, empty names, and invalid characters", async () => {
    expect((await af.uploadLog("Fisternar", "notes.txt", Buffer.from("x"))).ok).toBe(false);
    expect((await af.uploadLog("Fisternar", "///", Buffer.from("x"))).ok).toBe(false);
    expect((await af.uploadLog("../evil", "x.log", Buffer.from("x"))).ok).toBe(false);
    expect((await af.uploadLog("a b", "x.log", Buffer.from("x"))).ok).toBe(false);
    // traversal chars stripped from the filename
    const ok = await af.uploadLog("Fisternar", "../../escape.log", Buffer.from("y"));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.path).toContain("escape.log");
  });

  it("tailGameLog finds the latest .log recursively and tails with filtering", async () => {
    const res = await af.tailGameLog("fisternar", 2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.file).toBe("latest.log");
      expect(res.lines).toEqual(["line2", "line3"]);
    }
  });

  it("tailGameLog falls back to 80 lines for non-finite line counts", async () => {
    writeFileSync(
      join(LOGS, "GSIV-Fisternar", "many.log"),
      Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n"),
    );
    const res = await af.tailGameLog("fisternar", Number.NaN);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines.length).toBeLessThanOrEqual(80);
  });

  it("tailGameLog rejects invalid chars and returns file:null for unknowns", async () => {
    expect((await af.tailGameLog("../x", 5)).ok).toBe(false);
    const missing = await af.tailGameLog("Ghost");
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.file).toBeNull();
  });
});
