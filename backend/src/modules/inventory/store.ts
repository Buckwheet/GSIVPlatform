import Database from "better-sqlite3";

const DEFAULT_PATH = process.env.INV_DB_PATH || "/opt/gs4sd/lich5/data/inv.db3";

export class InventoryDbError extends Error {}

/** Raised when an invdb-style filter expression cannot be turned into SQL. */
export class SearchSyntaxError extends Error {}

export interface OverviewTableFreshness {
  table: string;
  asOf: string | null;
  daysOld: number | null;
}

export interface OverviewNotice {
  level: "info" | "warn";
  message: string;
}

export interface OverviewCharacterRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  race: string;
  totalSilver: number;
  itemCount: number;
  resourceTotal: number | null;
  energy: string | null;
  lumnisTotal: number | null;
  lumnisStatus: string | null;
  ticketCount: number;
  lastScan: number | null;
}

export interface Overview {
  stats: {
    characters: number;
    accounts: number;
    items: number;
    totalSilver: number;
    dataAsOf: string | null;
    tableFreshness: OverviewTableFreshness[];
  };
  perCharacter: OverviewCharacterRow[];
  distributions: {
    itemTypes: { label: string; count: number }[];
    itemLocations: { label: string; count: number }[];
    townBanks: { label: string; amount: number }[];
    richest: { character: string; totalSilver: number }[];
    topHoards: { character: string; itemCount: number }[];
  };
  notices: OverviewNotice[];
}

/** One parsed filter from an invdb-style expression (mirrors invdb.lic's `h` hash). */
export interface InvFilter {
  name: string;
  operator: string; // =, !=, <>, <, <=, >, >=, REGEXP, !REGEXP
  value: string | number | string[];
}

/**
 * Filter grammar cloned from invdb.lic (`;invdb query item ...`):
 *   - bare words          -> substring search over item name (i.name like '%word%')
 *   - key=value           -> string equality (LIKE); value may use * as a wildcard
 *   - key!=value          -> string inequality (NOT LIKE) / numeric <> / arrays NOT IN
 *   - key<N key>N key<=N key>=N -> numeric comparisons on integer columns
 *   - key=/regex/         -> case-insensitive regex match (REGEXP); key!=/re/ -> NOT REGEXP
 *   - a|b or a,b          -> IN (a, b)  (NOT IN for != / <>)
 *   - ''                  -> empty string
 *   - 1,000               -> integer (commas stripped)
 *   - limit=N orderby=col[,-col2] extras
 * Special auto-wildcards (same as invdb): search/name '=' wraps %v% (bare words),
 * type '=' wraps %v% (multi-type rows are comma-joined), status always matches as a
 * prefix v%.
 */
const FILTER_PATTERN = /^(?<key>.+?)(?<op>[!<>=]+)(?<value>.*)$/;
const INT_PATTERN = /^[\d,]+$/;

/** Abbreviated filter names invdb accepts (full names also work). */
const NAME_ALIASES: Record<string, string> = {
  qty: "amount",
  char: "character",
  lvl: "level",
  pro: "prof",
  act: "account",
  epf: "status",
  stk: "stack",
  name: "search",
};

/** Item-query filters mapped to their SQL column (character/item/location tables). */
const COLUMN_FILTERS: Record<string, string> = {
  account: "c.account",
  area: "c.area",
  character: "c.name",
  citizenship: "c.citizenship",
  game: "c.game",
  hidden: "i.hidden",
  level: "c.level",
  marked: "i.marked",
  noun: "i.noun",
  path: "i.path",
  prof: "c.prof",
  race: "c.race",
  rank: "c.society_rank",
  registered: "i.registered",
  society: "c.society",
  stack: "i.stack",
  subscription: "c.subscription",
  worn: "i.worn",
};

/** Filters with dedicated WHERE construction (mirrors invdb's where_expression_special). */
const SPECIAL_FILTERS = new Set(["search", "type", "status", "amount", "location", "location_type"]);

