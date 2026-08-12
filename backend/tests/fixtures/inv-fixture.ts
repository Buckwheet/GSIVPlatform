import Database from "better-sqlite3";

/** Builds an in-memory inv.db3 replica with the production schema + seed data. */
export function buildInvFixture(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE character (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, game TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '',
      prof TEXT NOT NULL DEFAULT '', race TEXT NOT NULL DEFAULT '', level INTEGER NOT NULL DEFAULT 0,
      exp INTEGER NOT NULL DEFAULT 0, area TEXT NOT NULL DEFAULT '', subscription TEXT NOT NULL DEFAULT '',
      citizenship TEXT NOT NULL DEFAULT '', society TEXT NOT NULL DEFAULT '', society_rank TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL DEFAULT 0, UNIQUE(name, game)
    );
    CREATE TABLE bank (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, abbr TEXT NOT NULL UNIQUE);
    CREATE TABLE silver (character_id INTEGER NOT NULL, bank_id INTEGER NOT NULL, amount INTEGER NOT NULL, timestamp INTEGER NOT NULL, UNIQUE(character_id, bank_id));
    CREATE TABLE location (id INTEGER NOT NULL PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL UNIQUE, abbr TEXT NOT NULL UNIQUE);
    CREATE TABLE item (
      character_id INTEGER NOT NULL, location_id INTEGER NOT NULL, level INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, noun TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL, stack TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', marked TEXT NOT NULL DEFAULT '',
      registered TEXT NOT NULL DEFAULT '', worn TEXT NOT NULL DEFAULT '', hidden TEXT NOT NULL DEFAULT '', timestamp INTEGER NOT NULL,
      UNIQUE(name, character_id, location_id, path, stack, status, marked, registered)
    );
    CREATE TABLE tickets (character_id INTEGER NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, timestamp INTEGER NOT NULL, UNIQUE(character_id, source));
    CREATE TABLE resource (character_id INTEGER NOT NULL PRIMARY KEY, energy TEXT NOT NULL DEFAULT '', weekly INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, suffused INTEGER NOT NULL DEFAULT 0, favor INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lumnis (character_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT '', triple TEXT NOT NULL DEFAULT '', double TEXT NOT NULL DEFAULT '', total TEXT NOT NULL DEFAULT '', start_day TEXT NOT NULL DEFAULT '', start_time TEXT NOT NULL DEFAULT '', last_schedule TEXT NOT NULL DEFAULT '', timestamp INTEGER NOT NULL DEFAULT 0);
  `);

  const insChar = db.prepare(
    "INSERT INTO character (name, game, account, prof, race, level, exp, area, subscription, citizenship, society, society_rank, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  insChar.run(
    "Fisternar",
    "GSIV",
    "main",
    "warrior",
    "human",
    100,
    5000,
    "Town",
    "Premium",
    "Ta'Vaalor",
    "None",
    "",
    1786000000,
  );
  insChar.run(
    "Neleourg",
    "GSIV",
    "main",
    "cleric",
    "elf",
    88,
    1200,
    "Wehnimer's",
    "Premium",
    "Ta'Illistim",
    "Order of the White Rose",
    "",
    1786000100,
  );

  const insBank = db.prepare("INSERT INTO bank (name, abbr) VALUES (?,?)");
  insBank.run("Ta'Vaalor", "TV");
  insBank.run("Total", "TOT");

  const insSilver = db.prepare("INSERT INTO silver (character_id, bank_id, amount, timestamp) VALUES (?,?,?,?)");
  insSilver.run(1, 1, 125000, 1786000000);
  insSilver.run(1, 2, 125000, 1786000000);
  insSilver.run(2, 1, 9999, 1786000100);

  const insLoc = db.prepare("INSERT INTO location (id, type, name, abbr) VALUES (?,?,?,?)");
  insLoc.run(1, "inv", "inv", "INV");
  insLoc.run(2, "worn", "worn", "WRN");
  insLoc.run(3, "container", "container", "CTN");
  insLoc.run(4, "locker", "Fisternar", "LCK");

  const insItem = db.prepare(
    "INSERT INTO item (character_id, location_id, level, path, type, name, noun, amount, stack, status, marked, registered, worn, hidden, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  insItem.run(1, 1, 100, "", "weapon", "claidhmore", "claidhmore", 1, "", "", "", "", "", "", 1786000000);
  insItem.run(1, 2, 100, "", "armor", "crimson armor", "armor", 1, "", "", "", "", "worn", "", 1786000000);
  insItem.run(1, 3, 80, "", "gem", "sapphire", "sapphire", 3, "", "", "", "", "", "", 1786000000);
  insItem.run(2, 1, 88, "", "weapon", "mace", "mace", 1, "", "", "", "", "", "", 1786000100);
  insItem.run(2, 1, 88, "", "gem", "topaz", "topaz", 2, "", "", "", "", "", "", 1786000100);

  const insTkt = db.prepare(
    "INSERT INTO tickets (character_id, source, amount, currency, timestamp) VALUES (?,?,?,?,?)",
  );
  insTkt.run(1, "quest", 3, "ticket", 1786000000);

  const insRes = db.prepare(
    "INSERT INTO resource (character_id, energy, weekly, total, suffused, favor, bonus, timestamp) VALUES (?,?,?,?,?,?,?,?)",
  );
  insRes.run(1, "1000/1000", 0, 500, 0, 100, 0, 1786000000);
  insRes.run(2, "800/800", 0, 300, 0, 75, 0, 1786000100);

  const insLum = db.prepare(
    "INSERT INTO lumnis (character_id, status, triple, double, total, start_day, start_time, last_schedule, timestamp) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  insLum.run(1, "restart", 7300, 7300, 21900, "", "", "", 1786000000);
  insLum.run(2, "restart", 7300, 7300, 21900, "Sunday", "14:00", "2023-02-26 13:47:32", 1786000100);

  return db;
}
