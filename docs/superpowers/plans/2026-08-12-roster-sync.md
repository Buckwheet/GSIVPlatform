# Weekly Roster Sync (SGE gather / verify / correct) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the v2 accounts module into a weekly SGE-driven roster sync that saves the authoritative character list, auto-adds new characters to entry.yaml, and flags stale characters/accounts.

**Architecture:** Extend the existing `AccountsStore` (scanOne/scanAll) in `backend/src/modules/accounts/store.ts`: per-row upsert with `status` (`active`/`entry_only`) + `auto_added` columns instead of delete-and-reinsert, auto-add SGE-discovered chars via the review-gated `EntryYaml.addCharacter` capability, and a new `GET /accounts/stale` endpoint. A systemd timer (server ops) triggers the scan weekly.

**Tech Stack:** TypeScript, Hono/zod-openapi (backend), better-sqlite3 via `CoreDb`, Vitest, React (frontend), systemd timers (server).

## Global Constraints

- Repo lives on `D:\` — ALL edits through bash (file tools refuse D:).
- Testing rule: Fisternar/Neleourg only. Amn is off-limits for any testing.
- entry.yaml writes ONLY through the review-gated `EntryYaml` capability (SECURITY.md).
- Passwords: never log plaintext; transfer encrypted blobs only; plaintext only inside the Ruby capability process.
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` + `cd frontend && npm run build`.
- Deploy: backend `dist` + frontend CONTENTS into `/opt/gsiv-platform/frontend` (Caddy root, never `dist/`); verify public bundle is `text/javascript` (CF cache gotcha).
- Spec: `docs/superpowers/specs/2026-08-12-roster-sync-design.md` (committed `08b80bd`).

---

### Task 1: Roster-scan storage semantics (status + auto_added + no-delete upsert)

**Files:**
- Modify: `backend/src/modules/accounts/store.ts`
- Test: `backend/tests/modules/accounts/store.test.ts`

