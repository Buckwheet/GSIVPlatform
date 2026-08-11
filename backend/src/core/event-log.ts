import type { CoreDb } from "./db.js";

/**
 * Platform event history (v1 /api/logs port). A simple append-only audit trail:
 * modules call `log()` at interesting moments (server start/stop, WS sessions,
 * watchdog transitions); the API surfaces it newest-first with filters.
 * Rows older than 30 days are pruned on write.
 */

export interface EventRow {
  id: number;
  type: string;
  character: string | null;
  detail: string;
  source: string;
  ts: number;
}

const RETENTION_SECONDS = 30 * 24 * 60 * 60;

export class EventLog {
  constructor(private db: CoreDb) {
    this.db.migrate("events", [
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        character TEXT,
        detail TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'system',
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
      CREATE INDEX IF NOT EXISTS idx_events_char ON events (character);`,
    ]);
  }

  /** Append an event; prunes rows older than 30 days. */
  log(type: string, character: string | null, detail: string, source = "system"): void {
    const db = this.db.get();
    db.prepare("INSERT INTO events (type, character, detail, source, ts) VALUES (?, ?, ?, ?, ?)").run(
      type,
      character,
      detail,
      source,
      Math.floor(Date.now() / 1000),
    );
    db.prepare("DELETE FROM events WHERE ts < ?").run(Math.floor(Date.now() / 1000) - RETENTION_SECONDS);
  }

  /** Newest-first, optional type/character filters, capped limit. */
  list(opts: { limit?: number; offset?: number; type?: string; character?: string } = {}): EventRow[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const db = this.db.get();
    if (opts.type) {
      return db
        .prepare("SELECT * FROM events WHERE type = ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?")
        .all(opts.type, limit, offset) as unknown as EventRow[];
    }
    if (opts.character) {
      return db
        .prepare("SELECT * FROM events WHERE character = ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?")
        .all(opts.character, limit, offset) as unknown as EventRow[];
    }
    return db
      .prepare("SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as unknown as EventRow[];
  }
}
