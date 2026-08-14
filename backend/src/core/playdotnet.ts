import { load } from "cheerio";
import makeFetchCookie from "fetch-cookie";
import nodeFetch, { type RequestInit, type Response } from "node-fetch";
import { CookieJar } from "tough-cookie";

// ---------------------------------------------------------------------------
// Review-gated core capability: play.net web login + inactive-character scrape,
// ported from v1 (GSIVDashboard backend/src/playdotnet.ts). The base fetch is
// injectable so the login flow is fully testable without network access.
// Plaintext passwords only ever enter the login POST body; never logged.
// ---------------------------------------------------------------------------

export interface InactiveChar {
  game: string;
  name: string;
  level: number;
  race: string;
  profession: string;
  last_login: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const SIGNIN_URL = "https://www.play.net/gs4/signin_needed.asp";
const LOGIN_URL = "https://www.play.net/includes/common/login/login.asp";
const INACTIVE_URL = "https://www.play.net/gs4/account/inactive_characters.asp";

/** Parse the inactive_characters.asp table (header row + one row per deleted char). */
export function parseInactiveCharacters(html: string): InactiveChar[] {
  const $ = load(html);
  const chars: InactiveChar[] = [];
  $("table tr").each((i, row) => {
    if (i === 0) return;
    const cells = $(row)
      .find("td")
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length >= 5) {
      chars.push({
        game: cells[0],
        name: cells[1],
        level: Number.parseInt(cells[2], 10) || 0,
        race: cells[3],
        profession: cells[4],
        last_login: cells[5] || "",
      });
    }
  });
  return chars;
}

export class Playdotnet {
  constructor(private fetchFn: FetchFn = nodeFetch) {}

  async listInactiveCharacters(account: string, password: string): Promise<InactiveChar[]> {
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const jar = new CookieJar();
      await jar.setCookie("PersonalizationCookies=true; Domain=.play.net; Path=/; Secure", "https://www.play.net");
      await jar.setCookie("TrackingCookies=true; Domain=.play.net; Path=/; Secure", "https://www.play.net");
      const fetchC = makeFetchCookie(this.fetchFn, jar);

      await fetchC(SIGNIN_URL, { headers: { "User-Agent": UA } });

      const loginResp = await fetchC(LOGIN_URL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: SIGNIN_URL,
          Origin: "https://www.play.net",
        },
        body: new URLSearchParams({
          return_okay_page: "",
          return_error_page: "/gs4/login_error.asp",
          remember_account: "",
          remember_password: "",
          account_name: account,
          account_password: password,
          submit: "CONTINUE",
        }).toString(),
        redirect: "manual",
      });

      if (loginResp.status !== 302) {
        if (loginResp.status === 500) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        throw new Error("play.net login failed");
      }
      const loc = loginResp.headers.get("location") || "";
      if (loc.includes("error")) throw new Error("play.net login rejected");

      const resp = await fetchC(INACTIVE_URL, { headers: { "User-Agent": UA } });
      if (resp.status === 500) continue;
      if (resp.status !== 200) throw new Error(`inactive_characters returned ${resp.status}`);

      return parseInactiveCharacters(await resp.text());
    }
    throw new Error("play.net all retries hit broken backend");
  }
}
