import { Response } from "node-fetch";
import { describe, expect, it } from "vitest";
import { type FetchFn, Playdotnet, parseInactiveCharacters } from "../../src/core/playdotnet.js";

const TABLE = `<table>
  <tr><th>Game</th><th>Name</th><th>Level</th><th>Race</th><th>Profession</th><th>Last Login</th></tr>
  <tr><td>GemStone IV</td><td>Mahres</td><td>42</td><td>Elf</td><td>Wizard</td><td>2026-01-15</td></tr>
  <tr><td>Shattered</td><td>Ghost</td><td>12</td><td>Human</td><td>Cleric</td><td></td></tr>
  <tr><td>GemStone IV</td><td>BadLevel</td><td>n/a</td><td>Dwarf</td><td>Warrior</td><td>2025-03-01</td></tr>
  <tr><td>short row</td></tr>
</table>`;

const INACTIVE = [
  { game: "GemStone IV", name: "Mahres", level: 42, race: "Elf", profession: "Wizard", last_login: "2026-01-15" },
];
const INACTIVE_HTML = `<table><tr><th>Game</th></tr><tr><td>GemStone IV</td><td>Mahres</td><td>42</td><td>Elf</td><td>Wizard</td><td>2026-01-15</td></tr></table>`;

describe("parseInactiveCharacters", () => {
  it("skips the header + short rows and coerces level/last_login", () => {
    const chars = parseInactiveCharacters(TABLE);
    expect(chars).toHaveLength(3);
    expect(chars[0]).toEqual({
      game: "GemStone IV",
      name: "Mahres",
      level: 42,
      race: "Elf",
      profession: "Wizard",
      last_login: "2026-01-15",
    });
    expect(chars[1]).toMatchObject({ game: "Shattered", name: "Ghost", last_login: "" });
    expect(chars[2]).toMatchObject({ name: "BadLevel", level: 0 });
  });
});

describe("Playdotnet.listInactiveCharacters", () => {
  it("logs in with the account/password and scrapes the table", async () => {
    const calls: { url: string; init?: unknown }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("login.asp")) return new Response("", { status: 302, headers: { location: "/gs4/home.asp" } });
      if (url.includes("inactive_characters")) return new Response(INACTIVE_HTML, { status: 200 });
      return new Response("", { status: 200 });
    };
    const chars = await new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET");
    expect(chars).toEqual(INACTIVE);
    const login = calls.find((c) => c.url.includes("login.asp"));
    const body = String((login?.init as { body?: string } | undefined)?.body ?? "");
    expect(body).toContain("account_name=BUCKWHEET");
    expect(body).toContain("account_password=SECRET");
  });

  it("throws 'play.net login rejected' on an error redirect", async () => {
    const fetchFn: FetchFn = async (url) =>
      url.includes("login.asp")
        ? new Response("", { status: 302, headers: { location: "/gs4/login_error.asp" } })
        : new Response("", { status: 200 });
    await expect(new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET")).rejects.toThrow(
      "play.net login rejected",
    );
  });

  it("throws 'play.net login failed' on a non-302 login", async () => {
    const fetchFn: FetchFn = async () => new Response("", { status: 200 });
    await expect(new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET")).rejects.toThrow(
      "play.net login failed",
    );
  });

  it("retries a 500 login and then succeeds", async () => {
    let logins = 0;
    const fetchFn: FetchFn = async (url) => {
      if (url.includes("login.asp")) {
        logins += 1;
        return logins === 1
          ? new Response("", { status: 500 })
          : new Response("", { status: 302, headers: { location: "/gs4/home.asp" } });
      }
      if (url.includes("inactive_characters")) return new Response(INACTIVE_HTML, { status: 200 });
      return new Response("", { status: 200 });
    };
    const chars = await new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET");
    expect(chars).toEqual(INACTIVE);
    expect(logins).toBe(2);
  });
});
