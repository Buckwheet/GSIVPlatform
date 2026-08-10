import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EntryYaml, EntryYamlError } from "../../src/core/entry-yaml.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "entry-yaml.fixture.yaml");
const TMP = mkdtempSync(join(tmpdir(), "entry-yaml-test-"));

describe("EntryYaml capability", () => {
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("parses the fixture into account/char_name/game_code rows", () => {
    const rows = new EntryYaml(FIXTURE).read();
    expect(rows).toEqual([
      { account: "Buckwheet", char_name: "Fisternar", game_code: "GSIV" },
      { account: "Buckwheet", char_name: "Zepherus", game_code: "GSIV" },
      { account: "alt", char_name: "Neleourg", game_code: "GSIV" },
    ]);
  });

  it("throws when the file is missing", () => {
    expect(() => new EntryYaml(join(FIXTURE, "nope.yaml")).read()).toThrow(EntryYamlError);
  });

  it("throws on a char_name that fails strict validation (fail closed)", () => {
    const p = join(TMP, "bad.yaml");
    writeFileSync(p, "accounts:\n  a:\n    characters:\n      - char_name: 'bad name!'\n        game_code: GSIV\n");
    expect(() => new EntryYaml(p).read()).toThrow(EntryYamlError);
  });

  it("returns an empty list when the accounts key is absent", () => {
    const p = join(TMP, "empty.yaml");
    writeFileSync(p, "some: other\nthing: here\n");
    expect(new EntryYaml(p).read()).toEqual([]);
  });
});
