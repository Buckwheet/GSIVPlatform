import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EntryYaml } from "../../src/core/entry-yaml.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "entry-yaml.fixture.yaml");
const TMP = mkdtempSync(join(tmpdir(), "entry-yaml-crud-"));

function freshYaml(): { yaml: EntryYaml; path: string } {
  const p = join(TMP, `entry-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  copyFileSync(FIXTURE, p);
  return { yaml: new EntryYaml(p), path: p };
}

describe("EntryYaml CRUD", () => {
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it("addAccount writes an account with an encrypted password and empty characters", () => {
    const { yaml } = freshYaml();
    const res = yaml.addAccount("NEWACCT", "ENC:abc");
    expect(res).toEqual({ ok: true, name: "NEWACCT" });
    expect(yaml.read().filter((r) => r.account === "NEWACCT")).toEqual([]);
  });

  it("addAccount rejects a duplicate account", () => {
    const { yaml } = freshYaml();
    expect(yaml.addAccount("BUCKWHEET", "x")).toEqual({ ok: false, error: expect.stringContaining("exists") });
  });

  it("addCharacter adds a char with Lich defaults; rejects duplicates and unknown accounts", () => {
    const { yaml } = freshYaml();
    const ok = yaml.addCharacter("BUCKWHEET", "Newchar", "GS3");
    expect(ok).toEqual(expect.objectContaining({ ok: true }));
    const rows = yaml.read();
    const added = rows.find((c) => c.char_name === "Newchar");
    expect(added).toEqual({ account: "BUCKWHEET", char_name: "Newchar", game_code: "GS3" });
    expect(yaml.addCharacter("BUCKWHEET", "newchar", "GS3")).toEqual({
      ok: false,
      error: expect.stringContaining("exists"),
    });
    expect(yaml.addCharacter("GHOST", "Xyz", "GS3")).toEqual({
      ok: false,
      error: expect.stringContaining("not found"),
    });
  });

  it("deleteCharacter removes a char; reports not-found when absent", () => {
    const { yaml } = freshYaml();
    expect(yaml.deleteCharacter("BUCKWHEET", "fisternar")).toEqual({ ok: true, removed: true });
    expect(yaml.deleteCharacter("BUCKWHEET", "fisternar")).toEqual({ ok: true, removed: false });
  });

  it("updatePassword updates the stored encrypted password; unknown account errors", () => {
    const { yaml } = freshYaml();
    expect(yaml.updatePassword("BUCKWHEET", "ENC:new")).toEqual(expect.objectContaining({ ok: true }));
    expect(yaml.updatePassword("GHOST", "x")).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("deleteAccount removes the account and reports whether it was present", () => {
    const { yaml } = freshYaml();
    expect(yaml.deleteAccount("BUCKWHEET")).toEqual({ ok: true, removed: true });
    expect(yaml.deleteAccount("BUCKWHEET")).toEqual({ ok: true, removed: false });
  });

  it("write() backs up the previous file before writing", () => {
    const { yaml, path } = freshYaml();
    yaml.write("new: content\n");
    const backups = readdirSync(TMP).filter((f) => f.startsWith("entry-") && f.includes(".bak."));
    expect(backups.length).toBeGreaterThan(0);
    expect(require("node:fs").readFileSync(path, "utf-8")).toBe("new: content\n");
  });

  it("rejects invalid account/char names (fail closed)", () => {
    const { yaml } = freshYaml();
    expect(yaml.addAccount("../evil", "x").ok).toBe(false);
    expect(yaml.addCharacter("BUCKWHEET", "bad name!", "GS3").ok).toBe(false);
    expect(yaml.addCharacter("BUCKWHEET", "Zepherus", "GS;rm").ok).toBe(false);
  });
});