**Interfaces:**
- Consumes: existing `ScanCharacterRow`, `saveScan(accountName, authStatus, authError, characters)`.
- Produces: `account_characters` gains `status TEXT NOT NULL DEFAULT 'active'` and `auto_added INTEGER NOT NULL DEFAULT 0`; rows upsert per `(account_name, LOWER(char_name))`; `last_seen` only advances for `status='active'`. Rows for accounts scanned BEFORE the first scan of a char with neither source are left untouched.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/modules/accounts/store.test.ts` (uses existing `makeStore`/`sgeOk`/`sgeError` helpers):

```ts
it("upserts per char: keeps stale rows + preserves last_seen for entry_only", async () => {
  const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
  await store.scanOne("BUCKWHEET");
  await store.scanOne("BUCKWHEET", [{ char_name: "Zepherus", game_code: "GSIV" }]); // SGE list shrinks to Zepherus
  const list = await store.list();
  const chars = list.characters.filter((c) => c.account_name === "BUCKWHEET");
  const fisternar = chars.find((c) => c.char_name === "Fisternar");
  expect(fisternar?.status).toBe("entry_only");
  expect(fisternar?.last_seen).toBeNull(); // never seen active
  const zepherus = chars.find((c) => c.char_name === "Zepherus");
  expect(zepherus?.status).toBe("active");
  expect(zepherus?.last_seen).toBeTypeOf("number");
});
```

Wait — `last_seen` for Fisternar: it was never on SGE → entry_only with NULL last_seen. But the second scanOne call passes an explicit chars array `[{char_name:"Zepherus"}]` (simulating entry.yaml having only Zepherus). Hmm — in reality entry.yaml for BUCKWHEET has Fisternar + Zepherus; SGE returns only Zepherus → Fisternar becomes entry_only. Use the real flow: second scanOne WITHOUT explicit chars (entry.yaml unchanged) but sgeOk returning only Zepherus → Fisternar not on SGE → entry_only.

```ts
it("upserts per char: keeps stale rows + preserves last_seen", async () => {
  const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Fisternar" }, { slot: "2", name: "Zepherus" }]) });
  await store.scanOne("BUCKWHEET");
  const { store: store2 } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) }); // Fisternar vanished from SGE
  await store2.scanOne("BUCKWHEET");
  const list = await store2.list();
  const chars = list.characters.filter((c) => c.account_name === "BUCKWHEET");
  const fisternar = chars.find((c) => c.char_name === "Fisternar");
  expect(fisternar?.status).toBe("entry_only");
  const zepherus = chars.find((c) => c.char_name === "Zepherus");
  expect(zepherus?.status).toBe("active");
  expect(zepherus?.last_seen).toBeTypeOf("number");
});
```

Note: two separate in-memory stores don't share a DB. Use ONE store and TWO scans with the SAME store but swap sge between scans — the store holds `this.sge` from construction. Refactor: construct store with `sgeOk([...Fisternar+Zepherus])`, scan; then mutate the sge? Not possible. Instead scan twice with the same store but make sgeOk return different results per call — add a mutable closure:

```ts
let sgeChars = [{ slot: "1", name: "Fisternar" }, { slot: "2", name: "Zepherus" }];
const sge = new Sge((_h, _p, onData) => {
  const fields = sgeChars.flatMap((c) => [c.slot, c.name]);
  const chunks = ["MASK", "A\tKEY=abc", "M", "N", "G", `C\t1\tGS3\t1\t2\t${fields.join("\t")}`];
  let i = 0;
  const deliver = (idx: number) => { if (idx < chunks.length) setImmediate(() => onData(Buffer.from(chunks[idx], "binary"))); };
  deliver(0);
  return { write: () => { i += 1; deliver(i); }, destroy: () => {} };
});
const { store } = makeStore({ sge });
await store.scanOne("BUCKWHEET");
sgeChars = [{ slot: "1", name: "Zepherus" }]; // Fisternar vanished
await store.scanOne("BUCKWHEET");
// ...asserts as above (Fisternar entry_only with null last_seen, Zepherus active)
```

Plus a test that a second scan does NOT delete rows and `status`/`auto_added` columns exist (`list.characters[0]` has keys).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: FAIL — `status` is undefined (no column), rows deleted on second scan.

- [ ] **Step 3: Implement**

In `store.ts` MIGRATIONS append (indexes 2 and 3 — keep CREATEs unchanged so fresh + existing DBs both work):

```ts
`ALTER TABLE account_characters ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
`ALTER TABLE account_characters ADD COLUMN auto_added INTEGER NOT NULL DEFAULT 0`,
```

Extend `ScanCharacterRow` with `status?: string; auto_added?: number;`. Rewrite `saveScan`'s character loop to per-row select/update/insert (see design):

```ts
const now = Date.now();
const find = this.db.prepare("SELECT last_seen FROM account_characters WHERE account_name = ? AND LOWER(char_name) = LOWER(?)");
const update = this.db.prepare(
  `UPDATE account_characters SET slot = ?, game_code = ?, source = ?, status = ?, auto_added = ?,
     last_seen = COALESCE(?, last_seen)
   WHERE account_name = ? AND LOWER(char_name) = LOWER(?)`,
);
const insert = this.db.prepare(
  `INSERT INTO account_characters (account_name, char_name, slot, game_code, source, status, auto_added, last_seen)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const c of characters) {
  const status = c.status ?? "active";
  const lastSeen = status === "active" ? now : null;
  if (find.get(accountName, c.char_name)) {
    update.run(c.slot, c.game_code, c.source, status, c.auto_added ?? 0, lastSeen, accountName, c.char_name);
  } else {
    insert.run(accountName, c.char_name, c.slot, c.game_code, c.source, status, c.auto_added ?? 0, lastSeen);
  }
}
```

Set `status: "entry_only"` on rows from `yamlOnlyChars` and on yaml-only rows in the scanOne success path; `status: "active"` on SGE rows. (Update `yamlOnlyChars` return rows.)

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

`git add backend/src/modules/accounts/
store.ts backend/tests/modules/accounts/store.test.ts && git commit -m "accounts: per-row roster upsert with status/auto_added (keep stale rows, preserve last_seen)"
### Task 2: Auto-add SGE-discovered characters to entry.yaml

**Files:**
- Modify: `backend/src/modules/accounts/store.ts`
- Test: `backend/tests/modules/accounts/store.test.ts`

