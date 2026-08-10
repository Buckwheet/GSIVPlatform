import { afterEach, describe, expect, it } from "vitest";
import { CoreDb } from "../../src/core/db.js";

describe("CoreDb", () => {
  let db: CoreDb | undefined;

  afterEach(() => db?.close());

  it("runs migrations once and tracks them", () => {
    db = new CoreDb(":memory:");
    db.migrate("inventory", ["CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, name TEXT);"]);
    db.migrate("inventory", ["CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, name TEXT);"]);
    const rows = db.get().prepare("SELECT * FROM schema_migrations").all();
    expect(rows).toHaveLength(1);
  });

  it("runs multiple migrations in order", () => {
    db = new CoreDb(":memory:");
    db.migrate("pricing", [
      "CREATE TABLE pricing_sales (id INTEGER PRIMARY KEY, name TEXT);",
      "ALTER TABLE pricing_sales ADD COLUMN cost INTEGER;",
    ]);
    const cols = db.get().prepare("PRAGMA table_info(pricing_sales)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("cost");
  });

  it("rolls back a failed migration transaction", () => {
    const d = new CoreDb(":memory:");
    expect(() => d.migrate("bad", ["CREATE TABLE ok (id INTEGER);", "THIS IS NOT SQL;"])).toThrow();
    const rows = d.get().prepare("SELECT * FROM schema_migrations WHERE module='bad'").all();
    expect(rows).toHaveLength(0);
  });
});
