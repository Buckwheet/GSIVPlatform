# play.net inactive-character scrape (roster-sync Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port v1's play.net `inactive_characters.asp` scraper into a review-gated core capability and wire it into the accounts scan so deleted characters are persisted (`deleted=1` + level/race/profession/last_login) and surfaced distinctly from transferred/inactive chars.

**Architecture:** New `core/playdotnet.ts` capability (mirrors `core/sge.ts`: injectable fetch, no credential logging) called from `AccountsStore.refresh()` after a successful SGE check, non-fatal. `account_characters` gains a `deleted` column and `saveScan` persists the enrichment columns; `/accounts` + `/accounts/stale` + the Accounts page surface the signal.

**Tech Stack:** TypeScript, Hono/zod-openapi, better-sqlite3, Vitest, React; `node-fetch` + `fetch-cookie` + `tough-cookie` + `cheerio`.

## Global Constraints

- Repo lives on `D:\` — ALL edits through bash (file tools refuse D:).
- Testing rule: Fisternar/Neleourg only. Amn is off-limits for any testing.
- Passwords: never log plaintext; play.net login POST body only.
- Deps (all bundle their own types; tough-cookie v6 is dual CJS/ESM): `node-fetch@^3.3.2`, `fetch-cookie@^3.2.0`, `tough-cookie@^6.0.2`, `cheerio@^1.2.0`.
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`.
- Branch workflow: `git checkout -b feat/playdotnet-inactive-scrape` (BEFORE committing) → push → `gh pr create --base main` → `gh pr merge <n> --merge`.
- Deploy: backend `dist` + frontend CONTENTS into `/opt/gsiv-platform/frontend` (Caddy root, never `dist/`); verify public bundle is `text/javascript`.
- Spec: `docs/superpowers/specs/2026-08-13-playdotnet-inactive-scrape-design.md` (committed `2306d22`).

---

### Task 1: `core/playdotnet.ts` capability + deps

**Files:**
- Modify: `backend/package.json` (+ deps), `backend/package-lock.json` (via npm install)
- Create: `backend/src/core/playdotnet.ts`
- Test: `backend/tests/core/playdotnet.test.ts`

**Interfaces:**
- Consumes: nothing (leaf capability).
- Produces: `InactiveChar { game; name; level; race; profession; last_login }`, `FetchFn = (url: string, init?: RequestInit) => Promise<Response>` (node-fetch types), `parseInactiveCharacters(html): InactiveChar[]`, `class Playdotnet { constructor(fetchFn?: FetchFn); listInactiveCharacters(account, password): Promise<InactiveChar[]> }`. Later tasks rely on these exact names.

- [ ] **Step 1: Create the branch + install deps**

```bash
cd "D:/Code Projects/GSIVPlatform"
git checkout main && git pull
git checkout -b feat/playdotnet-inactive-scrape
cd backend && npm install node-fetch fetch-cookie tough-cookie cheerio
```

Expected: `package.json` + `package-lock.json` gain the 4 deps; no build break.

- [ ] **Step 2: Write the failing test** — create `backend/tests/core/playdotnet.test.ts` with the code in the next block.

```ts
import { Response } from "node-fetch";
import { describe, expect, it } from "vitest";
import { Playdotnet, parseInactiveCharacters, type FetchFn } from "../../src/core/playdotnet.js";

const TABLE = `<table>
  <tr><th>Game</th><th>Name</th><th>Level</th><th>Race</th><th>Profession</th><th>Last Login</th></tr>
  <tr><td>GemStone IV</td><td>Mahres</td><td>42</td><td>Elf</td><td>Wizard</td><td>2026-01-15</td></tr>
  <tr><td>Shattered</td><td>Ghost</td><td>12</td><td>Human</td><td>Cleric</td><td></td></tr>
  <tr><td>GemStone IV</td><td>BadLevel</td><td>n/a</td><td>Dwarf</td><td>Warrior</td><td>2025-03-01</td></tr>
  <tr><td>short row</td></tr>
