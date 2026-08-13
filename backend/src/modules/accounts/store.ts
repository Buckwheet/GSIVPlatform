import type { CoreDb } from "../../core/db.js";
import type { EntryYaml } from "../../core/entry-yaml.js";
import type { InvDbCleaner } from "../../core/inv-db.js";
import type { Ruby } from "../../core/ruby.js";
import type { Sge } from "../../core/sge.js";
import type { CharFailure, CharFailureClassified } from "../scans/store.js";

/** SGE errors that mean "couldn't reach/verify SGE" rather than a definitive auth rejection. */
const SGE_TRANSPORT_RE = /timeout|certificate|ECONN|ENOTFOUND|ETIMEDOUT|EAI_|getaddrinfo/i;

// ---------------------------------------------------------------------------
// AccountsStore: scan orchestration + scan-result persistence (CoreDb).
// Credentials are only handled inside the review-gated capabilities
// (Ruby PasswordCipher, Sge) and are never logged or returned by routes.
// The v2 scan is SGE auth + active character list + entry.yaml chars;
// playdotnet/store scraping is a tracked follow-on (plan Task 9).
// ---------------------------------------------------------------------------

export interface ScanAccountRow {
  account_name: string;
  auth_status: string;
  auth_error: string | null;
  store_balance: number | null;
  store_reward_next: string | null;
  last_scan: number;
  no_active_chars: number;
}

