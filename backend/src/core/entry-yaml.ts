import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify } from "yaml";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that reads or
// writes the Lich entry.yaml (SECURITY.md: entry.yaml access goes through a
// dedicated capability). Parse-only (the `yaml` package never evaluates),
// every char_name is validated against the same strict regex used by the
// systemd capability. Writes are backup-then-write (v1 semantics).
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

interface YamlAccount {
  password?: unknown;
  characters?: Record<string, unknown>[];
}

interface YamlDoc {
  accounts?: Record<string, YamlAccount>;
}

export type EntryWriteResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const GAME_CODE_RE = /^[A-Za-z0-9]{2,8}$/;

function accountKey(name: string): string {
  return name.toUpperCase();
}

function normalizedCharName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function readDoc(path: string): YamlDoc {
  const raw = readFileSync(path, "utf-8");
  const doc = parseYaml(raw) as YamlDoc;
  return doc && typeof doc === "object" && doc.accounts ? doc : { accounts: {} };
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
          account: account.toUpperCase(),
          char_name: ch.char_name,
          game_code: typeof ch.game_code === "string" ? ch.game_code : "GSIV",
        });
      }
    }
    return rows;
  }

  /** Backup the current file (`.bak.<ts>`) then write new content. */
  write(content: string): void {
    const backup = `${this.path}.bak.${Date.now()}`;
    copyFileSync(this.path, backup);
    writeFileSync(this.path, content);
  }

  private writeDoc(doc: YamlDoc): void {
    this.write(stringify(doc));
  }

  /** Add an account with its (already encrypted) password; error on duplicate. */
  addAccount(name: string, encryptedPassword: string): EntryWriteResult<{ name: string }> {
    try {
      validateCharName(name);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    const key = accountKey(name);
    const doc = readDoc(this.path);
    if (Object.keys(doc.accounts ?? {}).some((k) => k.toUpperCase() === key)) {
      return { ok: false, error: `account ${key} already exists` };
    }
    doc.accounts ??= {};
    doc.accounts[key] = { password: encryptedPassword, characters: [] };
    this.writeDoc(doc);
    return { ok: true, name: key };
  }

  /** Remove an account; removed=false when absent. */
  deleteAccount(name: string): { ok: true; removed: boolean } {
    const key = accountKey(name);
    const doc = readDoc(this.path);
    const found = Object.keys(doc.accounts ?? {}).some((k) => k.toUpperCase() === key);
    if (found) {
      for (const k of Object.keys(doc.accounts ?? {})) {
        if (k.toUpperCase() === key) delete doc.accounts?.[k];
      }
      this.writeDoc(doc);
    }
    return { ok: true, removed: found };
  }

  /** Replace the stored encrypted password; error when the account is unknown. */
  updatePassword(name: string, encryptedPassword: string): EntryWriteResult<{ name: string }> {
    const key = accountKey(name);
    const doc = readDoc(this.path);
    const existing = Object.entries(doc.accounts ?? {}).find(([k]) => k.toUpperCase() === key);
    if (!existing) return { ok: false, error: `account ${key} not found` };
    existing[1].password = encryptedPassword;
    this.writeDoc(doc);
    return { ok: true, name: key };
  }

  /** Add a character to an account (Lich default fields); error on dup or unknown account. */
  addCharacter(accountName: string, charName: string, gameCode: string): EntryWriteResult<{ char_name: string }> {
    try {
      validateCharName(charName);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    if (!GAME_CODE_RE.test(gameCode)) return { ok: false, error: `invalid game_code: ${JSON.stringify(gameCode)}` };
    const key = accountKey(accountName);
    const doc = readDoc(this.path);
    const account = Object.entries(doc.accounts ?? {}).find(([k]) => k.toUpperCase() === key);
    if (!account) return { ok: false, error: `account ${key} not found` };
    const chars = account[1].characters ?? [];
    const name = normalizedCharName(charName);
    if (chars.some((c) => typeof c.char_name === "string" && c.char_name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `character ${name} already exists` };
    }
    chars.push({
      char_name: name,
      game_code: gameCode,
      game_name: gameCode === "GSF" ? "GemStone IV Shattered" : "GemStone IV",
      frontend: "stormfront",
      custom_launch: null,
      custom_launch_dir: null,
      is_favorite: false,
    });
    account[1].characters = chars;
    this.writeDoc(doc);
    return { ok: true, char_name: name };
  }

  /** Remove a character from an account; removed=false when absent. */
  deleteCharacter(accountName: string, charName: string): { ok: true; removed: boolean } {
    const key = accountKey(accountName);
    const doc = readDoc(this.path);
    const account = Object.entries(doc.accounts ?? {}).find(([k]) => k.toUpperCase() === key);
    let removed = false;
    if (account) {
      const chars = account[1].characters ?? [];
      const next = chars.filter(
        (c) => typeof c.char_name !== "string" || c.char_name.toLowerCase() !== charName.toLowerCase(),
      );
      if (next.length !== chars.length) {
        account[1].characters = next;
        this.writeDoc(doc);
        removed = true;
      }
    }
    return { ok: true, removed };
  }
}