</table>`;

const INACTIVE = [{ game: "GemStone IV", name: "Mahres", level: 42, race: "Elf", profession: "Wizard", last_login: "2026-01-15" }];
const INACTIVE_HTML = `<table><tr><th>Game</th></tr><tr><td>GemStone IV</td><td>Mahres</td><td>42</td><td>Elf</td><td>Wizard</td><td>2026-01-15</td></tr></table>`;

describe("parseInactiveCharacters", () => {
  it("skips the header + short rows and coerces level/last_login", () => {
    const chars = parseInactiveCharacters(TABLE);
    expect(chars).toHaveLength(3);
    expect(chars[0]).toEqual({ game: "GemStone IV", name: "Mahres", level: 42, race: "Elf", profession: "Wizard", last_login: "2026-01-15" });
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
      url.includes("login.asp") ? new Response("", { status: 302, headers: { location: "/gs4/login_error.asp" } }) : new Response("", { status: 200 });
    await expect(new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET")).rejects.toThrow("play.net login rejected");
  });

  it("throws 'play.net login failed' on a non-302 login", async () => {
    const fetchFn: FetchFn = async () => new Response("", { status: 200 });
    await expect(new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET")).rejects.toThrow("play.net login failed");
  });

  it("retries a 500 login and then succeeds", async () => {
    let logins = 0;
    const fetchFn: FetchFn = async (url) => {
      if (url.includes("login.asp")) {
        logins += 1;
        return logins === 1 ? new Response("", { status: 500 }) : new Response("", { status: 302, headers: { location: "/gs4/home.asp" } });
      }
      if (url.includes("inactive_characters")) return new Response(INACTIVE_HTML, { status: 200 });
      return new Response("", { status: 200 });
    };
    const chars = await new Playdotnet(fetchFn).listInactiveCharacters("BUCKWHEET", "SECRET");
    expect(chars).toEqual(INACTIVE);
    expect(logins).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/core/playdotnet.test.ts`
Expected: FAIL — cannot resolve `../../src/core/playdotnet.js` (module does not exist).

- [ ] **Step 4: Implement `backend/src/core/playdotnet.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/core/playdotnet.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
cd backend && npm run typecheck
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/core/playdotnet.ts backend/tests/core/playdotnet.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(core): play.net inactive-char scrape capability (roster-sync Phase B)"
```

Expected: typecheck clean. If `makeFetchCookie(this.fetchFn, jar)` type-inference complains, change it to `makeFetchCookie(this.fetchFn as never, jar)` and re-run — do NOT weaken strict mode.

---

### Task 2: `AccountsStore` integration (deleted column + refresh merge + saveScan)

**Files:**
- Modify: `backend/src/modules/accounts/store.ts`
- Test: `backend/tests/modules/accounts/store.test.ts`

**Interfaces:**
- Consumes: `Playdotnet` + `InactiveChar` from Task 1.
- Produces: `AccountsStore` constructor gains a required `playnet: Playdotnet` param (6th positional, before `opts`); `ScanCharacterRow` gains `deleted: number`; `account_characters` gains a `deleted` column; `saveScan` persists `level/race/profession/last_login/deleted`. `refresh()` scrapes play.net after SGE `ok` and merges deleted chars (non-fatal).

- [ ] **Step 1: Write the failing tests** — edit `backend/tests/modules/accounts/store.test.ts`:

Add the import (top of file, after the existing `Sge` import):

```ts
import { Playdotnet, type InactiveChar } from "../../../src/core/playdotnet.js";
```

Add the fake + `playnet` override to `makeStore`. First, insert this helper just above `describe("AccountsStore", ...)`:

```ts
class FakePlaydotnet extends Playdotnet {
  constructor(private chars: InactiveChar[] = [], private error?: Error) {
    super();
  }
  override async listInactiveCharacters(): Promise<InactiveChar[]> {
    if (this.error) throw this.error;
    return this.chars;
  }
}
```