/** Filters invdb knows but only for other query targets (resource/lumnis/...) — rejected here. */
const UNSUPPORTED_FILTERS = new Set([
  "bonus",
  "double",
  "energy",
  "favor",
  "last_schedule",
  "start_day",
  "start_time",
  "suffused",
  "total",
  "triple",
  "weekly",
]);

const EXTRAS = new Set(["limit", "orderby"]);

/** orderby column names -> SQL (never raw user input). */
const ORDERBY_MAP: Record<string, string> = {
  account: "c.account",
  amount: "i.amount",
  character: "c.name",
  hidden: "i.hidden",
  item: "i.name",
  level: "c.level",
  loc: "l.abbr",
  location: "l.abbr",
  location_name: "l.name",
  marked: "i.marked",
  name: "i.name",
  noun: "i.noun",
  path: "i.path",
  prof: "c.prof",
  qty: "i.amount",
  registered: "i.registered",
  stack: "i.stack",
  status: "i.status",
  timestamp: "i.timestamp",
  type: "i.type",
  worn: "i.worn",
};

const ITEM_DEFAULT_ORDERBY = "c.name, l.type, l.name, i.level, i.path, i.noun, i.name";
const ITEM_DEFAULT_LIMIT = 500;

/** Validate a JS-compatible regex up front so bad input is a 400, not a 500. */
function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

/**
 * Split an expression on whitespace, rejoining tokens that form a `/regex/` span
 * (invdb: a token like `search=/foo` keeps swallowing tokens until one ends with `/`).
 */
function tokenize(expr: string): string[] {
  const tokens = expr.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let span: string[] | null = null;
  for (const tok of tokens) {
    if (span !== null) {
      span.push(tok);
      if (tok.endsWith("/")) {
        out.push(span.join(" "));
        span = null;
      }
      continue;
    }
    if (tok.includes("/") && !tok.endsWith("/") && !tok.startsWith("//") && /^[^=!<>]*[=!<>]?\/[^/]*$/.test(tok)) {
      span = [tok];
      continue;
    }
    out.push(tok);
  }
  if (span !== null) out.push(span.join(" ")); // unclosed regex: parser will reject it later
  return out;
}

/** Parse one token into a filter, or null when it is a bare search word. */
function parseToken(token: string): InvFilter | null {
  const m = FILTER_PATTERN.exec(token);
  if (!m?.groups) return null;
  let key = m.groups.key ?? "";
  let op = m.groups.op ?? "";
  let value: string | number | string[] = m.groups.value ?? "";

  // /regex/ values -> REGEXP operator (invdb: != / <> before the regex becomes !REGEXP)
  if (value.startsWith("/") && value.endsWith("/") && value.length >= 2) {
    op = op === "!=" || op === "<>" ? "!REGEXP" : "REGEXP";
    value = value.slice(1, -1);
  } else if (INT_PATTERN.test(value)) {
    value = Number(value.replaceAll(",", ""));
  } else if (value.includes("|")) {
    value = value.split(/\| */);
  } else if (value.includes(",")) {
    value = value.split(/, */);
  } else if (value === "''") {
    value = "";
  }

  const alias = NAME_ALIASES[key] ?? NAME_ALIASES[key.toLowerCase()];
  key = alias ?? key;
  return { name: key, operator: op, value };
}

