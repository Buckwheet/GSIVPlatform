import Database from "better-sqlite3";

export class CoreDb {
  private db: Database.Database;

  constructor(dbPath: string = process.env.DB_PATH || ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        module TEXT NOT NULL,
        idx INTEGER NOT NULL,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (module, idx)
      );
    `);
  }

  get(): Database.Database {
    return this.db;
  }

  migrate(module: string, migrations: string[]): void {
    const applied = new Set(
      (this.db.prepare("SELECT idx FROM schema_migrations WHERE module = ?").all(module) as { idx: number }[]).map(
        (r) => r.idx,
      ),
    );
    const run = this.db.transaction(() => {
      migrations.forEach((sql, idx) => {
        if (applied.has(idx)) return;
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations (module, idx) VALUES (?, ?)").run(module, idx);
      });
    });
    run();
  }

  close(): void {
    this.db.close();
  }
}
