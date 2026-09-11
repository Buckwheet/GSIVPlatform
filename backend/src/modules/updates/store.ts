/**
 * Durable state for the `updates` module: the last check's outcome plus the
 * notification feed behind the dashboard 🔔 bell.
 *
 * A notification is filed at most once per upstream tag and stays unread until
 * acknowledged (`ack`), which is what makes the bell a real alert channel
 * rather than a poll-and-forget badge. `now` and the `fetch` used by `poll()`
 * are injected so both are testable.
 */
import type { CoreDb } from "../../core/db.js";
import { type FetchLike, fetchReleases, pickLatestRelease, type UpstreamRelease } from "./github.js";
import { compareVersions } from "./semver.js";

export interface UpdateNotification {
  id: number;
  tag: string;
  url: string;
  published_at: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface UpdatesStatus {
  /** Deployed version (VELLUM_VERSION in the server .env); null = unknown/not set. */
  current: string | null;
  /** Newest upstream release tag seen (any tag, whether or not it is newer). */
  latest: string | null;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface CheckResult {
  latest: string | null;
  updateAvailable: boolean;
  /** The notification filed by this check; null when nothing changed. */
  filed: UpdateNotification | null;
}

export interface UpdatesStoreOptions {
  currentVersion?: string;
  now?: () => Date;
}

export interface PollDeps {
  fetch: FetchLike;
  repo: string;
  token?: string;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS updates_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS updates_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    published_at TEXT,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT
  )`,
];

export class UpdatesStore {
  constructor(
    private db: CoreDb,
    private opts: UpdatesStoreOptions = {},
  ) {
    this.db.migrate("updates", MIGRATIONS);
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  private getState(key: string): string | null {
    const row = this.db.get().prepare("SELECT value FROM updates_state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setState(key: string, value: string): void {
    this.db
      .get()
      .prepare(
        "INSERT INTO updates_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  currentVersion(): string | null {
    const v = this.opts.currentVersion?.trim();
    return v ? v : null;
  }

  status(): UpdatesStatus {
    const current = this.currentVersion();
    const latest = this.getState("latest_tag");
    let updateAvailable = false;
    if (current && latest) {
      try {
        updateAvailable = compareVersions(latest, current) > 0;
      } catch {
        updateAvailable = false; // unparseable stored/config version: never claim an update
      }
    }
    return {
      current,
      latest,
      updateAvailable,
      lastCheckedAt: this.getState("last_checked_at"),
      lastError: this.getState("last_error") || null,
    };
  }

  listNotifications(limit = 50): {
    total: number;
    unread: number;
    notifications: UpdateNotification[];
    status: UpdatesStatus;
  } {
    const db = this.db.get();
    const total = (db.prepare("SELECT COUNT(*) AS n FROM updates_notifications").get() as { n: number }).n;
    const unread = (
      db.prepare("SELECT COUNT(*) AS n FROM updates_notifications WHERE acknowledged_at IS NULL").get() as { n: number }
    ).n;
    const notifications = db
      .prepare(
        `SELECT id, tag, url, published_at, created_at, acknowledged_at FROM updates_notifications
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as UpdateNotification[];
    return { total, unread, notifications, status: this.status() };
  }

  /** Ack all unread (ids omitted/empty) or the given ids. Returns rows acked. */
  ack(ids?: number[]): number {
    const txn = this.db.get().transaction(() => {
      const at = this.now();
      if (ids && ids.length > 0) {
        const stmt = this.db.get().prepare(
          `UPDATE updates_notifications SET acknowledged_at = ?
             WHERE acknowledged_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
        );
        return Number(stmt.run(at, ...ids).changes);
      }
      return Number(
        this.db
          .get()
          .prepare("UPDATE updates_notifications SET acknowledged_at = ? WHERE acknowledged_at IS NULL")
          .run(at).changes,
      );
    });
    return txn();
  }

  /**
   * Record one upstream release list. Files a notification when the newest
   * release is strictly newer than the deployed version — at most once per tag,
   * so polling the same releases never re-alerts.
   */
  applyReleases(releases: UpstreamRelease[], at?: string): CheckResult {
    const ts = at ?? this.now();
    this.setState("last_checked_at", ts);
    this.setState("last_error", "");

    const latest = pickLatestRelease(releases);
    if (!latest) return { latest: null, updateAvailable: false, filed: null };
    this.setState("latest_tag", latest.tag);
    this.setState("latest_url", latest.url);
    if (latest.published_at) this.setState("latest_published_at", latest.published_at);

    const current = this.currentVersion();
    let updateAvailable = false;
    if (current) {
      try {
        updateAvailable = compareVersions(latest.tag, current) > 0;
      } catch {
        updateAvailable = false;
      }
    }
    return { latest: latest.tag, updateAvailable, filed: updateAvailable ? this.file(latest, ts) : null };
  }

  /** Insert the notification unless this tag already has one. */
  private file(release: UpstreamRelease, at: string): UpdateNotification | null {
    const res = this.db
      .get()
      .prepare("INSERT OR IGNORE INTO updates_notifications (tag, url, published_at, created_at) VALUES (?, ?, ?, ?)")
      .run(release.tag, release.url, release.published_at, at);
    if (res.changes === 0) return null; // already filed for this tag
    return {
      id: Number(res.lastInsertRowid),
      tag: release.tag,
      url: release.url,
      published_at: release.published_at,
      created_at: at,
      acknowledged_at: null,
    };
  }

  /** Poll upstream once. Never throws: an outage is recorded as `lastError`. */
  async poll(deps: PollDeps): Promise<CheckResult> {
    try {
      const releases = await fetchReleases(deps.fetch, deps.repo, deps.token);
      return this.applyReleases(releases);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState("last_checked_at", this.now());
      this.setState("last_error", message);
      return { latest: this.getState("latest_tag"), updateAvailable: this.status().updateAvailable, filed: null };
    }
  }
}
