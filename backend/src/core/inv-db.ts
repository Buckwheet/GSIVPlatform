import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that WRITES the
// Lich inventory database (inv.db3). The inventory module opens it read-only;
// this capability adds the destructive cleanup path (stale-char deletion),
// following the EntryYaml pattern: backup-then-write, strict inputs, no
// user-controlled SQL. The invdb schema has no ON DELETE CASCADE, so child rows
// (item/silver/resource/tickets/lumnis) are deleted explicitly before the
// character row. Account names come from the already-validated roster.
// ---------------------------------------------------------------------------

const DEFAULT_PATH = process.env.INV_DB_PATH || "/opt/gs4sd/lich5/data/inv.db3";

export class InvDbError extends Error {}

export interface InvDeleteTarget {
  name: string;
  account: string;
}

export interface InvDeleteResult {
  ok: boolean;
  error?: string;
  removedCharacters: number;
  removedItems: number;
}

/** Child tables keyed by character_id, in deletion order. */
const CHILD_TABLES = ["item", "silver", "resource", "tickets", "lumnis"] as const;

/** Minimal write surface the accounts store needs (injectable for tests). */
export interface InvDbCleaner {
  deleteCharacters(targets: InvDeleteTarget[]): InvDeleteResult;
  deleteAccounts(accounts: string[]): InvDeleteResult;
}

export class InvDb implements InvDbCleaner {
  private db: Database.Database | null = null;
  private openError: string | null = null;

  constructor(private readonly dbPath: string = DEFAULT_PATH) {}

  get path(): string {
    return this.dbPath;
  }

  private open(): Database.Database {
    if (this.db) return this.db;
    if (this.openError) throw new InvDbError(this.openError);
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma("busy_timeout = 5000");
    } catch (err) {
      this.openError = (err as Error).message;
      throw new InvDbError(this.openError);
    }
    return this.db;
  }

  /** Snapshot inv.db3 before any mutation (flush WAL, copy, rotate to 5). */
  private backup(): void {
    if (!existsSync(this.dbPath)) return;
    const db = this.db;
    if (!db) return;
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // not in WAL mode — the raw file copy is already consistent
    }
    copyFileSync(this.dbPath, `${this.dbPath}.bak.${Date.now()}`);
    this.rotateBackups();
  }

  private rotateBackups(): void {
    const dir = dirname(this.dbPath);
    const base = `${basename(this.dbPath)}.bak.`;
    const num = (f: string) => Number.parseInt(f.slice(base.length), 10) || 0;
    const backups = readdirSync(dir)
      .filter((f) => f.startsWith(base))
      .sort((a, b) => num(a) - num(b));
    for (const old of backups.slice(0, Math.max(0, backups.length - 5))) {
      try {
        rmSync(join(dir, old));
      } catch {
        // best effort — a failed prune must not fail the write
      }
    }
  }

  /**
   * Delete specific characters (by name + account, case-insensitive) and their
   * child rows. Returns ok/error instead of throwing so the route can report it.
   */
  deleteCharacters(targets: InvDeleteTarget[]): InvDeleteResult {
    try {
      if (targets.length === 0) return { ok: true, removedCharacters: 0, removedItems: 0 };
      const db = this.open();
      this.backup();
      let removedCharacters = 0;
      let removedItems = 0;
      const findIds = db.prepare("SELECT id FROM character WHERE UPPER(name) = UPPER(?) AND UPPER(account) = UPPER(?)");
      const delChild = db.prepare("DELETE FROM item WHERE character_id = ?");
      const delTable = (table: string) => db.prepare(`DELETE FROM ${table} WHERE character_id = ?`);
      const delChar = db.prepare("DELETE FROM character WHERE id = ?");
      const tx = db.transaction(() => {
        for (const t of targets) {
          const rows = findIds.all(t.name, t.account) as { id: number }[];
          for (const { id } of rows) {
            removedItems += delChild.run(id).changes;
            for (const table of CHILD_TABLES) if (table !== "item") delTable(table).run(id);
            delChar.run(id);
            removedCharacters += 1;
          }
        }
      });
      tx();
      return { ok: true, removedCharacters, removedItems };
    } catch (err) {
      return { ok: false, error: (err as Error).message, removedCharacters: 0, removedItems: 0 };
    }
  }

  /**
   * Delete every character of the given accounts (case-insensitive) + their
   * child rows, then the account rows. Used for dead accounts.
   */
  deleteAccounts(accounts: string[]): InvDeleteResult {
    try {
      if (accounts.length === 0) return { ok: true, removedCharacters: 0, removedItems: 0 };
      const db = this.open();
      this.backup();
      let removedCharacters = 0;
      let removedItems = 0;
      const findIds = db.prepare("SELECT id FROM character WHERE UPPER(account) = UPPER(?)");
      const delChild = db.prepare("DELETE FROM item WHERE character_id = ?");
      const delTable = (table: string) => db.prepare(`DELETE FROM ${table} WHERE character_id = ?`);
      const delChar = db.prepare("DELETE FROM character WHERE id = ?");
      const delAccount = db.prepare("DELETE FROM account WHERE UPPER(account) = UPPER(?)");
      const tx = db.transaction(() => {
        for (const acct of accounts) {
          const rows = findIds.all(acct) as { id: number }[];
          for (const { id } of rows) {
            removedItems += delChild.run(id).changes;
            for (const table of CHILD_TABLES) if (table !== "item") delTable(table).run(id);
            delChar.run(id);
            removedCharacters += 1;
          }
          delAccount.run(acct);
        }
      });
      tx();
      return { ok: true, removedCharacters, removedItems };
    } catch (err) {
      return { ok: false, error: (err as Error).message, removedCharacters: 0, removedItems: 0 };
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