export interface ScanCharacterRow {
  account_name: string;
  char_name: string;
  slot: string | null;
  game_code: string;
  source: string;
  level?: number | null;
  race?: string | null;
  profession?: string | null;
  last_login?: string | null;
  status: string;
  auto_added: number;
  last_seen?: number | null;
  transferred_to?: string | null;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS accounts (
    account_name TEXT PRIMARY KEY,
    auth_status TEXT NOT NULL DEFAULT 'unknown',
    auth_error TEXT,
    store_balance REAL,
    store_reward_next TEXT,
    last_scan INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS account_characters (
    account_name TEXT NOT NULL,
    char_name TEXT NOT NULL,
    slot TEXT,
    game_code TEXT,
    source TEXT,
    level INTEGER,
    race TEXT,
    profession TEXT,
    last_login TEXT,
    last_seen INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acct_chars ON account_characters(account_name)`,
  `ALTER TABLE account_characters ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE account_characters ADD COLUMN auto_added INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE accounts ADD COLUMN no_active_chars INTEGER NOT NULL DEFAULT 0`,
];

export class AccountsStore {
  private running = false;
  private active: Promise<void> | null = null;
  private readonly db;

  constructor(
    db: CoreDb,
    private yaml: EntryYaml,
    private ruby: Ruby,
    private sge: Sge,
    private invDb: InvDbCleaner,
    private opts: {
      delayMs?: number;
      emit?: (type: string, payload: unknown) => void;
      log?: (type: string, char: string | null, detail: string, source: string) => void;
    } = {},
  ) {
    db.migrate("accounts", MIGRATIONS);
    this.db = db.get();
  }

  scanRunning(): boolean {
    return this.running;
  }

  /** Resolves when the current background scan finishes (test/dev helper). */
  async whenIdle(): Promise<void> {
    if (this.active) await this.active;
  }

  /** Scan every entry.yaml account in the background (v1: 30s spacing). */
  async scanAll(): Promise<{ ok: boolean; error?: string; total?: number; message?: string }> {
    if (this.running) return { ok: false, error: "scan already running" };
    this.running = true;
    const accounts = new Map<string, { char_name: string; game_code: string }[]>();
    for (const ch of this.safeYamlChars()) {
      const list = accounts.get(ch.account) ?? [];
      list.push({ char_name: ch.char_name, game_code: ch.game_code });
      accounts.set(ch.account, list);
    }
    const total = accounts.size;
    const delayMs = this.opts.delayMs ?? 30_000;
    this.active = (async () => {
      try {
        for (const [acct, chars] of accounts) {
          try {
            await this.scanOne(acct, chars);
          } catch (err) {
            console.error(`scan error for ${acct}:`, (err as Error).message);
          }
          await sleep(delayMs);
        }
      } finally {
        this.running = false;
      }
    })();
    return { ok: true, total, message: "scan started" };
  }

  /** Scan a single account. */
  async scanOne(
    name: string,
    yamlChars?: { char_name: string; game_code: string }[],
  ): Promise<{ ok: boolean; error?: string }> {
    const r = await this.refresh(name, yamlChars);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  /**
   * Re-run the SGE auth + character-list check for one account and persist the
   * result (the original scanOne body). Used by scanOne and the failure
   * classifier. Returns the persisted auth state on success.
   */
  async refresh(
    name: string,
    yamlChars?: { char_name: string; game_code: string }[],
  ): Promise<{ ok: boolean; error?: string; authStatus: string; authError: string | null }> {
    const accountName = name.toUpperCase();
    const chars =
      yamlChars ??
      this.safeYamlChars()
        .filter((c) => c.account === accountName)
        .map((c) => ({ char_name: c.char_name, game_code: c.game_code }));
    if (!chars.length) {
      return { ok: false, error: "account not found in entry.yaml", authStatus: "unknown", authError: null };
    }

    const gameCode = chars[0].game_code || "GS3";
    let authStatus = "unknown";
    let authError: string | null = null;
    const characters: ScanCharacterRow[] = [];

    const decrypted = await this.ruby.decryptPassword(accountName, this.yaml.path);
    if (!decrypted.ok) {
      authStatus = "decrypt_error";
      authError = decrypted.error;
      this.saveScan(accountName, authStatus, authError, this.yamlOnlyChars(accountName, chars), 0);
      return { ok: true, authStatus, authError };
    }

    try {
      const sgeChars = await this.sge.listCharacters(accountName, decrypted.plain, gameCode);
      authStatus = "ok";
      const yamlMap = new Map(chars.map((c) => [c.char_name.toLowerCase(), c]));
      const autoAdded = new Set<string>();
      for (const sc of sgeChars) {
        if (yamlMap.has(sc.name.toLowerCase())) continue;
        try {
          const r = this.yaml.addCharacter(accountName, sc.name, gameCode);
          if (r.ok) {
            autoAdded.add(sc.name.toLowerCase());
            console.error(`roster-sync: auto-added ${sc.name} to entry.yaml (${accountName})`);
          } else {
            console.error(`roster-sync: auto-add failed for ${sc.name} (${accountName}): ${r.error}`);
          }
        } catch (err) {
          console.error(`roster-sync: auto-add error for ${sc.name} (${accountName}):`, (err as Error).message);
        }
      }
      for (const sc of sgeChars) {
        characters.push({
          account_name: accountName,
          char_name: sc.name,
          slot: sc.slot,
          game_code: yamlMap.get(sc.name.toLowerCase())?.game_code ?? gameCode,
          source: "sge",
          status: "active",
          auto_added: autoAdded.has(sc.name.toLowerCase()) ? 1 : 0,
        });
      }
      const sgeNames = new Set(sgeChars.map((c) => c.name.toLowerCase()));
      for (const c of chars) {
        if (!sgeNames.has(c.char_name.toLowerCase())) {
          characters.push({
            account_name: accountName,
            char_name: c.char_name,
            slot: null,
            game_code: c.game_code,
            source: "entry_yaml",
            status: "entry_only",
            auto_added: 0,
          });
        }
      }
    } catch (err) {
      authStatus = (err as Error).message === "invalid_password" ? "bad_password" : "error";
      authError = (err as Error).message;
      this.saveScan(accountName, authStatus, authError, this.yamlOnlyChars(accountName, chars), 0);
      return { ok: true, authStatus, authError };
    }

    const noActiveChars = authStatus === "ok" && characters.every((c) => c.status !== "active") ? 1 : 0;
    this.saveScan(accountName, authStatus, authError, characters, noActiveChars);
    return { ok: true, authStatus, authError };
  }

  /** Classify failed scan chars by cross-referencing a fresh SGE re-check. */
  async refreshAndClassify(account: string, failed: CharFailure[]): Promise<CharFailureClassified[]> {
    const r = await this.refresh(account);
    return failed.map((f) => this.classifyFailure(account, f, r.authStatus, r.authError));
  }

  private classifyFailure(
    account: string,
    f: CharFailure,
    authStatus: string,
    authError: string | null,
  ): CharFailureClassified {
    if (f.result === "failed") {
      return { ...f, code: "start_failed", reason: `systemd start failed: ${f.error ?? "unknown"}` };
    }
    if (authStatus === "bad_password") {
      return { ...f, code: "auth_bad_password", reason: "account auth: bad_password" };
    }
    if (authStatus === "decrypt_error") {
      return { ...f, code: "auth_decrypt_error", reason: `account password decrypt failed: ${authError ?? ""}` };
    }
    if (authStatus === "error") {
      if (SGE_TRANSPORT_RE.test(authError ?? "")) {
        return { ...f, code: "sge_unreachable", reason: "SGE unreachable during re-check (retry later)" };
      }
      return { ...f, code: "auth_error", reason: `account auth: ${authError ?? "error"}` };
    }
    const row = this.db
      .prepare("SELECT status FROM account_characters WHERE account_name = ? AND LOWER(char_name) = LOWER(?)")
      .get(account.toUpperCase(), f.char) as { status?: string } | undefined;
    if (row?.status !== "active") {
      return { ...f, code: "char_disabled", reason: "character not active on SGE (disabled/inactive/deleted)" };
    }
    if (f.result === "timeout" && f.error === "no invdb write") {
      return { ...f, code: "no_write", reason: "character online but inv.db3 not written (script/mechanical flake)" };
    }
    return { ...f, code: "transient", reason: "character active + auth ok but never came online (timing flake)" };
  }

  /** Accounts + characters from the scan results. */
  async list(): Promise<{ accounts: ScanAccountRow[]; characters: ScanCharacterRow[] }> {
    const accounts = this.db.prepare("SELECT * FROM accounts ORDER BY account_name").all() as ScanAccountRow[];
    const characters = this.db
      .prepare("SELECT * FROM account_characters ORDER BY account_name, char_name")
      .all() as ScanCharacterRow[];
    return { accounts, characters };
  }

  async deleteAccount(name: string): Promise<void> {
    const accountName = name.toUpperCase();
    this.db.prepare("DELETE FROM account_characters WHERE account_name = ?").run(accountName);
    this.db.prepare("DELETE FROM accounts WHERE account_name = ?").run(accountName);
  }

  async deleteCharacter(accountName: string, charName: string): Promise<number> {
    return this.db
      .prepare("DELETE FROM account_characters WHERE account_name = ? AND LOWER(char_name) = LOWER(?)")
      .run(accountName.toUpperCase(), charName).changes;
  }

  /** Add an entry.yaml account (password encrypted via the Ruby capability). */
  async addAccount(
    name: string,
    plainPassword: string,
  ): Promise<{ ok: boolean; code?: "exists" | "encrypt" | "invalid"; error?: string; name?: string }> {
    const key = name.toUpperCase();
    const encrypted = await this.ruby.encryptPassword(key, plainPassword);
    if (!encrypted.ok) return { ok: false, code: "encrypt", error: encrypted.error };
    const res = await this.yaml.addAccount(key, encrypted.encrypted);
    if (!res.ok) return { ok: false, code: "exists", error: res.error };
    return { ok: true, name: res.name };
  }

  /** Update an account password (encrypted via the Ruby capability). */
  async updateAccountPassword(
    name: string,
    plainPassword: string,
  ): Promise<{ ok: boolean; code?: "encrypt"; error?: string; name?: string }> {
    const key = name.toUpperCase();
    const encrypted = await this.ruby.encryptPassword(key, plainPassword);
    if (!encrypted.ok) return { ok: false, code: "encrypt", error: encrypted.error };
    return this.yaml.updatePassword(key, encrypted.encrypted);
  }

  /** Add a character to an entry.yaml account (Lich default fields). */
  async addEntryCharacter(
    accountName: string,
    charName: string,
    gameCode: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.yaml.addCharacter(accountName.toUpperCase(), charName, gameCode || "GS3");
  }

  /** Rows flagged as stale (entry_only) + accounts with auth problems (feed for cleanup). */
  async stale(): Promise<{ characters: ScanCharacterRow[]; accounts: ScanAccountRow[] }> {
    const rows = this.db
      .prepare("SELECT * FROM account_characters WHERE status = 'entry_only' ORDER BY account_name, char_name")
      .all() as ScanCharacterRow[];
    const activeElsewhere = this.db.prepare(
      "SELECT account_name FROM account_characters WHERE LOWER(char_name) = LOWER(?) AND account_name != ? AND status = 'active' LIMIT 1",
    );
    const characters = rows.map((c) => {
      const other = activeElsewhere.get(c.char_name, c.account_name) as { account_name?: string } | undefined;
      return { ...c, transferred_to: other?.account_name ?? null };
    });
    const accounts = this.db
      .prepare(
        "SELECT * FROM accounts WHERE auth_status IN ('bad_password', 'error', 'decrypt_error') ORDER BY account_name",
      )
      .all() as ScanAccountRow[];
    return { characters, accounts };
  }

  /**
   * Drop every flagged account/char from entry.yaml + gsiv.db + inv.db3.
   * Dead accounts are removed first (taking their chars with them); the
   * remaining entry_only chars on live accounts are removed individually.
   * No password decrypt — deletion only needs names. dryRun previews the
   * exact set without mutating anything (review before the real run).
   */
  async cleanupStale(dryRun = false): Promise<{
    ok: boolean;
    dryRun: boolean;
    removedAccounts: number;
    removedCharacters: number;
    steps: { action: string; result: string }[];
  }> {
    const { accounts, characters } = await this.stale();
    const steps: { action: string; result: string }[] = [];
    let removedAccounts = 0;
    let removedCharacters = 0;
    const dead = new Set(accounts.map((a) => a.account_name));

    for (const acct of accounts) {
      const key = acct.account_name;
      if (dryRun) {
        removedAccounts += 1;
        steps.push({
          action: `Would remove account ${key} (entry.yaml + dashboard DB + inv.db3)`,
          result: "dry-run",
        });
        continue;
      }
      const y = this.yaml.deleteAccount(key);
      steps.push({ action: `Remove ${key} from entry.yaml`, result: y.removed ? "ok" : "not found" });
      if (y.removed) removedAccounts += 1;
      await this.deleteAccount(key);
      steps.push({ action: `Remove ${key} from dashboard DB`, result: "ok" });
      const inv = this.invDb.deleteAccounts([key]);
      steps.push({
        action: `Remove ${key} chars from inv.db3`,
        result: inv.ok ? `ok (${inv.removedCharacters} chars, ${inv.removedItems} items)` : `error: ${inv.error}`,
      });
    }

    for (const ch of characters) {
      if (dead.has(ch.account_name)) continue; // already removed with the account
      if (dryRun) {
        removedCharacters += 1;
        steps.push({
          action: `Would remove ${ch.char_name} (${ch.account_name})`,
          result: "dry-run",
        });
        continue;
      }
      const y = this.yaml.deleteCharacter(ch.account_name, ch.char_name);
      steps.push({
        action: `Remove ${ch.char_name} (${ch.account_name}) from entry.yaml`,
        result: y.removed ? "ok" : "not found",
      });
      if (y.removed) removedCharacters += 1;
      const dbRemoved = (await this.deleteCharacter(ch.account_name, ch.char_name)) > 0;
      steps.push({
        action: `Remove ${ch.char_name} (${ch.account_name}) from dashboard DB`,
        result: dbRemoved ? "ok" : "not found",
      });
      const inv = this.invDb.deleteCharacters([{ name: ch.char_name, account: ch.account_name }]);
      steps.push({
        action: `Remove ${ch.char_name} (${ch.account_name}) from inv.db3`,
        result: inv.ok ? `ok (${inv.removedCharacters} chars, ${inv.removedItems} items)` : `error: ${inv.error}`,
      });
    }

    return { ok: true, dryRun, removedAccounts, removedCharacters, steps };
  }

  /** Delete an account: entry.yaml + scan db, with per-step results (v1 steps shape). */
  async deleteAccountWithSteps(name: string): Promise<{ steps: { action: string; result: string }[] }> {
    const key = name.toUpperCase();
    const steps: { action: string; result: string }[] = [];
    const y = this.yaml.deleteAccount(key);
    steps.push({ action: `Remove ${key} from entry.yaml`, result: y.removed ? "ok" : "not found" });
    await this.deleteAccount(key);
    steps.push({ action: "Remove from dashboard database", result: "ok" });
    return { steps };
  }

  /** Delete a character: entry.yaml + scan db, with per-step results. */
  async deleteCharacterWithSteps(
    accountName: string,
    charName: string,
  ): Promise<{ steps: { action: string; result: string }[] }> {
    const key = accountName.toUpperCase();
    const steps: { action: string; result: string }[] = [];
    const y = this.yaml.deleteCharacter(key, charName);
    steps.push({ action: `Remove ${charName} from entry.yaml`, result: y.removed ? "ok" : "not found" });
    const dbRemoved = (await this.deleteCharacter(key, charName)) > 0;
    steps.push({ action: "Remove from dashboard database", result: dbRemoved ? "ok" : "not found" });
    return { steps };
  }

  private yamlOnlyChars(accountName: string, chars: { char_name: string; game_code: string }[]): ScanCharacterRow[] {
    return chars.map((c) => ({
      account_name: accountName,
      char_name: c.char_name,
      slot: null,
      game_code: c.game_code,
      source: "entry_yaml",
      status: "entry_only",
      auto_added: 0,
    }));
  }

  private safeYamlChars() {
    try {
      return this.yaml.read();
    } catch {
      return [];
    }
  }

  private saveScan(
    accountName: string,
    authStatus: string,
    authError: string | null,
    characters: ScanCharacterRow[],
    noActiveChars: number,
  ): void {
    const prev = this.db.prepare("SELECT no_active_chars FROM accounts WHERE account_name = ?").get(accountName) as
      | { no_active_chars?: number }
      | undefined;
    const wasFlagged = (prev?.no_active_chars ?? 0) === 1;
    this.db
      .prepare(
        `INSERT INTO accounts (account_name, auth_status, auth_error, no_active_chars, store_balance, store_reward_next, last_scan)
         VALUES (?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(account_name) DO UPDATE SET auth_status=excluded.auth_status, auth_error=excluded.auth_error, no_active_chars=excluded.no_active_chars, last_scan=excluded.last_scan`,
      )
      .run(accountName, authStatus, authError, noActiveChars, Date.now());
    if (!wasFlagged && noActiveChars === 1) {
      this.opts.emit?.("no_chars_alert", {
        account: accountName,
        message: `${accountName}: auth ok but no active characters`,
      });
      this.opts.log?.("no_active_chars", null, `${accountName}: auth ok but no active characters`, "roster");
    }
    const now = Date.now();
    const find = this.db.prepare(
      "SELECT last_seen FROM account_characters WHERE account_name = ? AND LOWER(char_name) = LOWER(?)",
    );
    const update = this.db.prepare(
      `UPDATE account_characters
       SET slot = ?, game_code = ?, source = ?, status = ?, auto_added = ?,
           last_seen = COALESCE(?, last_seen)
       WHERE account_name = ? AND LOWER(char_name) = LOWER(?)`,
    );
    const insert = this.db.prepare(
      `INSERT INTO account_characters (account_name, char_name, slot, game_code, source, status, auto_added, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of characters) {
      const status = c.status ?? "active";
      const lastSeen = status === "active" ? now : null; // entry_only keeps its history
      if (find.get(accountName, c.char_name)) {
        update.run(c.slot, c.game_code, c.source, status, c.auto_added ?? 0, lastSeen, accountName, c.char_name);
      } else {
        insert.run(accountName, c.char_name, c.slot, c.game_code, c.source, status, c.auto_added ?? 0, lastSeen);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
