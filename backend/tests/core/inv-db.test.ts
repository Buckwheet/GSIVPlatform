import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { InvDb } from "../../src/core/inv-db.js";

const TMP = mkdtempSync(join(tmpdir(), "inv-db-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function createDb(): string {
  const path = join(TMP, `inv-${Math.random().toString(36).slice(2)}.db3`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE character (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '');
    CREATE TABLE item (character_id INTEGER NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL);
    CREATE TABLE silver (character_id INTEGER NOT NULL, amount INTEGER NOT NULL);
    CREATE TABLE resource (character_id INTEGER NOT NULL PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE tickets (character_id INTEGER NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL);
    CREATE TABLE lumnis (character_id INTEGER NOT NULL PRIMARY KEY, status TEXT NOT NULL DEFAULT '');
    CREATE TABLE account (account TEXT NOT NULL PRIMARY KEY, premium_points INTEGER NOT NULL DEFAULT 0);
  `);
  const ins = db.prepare("INSERT INTO character (name, account) VALUES (?, ?)");
  const norhaak = ins.run("Norhaak", "Tworazors").lastInsertRowid as number;
  ins.run("Tworazors_", "Tworazors");
  const bilz = ins.run("Bilz", "Adred").lastInsertRowid as number;
  db.prepare("INSERT INTO item (character_id, name, amount) VALUES (?, ?, ?)").run(norhaak, "a", 1);
  db.prepare("INSERT INTO item (character_id, name, amount) VALUES (?, ?, ?)").run(norhaak, "b", 2);
  db.prepare("INSERT INTO item (character_id, name, amount) VALUES (?, ?, ?)").run(bilz, "c", 3);
  db.prepare("INSERT INTO silver (character_id, amount) VALUES (?, ?)").run(norhaak, 100);
  db.prepare("INSERT INTO silver (character_id, amount) VALUES (?, ?)").run(bilz, 50);
  db.prepare("INSERT INTO resource (character_id, total) VALUES (?, ?)").run(norhaak, 7);
  db.prepare("INSERT INTO tickets (character_id, source, amount) VALUES (?, ?, ?)").run(norhaak, "g", 9);
  db.prepare("INSERT INTO lumnis (character_id, status) VALUES (?, ?)").run(norhaak, "x");
  db.prepare("INSERT INTO account (account, premium_points) VALUES (?, ?)").run("Tworazors", 11);
  db.prepare("INSERT INTO account (account, premium_points) VALUES (?, ?)").run("Adred", 12);
  db.close();
  return path;
}

function count(dbPath: string, sql: string): number {
  const db = new Database(dbPath, { readonly: true });
  const n = (db.prepare(sql).get() as { n: number }).n;
  db.close();
  return n;
}

describe("InvDb", () => {
  it("deleteCharacters removes the character + child rows (case-insensitive), leaves others", () => {
    const path = createDb();
    const inv = new InvDb(path);
    const res = inv.deleteCharacters([{ name: "bilz", account: "ADRED" }]);
    expect(res.ok).toBe(true);
    expect(res.removedCharacters).toBe(1);
    expect(res.removedItems).toBe(1); // Bilz had 1 item

    expect(count(path, "SELECT COUNT(*) AS n FROM character")).toBe(2);
    expect(count(path, "SELECT COUNT(*) AS n FROM character WHERE UPPER(name)='BILZ'")).toBe(0);
    expect(count(path, "SELECT COUNT(*) AS n FROM item")).toBe(2); // Norhaak's 2 remain
    expect(
      count(
        path,
        "SELECT COUNT(*) AS n FROM silver WHERE character_id = (SELECT id FROM character WHERE name='Norhaak')",
      ),
    ).toBe(1);
    inv.close();
  });

  it("deleteAccounts removes all chars + child rows + the account row", () => {
    const path = createDb();
    const inv = new InvDb(path);
    const res = inv.deleteAccounts(["tworazors"]);
    expect(res.ok).toBe(true);
    expect(res.removedCharacters).toBe(2); // Norhaak + Tworazors_
    expect(res.removedItems).toBe(2); // Norhaak's 2 items

    expect(count(path, "SELECT COUNT(*) AS n FROM character")).toBe(1); // only Bilz
    expect(count(path, "SELECT COUNT(*) AS n FROM account WHERE UPPER(account)='TWORAZORS'")).toBe(0);
    expect(count(path, "SELECT COUNT(*) AS n FROM item")).toBe(1); // Bilz's 1
    expect(count(path, "SELECT COUNT(*) AS n FROM resource")).toBe(0);
    expect(count(path, "SELECT COUNT(*) AS n FROM tickets")).toBe(0);
    expect(count(path, "SELECT COUNT(*) AS n FROM lumnis")).toBe(0);
    inv.close();
  });

  it("no-match and empty inputs are no-ops that still report ok", () => {
    const path = createDb();
    const inv = new InvDb(path);
    expect(inv.deleteCharacters([])).toEqual({ ok: true, removedCharacters: 0, removedItems: 0 });
    expect(inv.deleteAccounts([])).toEqual({ ok: true, removedCharacters: 0, removedItems: 0 });
    const miss = inv.deleteCharacters([{ name: "Ghost", account: "None" }]);
    expect(miss).toEqual({ ok: true, removedCharacters: 0, removedItems: 0 });
    expect(count(path, "SELECT COUNT(*) AS n FROM character")).toBe(3);
    inv.close();
  });

  it("backsup the DB before mutating (and rotates)", () => {
    const path = createDb();
    const inv = new InvDb(path);
    inv.deleteCharacters([{ name: "bilz", account: "Adred" }]);
    inv.deleteAccounts(["tworazors"]);
    const backups = readdirSync(TMP).filter((f) => f.includes(".bak."));
    expect(backups.length).toBeGreaterThanOrEqual(2);
    for (const b of backups) expect(existsSync(join(TMP, b))).toBe(true);
    inv.close();
  });
});