Then in `makeStore`, add `playnet?: Playdotnet;` to the `overrides` type and pass it to the constructor (replace the existing `new AccountsStore(...)` call):

```ts
const store = new AccountsStore(
  db,
  overrides.yaml ?? new EntryYaml(yamlPath),
  overrides.ruby ?? okRuby(),
  overrides.sge ?? sgeError(new Error("no network")),
  overrides.invDb ?? new FakeInvDb(),
  overrides.playnet ?? new FakePlaydotnet(),
  {
    delayMs: overrides.delayMs ?? 0,
    emit: overrides.emit ?? ((type, payload) => emitted.push({ type, payload })),
    log: overrides.log ?? ((type, _c, detail) => logged.push(`${type}:${detail}`)),
  },
);
```

Then add these three tests inside `describe("AccountsStore", ...)` (after the `cleanupStale dryRun` test, before `describe("refreshAndClassify", ...)`):

```ts
  it("marks a deleted entry_only char from the play.net scrape (deleted=1 + fields)", async () => {
    const inactive = [
      { game: "GemStone IV", name: "Fisternar", level: 42, race: "Elf", profession: "Wizard", last_login: "2026-01-15" },
    ];
    const { store } = makeStore({
      sge: sgeOk([{ slot: "1", name: "Zepherus" }]), // Fisternar vanishes from SGE -> entry_only
      playnet: new FakePlaydotnet(inactive),
    });
    await store.scanOne("BUCKWHEET");
    const list = await store.list();
    const fisternar = list.characters.find((c) => c.char_name === "Fisternar");
    expect(fisternar).toMatchObject({
      status: "entry_only",
      deleted: 1,
      level: 42,
      race: "Elf",
      profession: "Wizard",
      last_login: "2026-01-15",
    });
  });

  it("adds a brand-new deleted char as source=inactive (GSF for Shattered)", async () => {
    const inactive = [
      { game: "Shattered", name: "Ghostchar", level: 7, race: "Human", profession: "Cleric", last_login: "2025-03-01" },
    ];
    const { store } = makeStore({
      sge: sgeOk([{ slot: "1", name: "Zepherus" }]),
      playnet: new FakePlaydotnet(inactive),
    });
    await store.scanOne("BUCKWHEET");
    const list = await store.list();
    const ghost = list.characters.find((c) => c.char_name === "Ghostchar");
    expect(ghost).toMatchObject({ source: "inactive", status: "entry_only", deleted: 1, game_code: "GSF", level: 7 });
  });

  it("a play.net failure does not fail the scan or change auth_status", async () => {
    const { store } = makeStore({
      sge: sgeOk([{ slot: "1", name: "Zepherus" }]),
      playnet: new FakePlaydotnet([], new Error("boom")),
    });
    const res = await store.scanOne("BUCKWHEET");
    expect(res.ok).toBe(true);
    const list = await store.list();
    expect(list.accounts[0].auth_status).toBe("ok");
    expect(list.characters.every((c) => c.deleted === 0)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: FAIL — `AccountsStore` has no `playnet` constructor param (TS error) / `deleted` is undefined.

- [ ] **Step 3: Implement `backend/src/modules/accounts/store.ts`**

Five edits:

**(a)** Add the import (after `import type { Sge } from "../../core/sge.js";`):

```ts
import type { Playdotnet } from "../../core/playdotnet.js";
```

**(b)** Add `deleted` to the `ScanCharacterRow` interface (after `auto_added: number;`):

```ts
  auto_added: number;
  deleted: number;
```

**(c)** Append the migration (after the existing `no_active_chars` line):

```ts
  `ALTER TABLE accounts ADD COLUMN no_active_chars INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE account_characters ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`,
```

**(d)** Add the constructor param (after `private invDb: InvDbCleaner,`):

```ts
    private invDb: InvDbCleaner,
    private playnet: Playdotnet,