/** Build the WHERE clause + params for a list of filters (mirrors invdb's where_builder). */
function buildWhere(filters: InvFilter[]): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const seen = new Set<string>();

  for (const f of filters) {
    const name = f.name.toLowerCase();
    if (UNSUPPORTED_FILTERS.has(name)) {
      throw new SearchSyntaxError(
        `filter "${f.name}" only applies to other invdb queries (resource/lumnis) — not item search`,
      );
    }
    if (EXTRAS.has(name)) continue; // handled by buildExtras
    if (!SPECIAL_FILTERS.has(name) && !COLUMN_FILTERS[name]) {
      throw new SearchSyntaxError(
        `unknown filter "${f.name}" (supported: ${[...new Set([...Object.keys(COLUMN_FILTERS), ...SPECIAL_FILTERS])]
          .sort()
          .join(", ")})`,
      );
    }
    seen.add(name);

    let value = f.value;
    if (typeof value === "string") value = value.replaceAll("*", "%");

    // regex values must compile before reaching SQLite
    if (f.operator === "REGEXP" || f.operator === "!REGEXP") {
      if (typeof value !== "string" || !validRegex(value)) {
        throw new SearchSyntaxError(`invalid regex /${String(value)}/`);
      }
    }

    const isNeg = f.operator === "!=" || f.operator === "<>";
    const op = isNeg ? "<>" : f.operator;

    // Auto-wildcards (invdb): search/type '=' -> %v%; status -> v% prefix always.
    let likeValue: string | null = null;
    if (typeof value === "string") {
      if (name === "search" && f.operator === "=") likeValue = `%${value}%`;
      else if (name === "type" && f.operator === "=") likeValue = `%${value}%`;
      else if (name === "status") likeValue = `${value}%`;
      else likeValue = value;
    }

    const pushParam = (v: string | number) => {
      params.push(v);
      return "?";
    };

    const buildExpr = (col: string): string => {
      if (f.operator === "REGEXP" || f.operator === "!REGEXP") {
        return `${col} ${f.operator === "!REGEXP" ? "not regexp" : "regexp"} ${pushParam(value as string)}`;
      }
      if (Array.isArray(value)) {
        const list = (value as string[]).map((s) => s.replaceAll("'", "''")).join("','");
        return `${col} ${isNeg ? "not in" : "in"} ('${list}')`;
      }
      if (typeof value === "number") return `${col} ${op} ${pushParam(value)}`;
      return `${col} ${isNeg ? "not like" : "like"} ${pushParam(likeValue ?? value)}`;
    };

    if (name === "location") {
      clauses.push(`(${buildExpr("l.name")} or ${buildExpr("l.abbr")})`);
    } else if (name === "search") {
      clauses.push(buildExpr("i.name"));
    } else if (name === "type" || name === "status") {
      clauses.push(buildExpr(`i.${name}`));
    } else if (name === "location_type") {
      clauses.push(buildExpr("l.type"));
    } else if (name === "amount") {
      clauses.push(buildExpr("i.amount"));
    } else {
      clauses.push(buildExpr(COLUMN_FILTERS[name]));
    }
  }

  // invdb always scopes item queries to the caller's game (here: the GSIV roster).
  if (!seen.has("game")) {
    clauses.push("c.game = ?");
    params.push("GSIV");
  }

  const where = clauses.length > 0 ? `where ${clauses.join("\n        and ")}` : "";
  return { where, params };
}