**Interfaces:**
- Consumes: `this.yaml.addCharacter(accountName: string, charName: string, gameCode: string) => { ok: boolean; error?: string }` (existing capability; validates + normalizes char name, backup-then-write).
- Produces: chars on SGE but absent from entry.yaml are written to entry.yaml during `scanOne`; their rows get `auto_added = 1`. A failed write never aborts the account scan.

- [ ] **Step 1: Write the failing test**

The store's `EntryYaml` must be a REAL instance on a temp copy of the fixture so the write is observable (pattern from `routes.test.ts`). Add to `store.test.ts`:

```ts
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

it("auto-adds a new SGE char to entry.yaml (auto_added=1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acct-auto-"));
  const yamlPath = join(dir, "entry.yaml");
  copyFileSync(FIXTURE, yamlPath);
  const yaml = new EntryYaml(yamlPath);
  const { store } = makeStore({ yaml, sge: sgeOk([{ slot: "1", name: "Freshchar" }]) });
  const res = await store.scanOne("BUCKWHEET");
  expect(res.ok).toBe(true);
  const yamlChars = yaml.read().map((c) => c.char_name);
  expect(yamlChars).toContain("Freshchar");
  const list = await store.list();
  const fresh = list.characters.find((c) => c.char_name === "Freshchar");
  expect(fresh?.auto_added).toBe(1);
  expect(fresh?.status).toBe("active");
  rmSync(dir, { recursive: true, force: true });
});
```

Make `makeStore` accept a `yaml` override: `{ db, yaml = new EntryYaml(FIXTURE), ruby, sge, ... }`. Also a failure-path test with an `EntryYaml` subclass whose `addCharacter` returns `{ ok: false, error: "boom" }` — assert `scanOne` still resolves ok, the row is recorded with `auto_added = 0`, and `auth_status` is `ok`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: FAIL — `Freshchar` not in entry.yaml, `auto_added` undefined.

- [ ] **Step 3: Implement**

In `scanOne`'s success path, before building rows, auto-add:

```ts
const yamlMap = new Map(chars.map((c) => [c.char_name.toLowerCase(), c]));
const autoAdded = new Set<string>();
for (const sc of sgeChars) {
  if (yamlMap.has(sc.name.toLowerCase())) continue;
  try {
    const r = this.yaml.addCharacter(accountName, sc.name, gameCode);
    if (r.ok) {
      autoAdded.add(sc.name.toLowerCase());
      console.error(`roster-sync: auto-added ${sc.name} to entry.yaml (${accountName})`);
    } else {
      console.error(`roster-sync: auto-add failed for ${sc.name} (${accountName}): ${r.error}`);
    }
  } catch (err) {
    console.error(`roster-sync: auto-add error for ${sc.name} (${accountName}):`, (err as Error).message);
  }
}
```

Then when pushing each SGE row: `auto_added: autoAdded.has(sc.name.toLowerCase()) ? 1 : 0, status: "active"`. (Keep `gameCode` from `yamlMap` or the fallback, as today.)

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add backend/src/modules/accounts/store.ts backend/tests/modules/accounts/store.test.ts && git commit -m "accounts: auto-add SGE-discovered chars to entry.yaml during scanOne"`
### Task 3: GET /accounts/stale endpoint

**Files:**
- Modify: `backend/src/modules/accounts/store.ts`
- Modify: `backend/src/modules/accounts/index.ts`
- Test: `backend/tests/modules/accounts/routes.test.ts`

**Interfaces:**
- Consumes: `ScanCharacterRow`/`ScanAccountRow` (now include `status`/`auto_added`).
- Produces: `AccountsStore.stale(): Promise<{ characters: ScanCharacterRow[]; accounts: ScanAccountRow[] }>`; route `GET /accounts/stale` (scope `accounts.read`) mounted under the module prefix (`/api/modules/accounts/accounts/stale`).

- [ ] **Step 1: Write the failing test**

Add to `routes.test.ts`:

```ts
it("GET /accounts/stale requires accounts.read and returns flagged rows", async () => {
  const app = makeApp("limited:tok:accounts.read,accounts.write");
  expect((await app.request("/api/modules/accounts/accounts/stale")).status).toBe(401);
  const denied = makeApp("limited:tok:accounts.read");
  const ok = await app.request("/api/modules/accounts/accounts/stale", { headers: auth });
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { characters: unknown[]; accounts: unknown[] };
  expect(Array.isArray(body.characters)).toBe(true);
  expect(Array.isArray(body.accounts)).toBe(true);
});
```

Scope check for the 401 vs 403: no auth header → 401; `accounts.read` token → 200 (read scope suffices). Add a second assertion: after a scanOne with an SGE list that omits Fisternar, `characters` contains Fisternar with `status: "entry_only"`. (Drive via the store used inside `makeApp` — extend `makeApp` to return `{ app, store }` or expose the store; simplest: build the store/app inline in this one test using the existing helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/accounts/routes.test.ts`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Implement**