```

**(e)** In `refresh()`, insert the play.net merge between the SGE `try/catch` and the `const noActiveChars = ...` line. Locate:

```ts
    const noActiveChars = authStatus === "ok" && characters.every((c) => c.status !== "active") ? 1 : 0;
```

and insert ABOVE it:

```ts
    // Phase B: play.net inactive (deleted) characters — non-fatal enrichment.
    try {
      const inactive = await this.playnet.listInactiveCharacters(accountName, decrypted.plain);
      const byName = new Map(characters.map((c) => [c.char_name.toLowerCase(), c]));
      for (const ic of inactive) {
        const existing = byName.get(ic.name.toLowerCase());
        if (existing && existing.status === "entry_only") {
          existing.deleted = 1;
          existing.level = ic.level;
          existing.race = ic.race;
          existing.profession = ic.profession;
          existing.last_login = ic.last_login;
        } else if (!existing) {
          characters.push({
            account_name: accountName,
            char_name: ic.name,
            slot: null,
            game_code: ic.game.includes("Shattered") ? "GSF" : "GS3",
            source: "inactive",
            status: "entry_only",
            auto_added: 0,
            level: ic.level,
            race: ic.race,
            profession: ic.profession,
            last_login: ic.last_login,
            deleted: 1,
          });
        }
        // a deleted char matching an active SGE row is ignored (defensive)
      }
    } catch (err) {
      console.error(`play.net scrape failed for ${accountName}:`, (err as Error).message);
    }

    const noActiveChars = authStatus === "ok" && characters.every((c) => c.status !== "active") ? 1 : 0;
