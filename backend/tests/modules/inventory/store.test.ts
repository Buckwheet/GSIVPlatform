import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryDbError, InventoryStore } from "../../../src/modules/inventory/store.js";
import { buildInvFixture } from "../../fixtures/inv-fixture.js";

describe("InventoryStore", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gsiv-inv-"));
    dbPath = join(dir, "inv.db3");
    const db = buildInvFixture();
    db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
    db.close();
  });

  const stores: InventoryStore[] = [];

  function makeStore(): InventoryStore {
    const store = new InventoryStore(dbPath);
    stores.push(store);
    return store;
  }

  afterAll(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("summary counts characters, items, silvers", () => {
    const store = makeStore();
    const s = store.summary();
    expect(s.characters).toBe(2);
    expect(s.items).toBe(5);
    expect(s.totalSilver).toBe(134999);
  });

  it("lists characters ordered by name", () => {
    const store = makeStore();
    const chars = store.characters();
    expect(chars.map((c) => c.name as string)).toEqual(["Fisternar", "Neleourg"]);
    expect(chars[0]).toMatchObject({ prof: "warrior", level: 100 });
  });

  it("lists locations", () => {
    const store = makeStore();
    const locs = store.locations();
    const names = locs.map((l: { name: string }) => l.name);
    expect(names).toContain("inv");
    expect(names).toContain("Fisternar Locker");
  });

  it("lists bank silvers", () => {
    const store = makeStore();
    const bank = store.bank();
    expect(bank.length).toBeGreaterThanOrEqual(2);
    const fis = bank.find((b) => b.character === "Fisternar");
    expect(fis).toMatchObject({ silvers: 125000, account: "main", prof: "warrior", level: 100 });
    const total = bank.find((b) => b.character === "Fisternar" && b.bank === "Total");
    expect(total?.silvers).toBe(125000);
  });

  it("reports the newest write timestamp across invdb tables", () => {
    const store = makeStore();
    expect(store.latestTimestamp()).toBe(1786000100);
  });

  it("searches items by name substring", () => {
    const store = makeStore();
    const hits = store.search("sapphire");
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ item: "sapphire", character: "Fisternar" });
  });

  it("filters search by character and location", () => {
    const store = makeStore();
    const hits = store.search("", "Neleourg", "inv");
    expect(hits.length).toBe(2);
    const items = hits.map((h) => h.item as string).sort();
    expect(items).toEqual(["mace", "topaz"]);
  });

  it("lists resources", () => {
    const store = makeStore();
    const res = store.resources();
    expect(res.length).toBe(2);
    expect(res[0]).toMatchObject({ character: "Fisternar", account: "main", favor: 100 });
  });

  it("lists tickets", () => {
    const store = makeStore();
    const tkts = store.tickets();
    expect(tkts.length).toBe(1);
    expect(tkts[0]).toMatchObject({ character: "Fisternar", amount: 3, currency: "ticket" });
  });

  it("throws InventoryDbError on missing db", () => {
    expect(() => new InventoryStore(join(dir, "nope.db3"))).toThrow(InventoryDbError);
  });
});