`store.ts`:

```ts
async stale(): Promise<{ characters: ScanCharacterRow[]; accounts: ScanAccountRow[] }> {
  const characters = this.db
    .prepare("SELECT * FROM account_characters WHERE status = 'entry_only' ORDER BY account_name, char_name")
    .all() as ScanCharacterRow[];
  const accounts = this.db
    .prepare("SELECT * FROM accounts WHERE auth_status IN ('bad_password', 'error', 'decrypt_error') ORDER BY account_name")
    .all() as ScanAccountRow[];
  return { characters, accounts };
}
```

`index.ts`: add `status: z.string()` and `auto_added: z.number()` to `characterSchema`; add `staleRoute` (GET `/accounts/stale`, 200 schema `{ characters: z.array(characterSchema), accounts: z.array(accountSchema) }`); in `registerRoutes` add `router.openapi(staleRoute, async (c) => c.json(await store.stale()));`; in `routeScopes` add `"GET /accounts/stale": ["accounts.read"]`.

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/modules/accounts/routes.test.ts tests/modules/accounts/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add backend/src/modules/accounts/store.ts backend/src/modules/accounts/index.ts backend/tests/modules/accounts/routes.test.ts && git commit -m "accounts: GET /accounts/stale surfaces entry_only chars + problem accounts"`
### Task 4: Frontend stale summary on the Accounts page

**Files:**
- Modify: `frontend/src/pages/accounts/index.tsx`

**Interfaces:**
- Consumes: `GET /modules/accounts/accounts/stale` → `{ characters: { account_name, char_name, status, last_seen }[], accounts: { account_name, auth_status, auth_error }[] }`.

Note: the Accounts page renders the ACCOUNTS table only (no char table today), so the spec's "status column + filter chips" is delivered as a compact stale summary banner instead — same information, no new UI surface.

- [ ] **Step 1: Fetch + render the stale summary**

In `refresh()` add a parallel fetch of the stale endpoint; add state `const [stale, setStale] = useState<{ characters: StaleChar[]; accounts: StaleAccount[] } | null>(null)`. Above the `Table`, render when `stale && (stale.characters.length || stale.accounts.length)`:

```tsx
<div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-warn)", border: "1px solid var(--warn)", borderRadius: "var(--radius-sm)" }}>
  <strong>Roster issues:</strong> {stale.characters.length} stale characters · {stale.accounts.length} accounts with auth errors
  <details style={{ marginTop: "var(--space-2)" }}>
    <summary style={{ cursor: "pointer" }}>Show details</summary>
    <ul style={{ margin: "var(--space-2) 0 0 0", paddingLeft: "var(--space-4)" }}>
      {stale.characters.map((c) => (
        <li key={`c-${c.account_name}-${c.char_name}`}>
          <code>{c.char_name}</code> · {c.account_name}
          {c.last_seen ? ` · last seen ${new Date(c.last_seen).toLocaleString()}` : " · never seen active"}
        </li>
      ))}
      {stale.accounts.map((a) => (
        <li key={`a-${a.account_name}`}>
          <code>{a.account_name}</code> · {a.auth_status}
          {a.auth_error ? ` (${a.auth_error.slice(0, 60)})` : ""}
        </li>
      ))}
    </ul>
  </details>
