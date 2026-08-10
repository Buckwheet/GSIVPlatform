import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that reads the
// Lich entry.yaml (SECURITY.md: entry.yaml access goes through a dedicated
// capability). Parse-only (the `yaml` package never evaluates), every char_name
// is validated against the same strict regex used by the systemd capability.
// ---------------------------------------------------------------------------

export interface EntryChar {
  account: string;
  char_name: string;
  game_code: string;
}

export class EntryYamlError extends Error {}

const DEFAULT_PATH = process.env.ENTRY_YAML_PATH || "/opt/gs4sd/lich5/data/entry.yaml";

interface EntryYamlShape {
  accounts?: Record<string, { characters?: { char_name?: unknown; game_code?: unknown }[] }>;
}

export class EntryYaml {
  constructor(private path: string = DEFAULT_PATH) {}

  /** Parse entry.yaml into launchable characters. Throws on read/parse/validation failure. */
  read(): EntryChar[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf-8");
    } catch (err) {
      throw new EntryYamlError(`cannot read entry.yaml at ${this.path}: ${(err as Error).message}`);
    }
    let data: EntryYamlShape;
    try {
      data = parseYaml(raw) as EntryYamlShape;
    } catch (err) {
      throw new EntryYamlError(`cannot parse entry.yaml at ${this.path}: ${(err as Error).message}`);
    }
    if (!data || typeof data !== "object" || !data.accounts) return [];
    const rows: EntryChar[] = [];
    for (const [account, info] of Object.entries(data.accounts)) {
      for (const ch of info?.characters ?? []) {
        if (typeof ch?.char_name !== "string") {
          throw new EntryYamlError(`entry.yaml: account '${account}' has a character without a char_name`);
        }
        try {
          validateCharName(ch.char_name);
        } catch {
          throw new EntryYamlError(`entry.yaml: invalid char_name '${ch.char_name}' in account '${account}'`);
        }
        rows.push({
          account,
          char_name: ch.char_name,
          game_code: typeof ch.game_code === "string" ? ch.game_code : "GSIV",
        });
      }
    }
    return rows;
  }
}
