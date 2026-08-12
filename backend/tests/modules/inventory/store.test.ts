import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryDbError, InventoryStore, SearchSyntaxError } from "../../../src/modules/inventory/store.js";
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
    expect(s.items).toBe(6);
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
    expect(tkts[0]).toMatchObject({
      character: "Fisternar",
      account: "main",
      source: "quest",
      amount: 3,
      currency: "ticket",
    });
  });

  it("lists lumnis status", () => {
    const store = makeStore();
    const lum = store.lumnis();
    expect(lum.length).toBe(2);
    expect(lum[0]).toMatchObject({ character: "Fisternar", account: "main", status: "restart", total: 21900 });
    expect(lum[1]).toMatchObject({ character: "Neleourg", last_schedule: "2023-02-26 13:47:32" });
  });

  it("bare words search item names (substring)", () => {
    const store = makeStore();
    const hits = store.searchFilter("sapphire");
    expect(hits.map((h) => h.item as string)).toEqual(["sapphire"]);
  });

  it("type= matches comma-joined multi-types via %wrap%", () => {
    const store = makeStore();
    const hits = store.searchFilter("type=gem");
    expect(hits.map((h) => h.item as string).sort()).toEqual(["sapphire", "sunstone", "topaz"]);
  });

  it("numeric comparisons (amount>N, level>N on characters)", () => {
    const store = makeStore();
    expect(store.searchFilter("amount>2").map((h) => h.item as string)).toEqual(["sapphire"]);
    // level is the CHARACTER's level (invdb filter map: level -> c.level)
    expect(
      store
        .searchFilter("level>90")
        .map((h) => h.item as string)
        .sort(),
    ).toEqual(["claidhmore", "crimson armor", "sapphire", "sunstone"]);
  });

  it("!= on strings is NOT LIKE (invdb semantics: only exact matches excluded)", () => {
    const store = makeStore();
    const items = store
      .searchFilter("type!=gem")
      .map((h) => h.item as string)
      .sort();
    expect(items).toEqual(["claidhmore", "crimson armor", "mace", "sunstone"]);
  });

  it("location= matches name or abbr, case-insensitively", () => {
    const store = makeStore();
    expect(store.searchFilter("location=inv").length).toBe(3);
    expect(store.searchFilter("location=INV").length).toBe(3);
  });

  it("regex filters match case-insensitively", () => {
    const store = makeStore();
    expect(store.searchFilter("/^SAP/").map((h) => h.item as string)).toEqual(["sapphire"]);
    const neg = store
      .searchFilter("name!=/^cla/")
      .map((h) => h.item as string)
      .sort();
    expect(neg).toEqual(["crimson armor", "mace", "sapphire", "sunstone", "topaz"]);
  });

  it("arrays become IN (...) with exact matching", () => {
    const store = makeStore();
    // exact IN: sunstone's 'gem,realm:reim' does not match 'gem'
    expect(store.searchFilter("type=gem|weapon").length).toBe(4);
    expect(store.searchFilter("type=gem,weapon").length).toBe(4);
  });

  it("* wildcard becomes %", () => {
    const store = makeStore();
    expect(store.searchFilter("search=sap*re").map((h) => h.item as string)).toEqual(["sapphire"]);
  });

  it("status matches as a prefix", () => {
    const store = makeStore();
    expect(store.searchFilter("status=par").map((h) => h.item as string)).toEqual(["claidhmore"]);
  });

  it("character/account filters", () => {
    const store = makeStore();
    expect(store.searchFilter("character=Neleourg").length).toBe(2);
    expect(store.searchFilter("account=main").length).toBe(6);
  });

  it("limit and orderby extras", () => {
    const store = makeStore();
    expect(store.searchFilter("limit=2").length).toBe(2);
    expect(store.searchFilter("orderby=-amount limit=3").map((h) => h.amount as number)).toEqual([3, 2, 1]);
  });

  it("search results expose invdb columns", () => {
    const store = makeStore();
    const hit = store.searchFilter("sapphire")[0] as Record<string, unknown>;
    expect(hit).toMatchObject({
      character: "Fisternar",
      account: "main",
      prof: "warrior",
      level: 100,
      loc: "CTN",
      location: "container",
      location_name: "container",
      type: "gem",
      amount: 3,
      noun: "sapphire",
      timestamp: 1786000000,
    });
  });

  it("rejects unknown filters, bad regexes, bad extras with SearchSyntaxError", () => {
    const store = makeStore();
    expect(() => store.searchFilter("bogus=1")).toThrow(SearchSyntaxError);
    expect(() => store.searchFilter("/[unclosed/")).toThrow(SearchSyntaxError);
    expect(() => store.searchFilter("limit=abc")).toThrow(SearchSyntaxError);
    expect(() => store.searchFilter("energy=5")).toThrow(SearchSyntaxError);
  });

  it("throws InventoryDbError on missing db", () => {
    expect(() => new InventoryStore(join(dir, "nope.db3"))).toThrow(InventoryDbError);
  });
});