/** Build ORDER BY + LIMIT from invdb extras (limit=N, orderby=a,-b). */
function buildExtras(extras: Record<string, string>): { orderby: string; limit: number } {
  let orderby = ITEM_DEFAULT_ORDERBY;
  if (extras.orderby !== undefined) {
    const parts: string[] = [];
    for (const raw of extras.orderby.split(",")) {
      const col = raw.trim().replace(/^[-+]\s*/, "");
      const dir = /^\s*-/.test(raw) ? " desc" : " asc";
      const sql = ORDERBY_MAP[col.toLowerCase()];
      if (!sql) throw new SearchSyntaxError(`unknown orderby column "${col}"`);
      parts.push(sql + dir);
    }
    if (parts.length === 0) throw new SearchSyntaxError("empty orderby");
    orderby = parts.join(", ");
  }
  let limit = ITEM_DEFAULT_LIMIT;
  if (extras.limit !== undefined) {
    const n = Number(extras.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new SearchSyntaxError(`limit must be a positive integer (got "${extras.limit}")`);
    }
    limit = n;
  }
  return { orderby, limit };
}

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
      // invdb registers a case-insensitive regexp() so `col regexp ?` works in SQLite.
      this.db.function("regexp", { deterministic: true }, (pattern: string, value: string) =>
        new RegExp(pattern, "i").test(String(value)) ? 1 : 0,
      );
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

  /** Legacy search (q / character / location params) — same engine as searchFilter. */
  search(query: string, character?: string, location?: string): Record<string, unknown>[] {
    const filters: InvFilter[] = [];
    if (query) filters.push({ name: "search", operator: "=", value: query });
    if (character) filters.push({ name: "character", operator: "=", value: character });
    if (location) filters.push({ name: "location", operator: "=", value: location });
    return this.queryItems(filters);
  }

  /**
   * invdb-grammar item search over inv.db3. Throws SearchSyntaxError for unknown
   * filters, bad regexes, or invalid extras.
   */
  searchFilter(expr: string): Record<string, unknown>[] {
    const filters: InvFilter[] = [];
    const bare: string[] = [];
    for (const tok of tokenize(expr)) {
      const f = parseToken(tok);
      if (f) filters.push(f);
      else bare.push(tok);
    }
    if (bare.length > 0) {
      let value = bare.join(" ");
      let operator = "=";
      if (value.startsWith("/") && value.endsWith("/") && value.length >= 2) {
        operator = "REGEXP";
        value = value.slice(1, -1);
      }
      filters.push({ name: "search", operator, value });
    }
    return this.queryItems(filters);
  }

  queryItems(filters: InvFilter[]): Record<string, unknown>[] {
    const { where, params } = buildWhere(filters);
    const extras: Record<string, string> = {};
    for (const f of filters) {
      const name = f.name.toLowerCase();
      if (EXTRAS.has(name)) extras[name] = String(f.value);
    }
    const { orderby, limit } = buildExtras(extras);
    const sql = `
      SELECT
        c.name as character, c.account, c.prof, c.level,
        CAST(l.abbr AS TEXT) as loc, CAST(l.name AS TEXT) as location_name,
        CAST(l.name AS TEXT) as location,
        CAST(i.path AS TEXT) as path, CAST(i.noun AS TEXT) as noun, CAST(i.name AS TEXT) as item,
        CAST(i.type AS TEXT) as type, i.amount as amount, CAST(i.stack AS TEXT) as stack,
        CAST(i.status AS TEXT) as status, CAST(i.marked AS TEXT) as marked,
        CAST(i.registered AS TEXT) as registered, CAST(i.worn AS TEXT) as worn,
        CAST(i.hidden AS TEXT) as hidden, i.timestamp as timestamp
      FROM item i
      JOIN location l ON i.location_id = l.id
      JOIN character c ON i.character_id = c.id
      ${where}
      ORDER BY ${orderby}
      LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  resources(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.account, c.prof, c.level,
          CAST(r.energy AS TEXT) as energy, r.weekly, r.total, r.suffused,
          CAST(r.favor AS INTEGER) as favor, r.bonus
         FROM resource r JOIN character c ON r.character_id = c.id ORDER BY c.name`,
      )
      .all() as Record<string, unknown>[];
  }

  lumnis(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.account, c.prof, c.level,
          CAST(l.status AS TEXT) as status,
          CAST(l.triple AS INTEGER) as triple, CAST(l.double AS INTEGER) as double, CAST(l.total AS INTEGER) as total,
          CAST(l.start_day AS TEXT) as start_day, CAST(l.start_time AS TEXT) as start_time,
          CAST(l.last_schedule AS TEXT) as last_schedule
         FROM lumnis l JOIN character c ON l.character_id = c.id ORDER BY c.name`,
      )
      .all() as Record<string, unknown>[];
  }

  tickets(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT c.name as character, c.account, c.prof, c.level, t.source, t.amount, t.currency
         FROM tickets t JOIN character c ON t.character_id = c.id ORDER BY c.name, t.source`,
      )
      .all() as Record<string, unknown>[];
  }

  /**
   * Unified overview (step 6): everything invdb collects in one dashboard payload —
   * global stats + per-table freshness, one aggregate row per character, top-N
   * distributions, and data-quality notices. nowSec is injectable for tests.
   */
  overview(nowSec: number = Math.floor(Date.now() / 1000)): Overview {
    const freshness = this.db
      .prepare(
        `SELECT t AS "table", ts FROM (
          SELECT 'character' AS t, MAX(timestamp) AS ts FROM character
          UNION ALL SELECT 'item', MAX(timestamp) FROM item
          UNION ALL SELECT 'silver', MAX(timestamp) FROM silver
          UNION ALL SELECT 'resource', MAX(timestamp) FROM resource
          UNION ALL SELECT 'tickets', MAX(timestamp) FROM tickets
          UNION ALL SELECT 'lumnis', MAX(timestamp) FROM lumnis
          UNION ALL SELECT 'account', MAX(timestamp) FROM account
        )`,
      )
      .all() as { table: string; ts: number | null }[];

    const tableFreshness = freshness.map(({ table, ts }) => ({
      table,
      asOf: ts === null ? null : new Date(ts * 1000).toISOString(),
      daysOld: ts === null ? null : Math.max(0, Math.floor((nowSec - ts) / 86400)),
    }));

    const chars = this.db.prepare("SELECT COUNT(*) AS n FROM character").get() as { n: number };
    const accounts = this.db.prepare("SELECT COUNT(DISTINCT account) AS n FROM character").get() as { n: number };
    const items = this.db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number };
    const totalSilver = this.db
      .prepare("SELECT SUM(amount) AS n FROM silver WHERE bank_id IN (SELECT id FROM bank WHERE name != 'Total')")
      .get() as { n: number | null };

    const perCharacter = this.db
      .prepare(
        `SELECT c.name AS character, c.account, c.prof, c.level, c.race,
          COALESCE(
            (SELECT MAX(s.amount) FROM silver s JOIN bank b ON s.bank_id = b.id
              WHERE s.character_id = c.id AND b.name = 'Total'),
            (SELECT SUM(s.amount) FROM silver s JOIN bank b ON s.bank_id = b.id
              WHERE s.character_id = c.id AND b.name != 'Total')
          ) AS total_silver,
          (SELECT COUNT(*) FROM item i WHERE i.character_id = c.id) AS item_count,
          r.total AS resource_total, r.energy,
          CAST(l.total AS INTEGER) AS lumnis_total, l.status AS lumnis_status,
          (SELECT COUNT(*) FROM tickets t WHERE t.character_id = c.id) AS ticket_count,
          (SELECT MAX(ts) FROM (
            SELECT MAX(timestamp) AS ts FROM item i WHERE i.character_id = c.id
            UNION ALL SELECT MAX(timestamp) FROM silver s WHERE s.character_id = c.id
            UNION ALL SELECT MAX(timestamp) FROM resource r2 WHERE r2.character_id = c.id
            UNION ALL SELECT MAX(timestamp) FROM tickets t2 WHERE t2.character_id = c.id
            UNION ALL SELECT MAX(timestamp) FROM lumnis l2 WHERE l2.character_id = c.id
          )) AS last_scan
         FROM character c
         LEFT JOIN resource r ON r.character_id = c.id
         LEFT JOIN lumnis l ON l.character_id = c.id
         ORDER BY c.name`,
      )
      .all() as {
      character: string;
      account: string;
      prof: string;
      level: number;
      race: string;
      total_silver: number | null;
      item_count: number;
      resource_total: number | null;
      energy: string | null;
      lumnis_total: number | null;
      lumnis_status: string | null;
      ticket_count: number;
      last_scan: number | null;
    }[];

    const normalized = perCharacter.map((r) => ({
      character: r.character,
      account: r.account,
      prof: r.prof,
      level: r.level,
      race: r.race,
      totalSilver: r.total_silver ?? 0,
      itemCount: r.item_count,
      resourceTotal: r.resource_total,
      energy: r.energy,
      lumnisTotal: r.lumnis_total,
      lumnisStatus: r.lumnis_status,
      ticketCount: r.ticket_count,
      lastScan: r.last_scan,
    }));

    const distributions = {
      itemTypes: this.db
        .prepare(
          "SELECT lower(trim(type)) AS label, COUNT(*) AS count FROM item GROUP BY label ORDER BY count DESC, label LIMIT 10",
        )
        .all() as { label: string; count: number }[],
      itemLocations: this.db
        .prepare(
          "SELECT l.type AS label, COUNT(*) AS count FROM item i JOIN location l ON i.location_id = l.id GROUP BY l.type ORDER BY count DESC, label LIMIT 8",
        )
        .all() as { label: string; count: number }[],
      townBanks: this.db
        .prepare(
          "SELECT b.name AS label, SUM(s.amount) AS amount FROM silver s JOIN bank b ON s.bank_id = b.id WHERE b.name != 'Total' GROUP BY b.name ORDER BY amount DESC, label LIMIT 8",
        )
        .all() as { label: string; amount: number }[],
      richest: [...normalized]
        .sort((a, b) => b.totalSilver - a.totalSilver)
        .slice(0, 8)
        .map((r) => ({ character: r.character, totalSilver: r.totalSilver })),
      topHoards: [...normalized]
        .sort((a, b) => b.itemCount - a.itemCount)
        .slice(0, 8)
        .map((r) => ({ character: r.character, itemCount: r.itemCount })),
    };

    const notices: OverviewNotice[] = [];
    if (chars.n === 0) {
      notices.push({
        level: "info",
        message: "No scan data yet - run a scan (Scans > Scan now) or wait for the daily scan.",
      });
    }
    for (const f of tableFreshness) {
      if (f.table === "account") continue; // premium points are a separate collection, not scan freshness
      if (f.daysOld !== null && f.daysOld > 7) {
        notices.push({
          level: "warn",
          message: `${f.table} data is ${f.daysOld} days old (last scanned ${(f.asOf ?? "").slice(0, 10)}) - run a scan to refresh it.`,
        });
      }
    }
    const noItems = normalized.filter((r) => r.itemCount === 0);
    if (noItems.length > 0) {
      notices.push({
        level: "info",
        message: `${noItems.length} ${noItems.length === 1 ? "character has" : "characters have"} no item data (never fully scanned): ${noItems
          .slice(0, 5)
          .map((r) => r.character)
          .join(", ")}${noItems.length > 5 ? ` +${noItems.length - 5} more` : ""}.`,
      });
    }
    const noBank = normalized.filter((r) => r.totalSilver === 0 && this.hasNoSilverRows(r.character));
    if (noBank.length > 0) {
      notices.push({
        level: "info",
        message: `${noBank.length} ${noBank.length === 1 ? "character has" : "characters have"} no bank data: ${noBank
          .slice(0, 5)
          .map((r) => r.character)
          .join(", ")}${noBank.length > 5 ? ` +${noBank.length - 5} more` : ""}.`,
      });
    }

    return {
      stats: {
        characters: chars.n,
        accounts: accounts.n,
        items: items.n,
        totalSilver: totalSilver.n ?? 0,
        dataAsOf: tableFreshness.find((f) => f.asOf !== null)?.asOf ?? null,
        tableFreshness,
      },
      perCharacter: normalized,
      distributions,
      notices,
    };
  }

  /** True when a character has no silver rows at all (no bank data recorded). */
  private hasNoSilverRows(character: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM silver s JOIN character c ON s.character_id = c.id WHERE c.name = ?")
      .get(character) as { n: number };
    return row.n === 0;
  }
}
