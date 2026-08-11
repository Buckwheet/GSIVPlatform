import type { CoreDb } from "../../core/db.js";

export interface Shop {
  id: number;
  name: string;
  town: string | null;
  created_at: string;
}

export interface Sale {
  item_id: string;
  name: string;
  town: string;
  shop: string;
  cost: number | null;
  removed_date: string;
}

export interface Notification {
  id: number;
  item_id: string;
  shop: string;
  name: string;
  cost: number | null;
  removed_date: string;
  created_at: string;
  acknowledged_at: string | null;
}

export interface ScanResult {
  new: number;
  baselined: number;
  notifications: Notification[];
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    town TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS seen (
    item_id TEXT PRIMARY KEY,
    shop TEXT NOT NULL,
    removed_date TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    shop TEXT NOT NULL,
    name TEXT NOT NULL,
    cost INTEGER,
    removed_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT
  )`,
];

const DEFAULT_SHOPS = ["Erendiir", "Boiler", "Jinsem"] as const;

export class YourShopsStore {
  constructor(private db: CoreDb) {
    this.db.migrate("your-shops", MIGRATIONS);
  }

  seedDefaultIfEmpty(): void {
    const row = this.db.get().prepare("SELECT COUNT(*) AS n FROM shops").get() as { n: number };
    if (row.n > 0) return;
    const ins = this.db.get().prepare("INSERT INTO shops (name, town, created_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    for (const name of DEFAULT_SHOPS) ins.run(name, null, now);
  }

  listShops(): Shop[] {
    return this.db.get().prepare("SELECT id, name, town, created_at FROM shops ORDER BY name").all() as Shop[];
  }

  /** Replace the shop list (names only; towns are informational). */
  setShops(names: string[]): void {
    const txn = this.db.get().transaction(() => {
      this.db.get().prepare("DELETE FROM shops").run();
      const ins = this.db.get().prepare("INSERT INTO shops (name, town, created_at) VALUES (?, NULL, ?)");
      const now = new Date().toISOString();
      for (const name of names) ins.run(name, now);
    });
    txn();
  }

  /** All sales for the configured shops, newest first (read-only on pricing.db). */
  sales(pricingDb: CoreDb): Sale[] {
    const shops = this.listShops().map((s) => s.name);
    if (shops.length === 0) return [];
    const q = `SELECT item_id, name, town, shop, cost, removed_date FROM sales
               WHERE shop IN (${shops.map(() => "?").join(",")}) ORDER BY removed_date DESC`;
    return pricingDb
      .get()
      .prepare(q)
      .all(...shops) as Sale[];
  }

  /**
   * Scan pricing for new sales of the configured shops. Per-shop baseline:
   * a shop with no `seen` rows yet baselines its whole history without
   * alerting (covers first run AND later shop additions). Every later new
   * item_id for a baselined shop becomes a notification (once, dedup by
   * item_id).
   */
  scan(pricingDb: CoreDb): ScanResult {
    const shops = this.listShops().map((s) => s.name);
    if (shops.length === 0) return { new: 0, baselined: 0, notifications: [] };
    const rows = this.sales(pricingDb);
    const seenCounts = new Map<string, number>();
    for (const r of this.db.get().prepare("SELECT shop, COUNT(*) AS n FROM seen GROUP BY shop").all() as {
      shop: string;
      n: number;
    }[]) {
      seenCounts.set(r.shop, r.n);
    }
    const notifications: Notification[] = [];
    let baselined = 0;
    const now = new Date().toISOString();
    const txn = this.db.get().transaction(() => {
      const insSeen = this.db
        .get()
        .prepare("INSERT OR IGNORE INTO seen (item_id, shop, removed_date) VALUES (?, ?, ?)");
      const insNotif = this.db
        .get()
        .prepare(
          "INSERT OR IGNORE INTO notifications (item_id, shop, name, cost, removed_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
      for (const r of rows) {
        const res = insSeen.run(r.item_id, r.shop, r.removed_date);
        if (res.changes === 0) continue; // already accounted for
        if ((seenCounts.get(r.shop) ?? 0) === 0) {
          baselined += 1; // first sighting of this shop: mark history seen, no alert
          continue;
        }
        const id = Number(insNotif.run(r.item_id, r.shop, r.name, r.cost, r.removed_date, now).lastInsertRowid);
        if (id > 0) {
          notifications.push({
            id,
            item_id: r.item_id,
            shop: r.shop,
            name: r.name,
            cost: r.cost,
            removed_date: r.removed_date,
            created_at: now,
            acknowledged_at: null,
          });
        }
      }
    });
    txn();
    return { new: notifications.length, baselined, notifications };
  }

  listNotifications(limit = 50): { total: number; unread: number; notifications: Notification[] } {
    const total = (this.db.get().prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n;
    const unread = (
      this.db.get().prepare("SELECT COUNT(*) AS n FROM notifications WHERE acknowledged_at IS NULL").get() as {
        n: number;
      }
    ).n;
    const notifications = this.db
      .get()
      .prepare(
        "SELECT id, item_id, shop, name, cost, removed_date, created_at, acknowledged_at FROM notifications ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Notification[];
    return { total, unread, notifications };
  }

  /** Ack all unread (ids empty) or the given ids. Returns rows acked. */
  ack(ids?: number[]): number {
    const txn = this.db.get().transaction(() => {
      if (ids && ids.length > 0) {
        const stmt = this.db
          .get()
          .prepare(
            `UPDATE notifications SET acknowledged_at = ? WHERE acknowledged_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
          );
        return Number(stmt.run(new Date().toISOString(), ...ids).changes);
      }
      const stmt = this.db.get().prepare("UPDATE notifications SET acknowledged_at = ? WHERE acknowledged_at IS NULL");
      return Number(stmt.run(new Date().toISOString()).changes);
    });
    return txn();
  }
}