</div>
```

Verify the CSS vars exist (`--tint-warn`, `--warn` — check other pages; if absent use the `--tint-bad`/`--bad` pair already used in this file).

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

`git add frontend/src/pages/accounts/index.tsx && git commit -m "accounts page: stale roster summary banner"`

### Task 5: Rollout — migration, deploy, timer, live verify (ops)

No repo tests here; verified via SSH + live API calls. Testing rule: Fisternar/Neleourg only; Amn off-limits. Server: `ssh -i ~/.ssh/id_ed25519 ubuntu@51.68.235.144` (origin IP; runbook at top of `/opt/gsiv-platform/backend/.env`).

- [ ] **Step 1: Run the backend gate**

Run: `cd backend && npm test && npm run typecheck && npm run lint && cd ../frontend && npm run build`
Expected: all green.

- [ ] **Step 2: Migrate 36 accounts into the server entry.yaml**

On the dev machine, copy `C:\lich5\data\entry.yaml` to the server (`scp ... /tmp/local-entry.yaml`). On the server:
1. `sudo cp /opt/gs4sd/lich5/data/entry.yaml /opt/gs4sd/lich5/data/entry.yaml.bak-roster-migrate-$(date +%Y%m%d-%H%M%S)`
2. Merge with python3: union of accounts; local wins (password + characters) when present, else keep server's (KAISER999). Preserve `encryption_mode: standard` and `master_password_validation_test`.
3. Validate: YAML parses; every `char_name` matches the Lich `validateCharName` rule (letters/digits/_/-, 2-30 chars, no leading/trailing underscore); char count per account sane.
4. Verify decrypt: `cd /opt/gs4sd/lich5 && /home/ubuntu/.rbenv/versions/4.0.6/bin/ruby -e '...PasswordCipher.decrypt(...account_name: "LWELLS5500")...'` prints a password (do NOT print it to the session log — verify non-empty + base64 length only).

- [ ] **Step 3: Deploy backend + frontend**

Run the runbook scp/restore block from `/opt/gsiv-platform/backend/.env` (backend `dist` + `package.json`/lock; frontend CONTENTS into `/opt/gsiv-platform/frontend`). Restart `gsiv-platform`; verify `systemctl is-active`.

- [ ] **Step 4: Live scan verification (test platform LWELLS5500)**

`curl -s -X POST -H "Authorization: Bearer <admin>" https://gsiv.phylactery.ovh/api/modules/accounts/accounts/scan` → poll `GET .../accounts` until `last_scan` updates. Verify:
- LWELLS5500 `auth_status=ok`; chars = SGE list for the account.
- **Scorpa**: if absent from the SGE list → `status=entry_only` in `GET /accounts/stale` (the test).
- Any SGE char not in entry.yaml → auto-added (`auto_added=1` row + present in entry.yaml).
- Existing accounts keep working; `/accounts/stale` returns the flagged set.

- [ ] **Step 5: Install the weekly timer + machine-token scope**

1. Add `accounts.write` to the machine token in `/opt/gsiv-platform/backend/.env` `AUTH_TOKENS` (machine:...:gems...,...,accounts.write), restart `gsiv-platform`.
2. Create `/etc/gsiv-roster-scan.env` (0600 root) with `GSIV_ROSTER_TOKEN=<machine token>`.
3. `/etc/systemd/system/gsiv-roster-scan.service` (oneshot: `curl -s -X POST -H "Authorization: Bearer $GSIV_ROSTER_TOKEN" http://localhost:3102/api/modules/accounts/accounts/scan`) + `gsiv-roster-scan.timer` (weekly Mon 03:30 UTC, `Persistent=true`).
4. `sudo systemctl daemon-reload && sudo systemctl enable --now gsiv-roster-scan.timer && sudo systemctl start gsiv-roster-scan.service` — verify the service exits 0 and the scan lands in gsiv.db.

- [ ] **Step 6: Verify public bundle + document**

`curl -sI https://gsiv.phylactery.ovh/assets/...` → `Content-Type: text/javascript`. Update `docs/STATUS.md` §7 session log + restart prompt; commit. Save/refresh memory: roster-sync feature state.