```

**(f)** Extend `saveScan` to persist the enrichment columns. Replace the `update` + `insert` prepared statements and the loop body:

```ts
    const update = this.db.prepare(
      `UPDATE account_characters
       SET slot = ?, game_code = ?, source = ?, status = ?, auto_added = ?,
           level = ?, race = ?, profession = ?, last_login = ?, deleted = ?,
           last_seen = COALESCE(?, last_seen)
       WHERE account_name = ? AND LOWER(char_name) = LOWER(?)`,
    );
    const insert = this.db.prepare(
      `INSERT INTO account_characters (account_name, char_name, slot, game_code, source, status, auto_added, level, race, profession, last_login, deleted, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of characters) {
      const status = c.status ?? "active";
      const lastSeen = status === "active" ? now : null;
      const level = c.level ?? null;
      const race = c.race ?? null;
      const profession = c.profession ?? null;
      const lastLogin = c.last_login ?? null;
      const deleted = c.deleted ?? 0;
      if (find.get(accountName, c.char_name)) {
        update.run(c.slot, c.game_code, c.source, status, c.auto_added ?? 0, level, race, profession, lastLogin, deleted, lastSeen, accountName, c.char_name);
      } else {
        insert.run(accountName, c.char_name, c.slot, c.game_code, c.source, status, c.auto_added ?? 0, level, race, profession, lastLogin, deleted, lastSeen);
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/modules/accounts/store.ts backend/tests/modules/accounts/store.test.ts
git commit -m "accounts: persist play.net deleted-char signal (deleted col + refresh merge)"
```

- [ ] **Step 6: Fix the remaining `AccountsStore` call sites (index.ts + routes.test.ts)**

**(g)** `backend/src/index.ts` — add the import after the `createKV` import:

```ts
import { Playdotnet } from "./core/playdotnet.js";
```

and change the constructor call:

```ts
const accountsStore = new AccountsStore(db, new EntryYaml(), new Ruby(), new Sge(), new InvDb(), new Playdotnet(), {
  emit: (type, payload) => eventBus.emit(type, payload),
  log: (type, char, detail, source) => eventLog.log(type, char, detail, source),
});
```

**(h)** `backend/tests/modules/accounts/routes.test.ts` — add the import (after the `Sge` import):

```ts
import { Playdotnet, type InactiveChar } from "../../../src/core/playdotnet.js";
```

add a noop helper above `describe("accounts module routes", ...)`:

```ts
class NoopPlaydotnet extends Playdotnet {
  override async listInactiveCharacters(): Promise<InactiveChar[]> {
    return [];
  }
}
```

then in `makeApp`, change `new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, fakeInvDb(), { delayMs: 0 })` to:

```ts
const store = new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, fakeInvDb(), new NoopPlaydotnet(), { delayMs: 0 });
```

and in the inline store (the `GET /accounts/stale` test), change `new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, fakeInvDb(), { delayMs: 0 })` to:

```ts
const store = new AccountsStore(db, new EntryYaml(ENTRY_YAML), ruby, sge, fakeInvDb(), new NoopPlaydotnet(), { delayMs: 0 });
```

- [ ] **Step 7: Run the full backend gate for this task**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts tests/modules/accounts/routes.test.ts && npm run typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 8: Commit**

```bash
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/modules/accounts/store.ts backend/tests/modules/accounts/store.test.ts backend/src/index.ts backend/tests/modules/accounts/routes.test.ts
git commit -m "accounts: wire play.net scraper into the scan + persist deleted signal"
```

---

### Task 3: Schema + routes test + frontend annotation + SECURITY.md

**Files:**
- Modify: `backend/src/modules/accounts/index.ts`, `backend/tests/modules/accounts/routes.test.ts`, `frontend/src/pages/accounts/index.tsx`, `backend/SECURITY.md`

**Interfaces:**
- Consumes: `deleted` column + `ScanCharacterRow.deleted` from Task 2.
- Produces: `characterSchema` exposes `deleted`; the Accounts page Roster-issues list distinguishes deleted/transferred/inactive; SECURITY.md documents the new capability.

- [ ] **Step 1: Expose `deleted` in the schema** — `backend/src/modules/accounts/index.ts`, add after `auto_added: z.number(),` in `characterSchema`:

```ts
  deleted: z.number(),
```

- [ ] **Step 2: Assert `deleted` in the routes test** — `backend/tests/modules/accounts/routes.test.ts`, in the `GET /accounts/stale returns entry_only chars` test, change the body type + assertions:

```ts
    const body = (await res.json()) as {
      characters: { account_name: string; char_name: string; status: string; transferred_to: string | null; deleted: number }[];
      accounts: { account_name: string; auth_status: string }[];
    };
    const buckwheet = body.characters.filter((c) => c.account_name === "BUCKWHEET");
    expect(buckwheet.map((c) => c.char_name).sort()).toEqual(["Fisternar"]);
    expect(buckwheet.every((c) => c.status === "entry_only")).toBe(true);
    expect(buckwheet.every((c) => c.transferred_to === null)).toBe(true);
    expect(buckwheet.every((c) => c.deleted === 0)).toBe(true);
```

- [ ] **Step 3: Frontend annotation** — `frontend/src/pages/accounts/index.tsx`. Extend the `StaleChar` interface:

```ts
interface StaleChar {
  account_name: string;
  char_name: string;
  status: string;
  last_seen: number | null;
  transferred_to?: string | null;
  deleted?: number;
  level?: number | null;
  profession?: string | null;
  last_login?: string | null;
}
```

and replace the stale-char `<li>` body:

```tsx
              {stale.characters.map((c) => (
                <li key={`c-${c.account_name}-${c.char_name}`}>
                  <code>{c.char_name}</code> · {c.account_name}
                  {c.deleted
                    ? ` · deleted${c.last_login ? ` (last login ${c.last_login})` : ""}${c.level ? ` · L${c.level} ${c.profession ?? ""}` : ""}`
                    : c.last_seen
                      ? ` · last seen ${new Date(c.last_seen).toLocaleString()}`
                      : " · never seen active"}
                  {c.transferred_to ? ` · ⚠ possibly transferred to ${c.transferred_to}` : ""}
                </li>
              ))}
```

- [ ] **Step 4: SECURITY.md delta** — `backend/SECURITY.md`, in the accounts module section, replace the sentence:

> playdotnet inactive-char + store-balance scraping is a tracked follow-on (plan Task 9) — not yet ported.

with:

> play.net inactive-char scraping is confined to the review-gated `core/playdotnet.ts` — HTTPS to hardcoded `www.play.net` URLs only, standard TLS verification (play.net web serves a valid public cert, unlike eaccess), plaintext password in the login POST body only (never logged/returned), injectable fetch for tests, 5-attempt retry + non-fatal on failure. The scrape performs a web login per scanned account (weekly cadence + failed-account re-checks). Store-balance scraping remains a tracked follow-on.

- [ ] **Step 5: Verify + commit**

```bash
cd backend && npx vitest run tests/modules/accounts/routes.test.ts && npm run typecheck && npm run lint
cd ../frontend && npm run build
cd "D:/Code Projects/GSIVPlatform"
git add backend/src/modules/accounts/index.ts backend/tests/modules/accounts/routes.test.ts frontend/src/pages/accounts/index.tsx backend/SECURITY.md
git commit -m "accounts: expose deleted signal in API + Accounts page; SECURITY.md delta"
```

---

### Task 4: Full gate + PR

**Files:** none (verification + git).

- [ ] **Step 1: Full gate**

```bash
cd "D:/Code Projects/GSIVPlatform/backend" && npm test && npm run typecheck && npm run lint
cd ../frontend && npm run build
```

Expected: all green (351 existing + ~7 new backend tests).

- [ ] **Step 2: Push + open PR**

```bash
cd "D:/Code Projects/GSIVPlatform"
git push -u origin feat/playdotnet-inactive-scrape
gh pr create --base main --title "roster-sync Phase B: play.net inactive-char scrape" --body "Ports v1 scrapeInactiveCharacters into core/playdotnet.ts and wires it into the accounts scan (deleted=1 + level/race/profession/last_login). Spec: docs/superpowers/specs/2026-08-13-playdotnet-inactive-scrape-design.md"
```

Expected: PR opens; CI (if any) green.

---

### Task 5: Rollout (deploy + live-smoke + STATUS.md)

No repo tests here; verified via SSH + live API. Testing rule: Fisternar/Neleourg only; Amn off-limits. Server: `ssh -i ~/.ssh/id_ed25519 ubuntu@51.68.235.144` (origin IP; runbook at top of `/opt/gsiv-platform/backend/.env`).

- [ ] **Step 1: Merge**

`gh pr merge <n> --merge` (delete the branch).

- [ ] **Step 2: Deploy backend + frontend**

Build + scp per the server `.env` runbook: backend `dist` + `package.json`/lock (with the 4 new deps → run `npm ci --omit=dev` on the server), frontend CONTENTS into `/opt/gsiv-platform/frontend`. `sudo systemctl restart gsiv-platform`; verify `systemctl is-active gsiv-platform`.

- [ ] **Step 3: Live-smoke on a Fisternar/Neleourg account**

`curl -s -X POST -H "Authorization: Bearer <admin>" https://gsiv.phylactery.ovh/api/modules/accounts/accounts/CGROSS/scan` (or JAYCELIA) → poll `GET .../accounts`. Verify:
- `auth_status=ok`; the play.net scrape ran without disturbing the scan.
- Deleted chars surface as `source="inactive"`/`deleted=1` (or the account simply has none — both are valid).
- `GET /accounts/stale` shows `deleted`/`last_login` for any deleted entry_only char.
- Public bundle `text/javascript` (CF cache gotcha — hard refresh / purge if stale).

- [ ] **Step 4: Document + commit**

Update `docs/STATUS.md` §7 session log + restart prompt; save memory `gsivplatform-...playdotnet-...`. Commit:

```bash
git add docs/STATUS.md && git commit -m "docs: roster-sync Phase B (play.net inactive scrape) live (STATUS §7)"
```
