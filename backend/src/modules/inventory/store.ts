import Database from "better-sqlite3";

const DEFAULT_PATH = process.env.INV_DB_PATH || "/opt/gs4sd/lich5/data/inv.db3";

export class InventoryDbError extends Error {}

export class InventoryStore {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_PATH) {
    try {
      this.db = new Database(dbPath, { readonly: true });
      // WAL requires write access; skip it silently on read-only DBs.
      try {
        this.db.pragma("journal_mode = WAL");
      } catch {
        /* readonly database - fine */
      }
    } catch (err) {
      throw new InventoryDbError(`cannot open inventory DB at ${dbPath}: ${(err as Error).message}`);
    }
  }

  close(): void {
    this.db.close();
  }

  summary(): { characters: number; items: number; totalSilver: number } {
    const chars = this.db.prepare("SELECT COUNT(*) as n FROM character").get() as { n: number };
    const items = this.db.prepare("SELECT COUNT(*) as n FROM item").get() as { n: number };
    const totalSilver = this.db
      .prepare("SELECT SUM(amount) as n FROM silver WHERE bank_id IN (SELECT id FROM bank WHERE name != 'Total')")
      .get() as { n: number };
    return { characters: chars.n, items: items.n, totalSilver: totalSilver.n || 0 };
  }

  /** Newest write timestamp across the tables invdb populates, or null when empty. */
  latestTimestamp(): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(ts) AS ts FROM (
          SELECT MAX(timestamp) AS ts FROM character
          UNION ALL SELECT MAX(timestamp) FROM item
          UNION ALL SELECT MAX(timestamp) FROM silver
          UNION ALL SELECT MAX(timestamp) FROM resource
          UNION ALL SELECT MAX(timestamp) FROM tickets
        )`,
      )
      .get() as { ts: number | null };
    return row.ts ?? null;
  }

  characters(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT id, name, game, account, prof, race, level, exp, area, subscription, citizenship, society, society_rank, timestamp
         FROM character ORDER BY name`,
      )
      .all() as Record<string, unknown>[];
  }

  locations(): { name: string }[] {
    return this.db
      .prepare(
        `SELECT DISTINCT CASE WHEN name IN ('inv','worn','hands','container','alongside','locker','location') THEN name
         ELSE name || ' Locker' END as name FROM location ORDER BY name`,
      )
      .all() as { name: string }[];
  }

  bank(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.account, c.prof, c.level, b.name as bank, s.amount as silvers
         FROM silver s JOIN character c ON s.character_id = c.id JOIN bank b ON s.bank_id = b.id
         ORDER BY c.name, b.id`,
      )
      .all() as Record<string, unknown>[];
  }

  search(query: string, character?: string, location?: string): Record<string, unknown>[] {
    let where = "WHERE 1=1";
    const params: Record<string, string> = {};
    if (query) {
      where += " AND i.name LIKE :q";
      params.q = `%${query}%`;
    }
    if (character) {
      where += " AND c.name = :char";
      params.char = character;
    }
    if (location) {
      where +=
        " AND (CASE WHEN l.name IN ('inv','worn','hands','container','alongside','locker','location') THEN l.name ELSE l.name || ' Locker' END) = :loc";
      params.loc = location;
    }
    return this.db
      .prepare(
        `SELECT c.name as character, c.prof, c.level,
          CASE WHEN l.name IN ('inv','worn','hands','container','alongside','locker','location') THEN l.name
               ELSE l.name || ' Locker' END as location,
          i.name as item, i.noun, CAST(i.type AS TEXT) as type, i.amount, i.stack,
          CAST(i.status AS TEXT) as status, CAST(i.marked AS TEXT) as marked, CAST(i.worn AS TEXT) as worn
         FROM item i
         JOIN character c ON i.character_id = c.id
         JOIN location l ON i.location_id = l.id
         ${where}
         ORDER BY c.name, l.name, i.name
         LIMIT 500`,
      )
      .all(params) as Record<string, unknown>[];
  }

  resources(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.prof, c.level,
          CAST(r.energy AS TEXT) as energy, r.weekly, r.total, r.suffused,
          CAST(r.favor AS INTEGER) as favor, r.bonus
         FROM resource r JOIN character c ON r.character_id = c.id ORDER BY c.name`,
      )
      .all() as Record<string, unknown>[];
  }

  tickets(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.prof, c.level, t.source, t.amount, t.currency
         FROM tickets t JOIN character c ON t.character_id = c.id ORDER BY c.name, t.source`,
      )
      .all() as Record<string, unknown>[];
  }
}
