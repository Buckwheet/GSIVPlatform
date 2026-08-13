# SGE-based char-failure disambiguation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an invdb scan character fails, classify *why* (auth vs disabled char vs transient) via a fresh SGE re-check, and surface the reason per-char on the Scans page while writing the fresh SGE result back to the Accounts data.

**Architecture:** Reuse `AccountsStore`'s existing decrypt→SGE→save path as a `refresh()` method and add a `refreshAndClassify()` classifier. `ScansStore` gains a narrow `CharFailureClassifier` dependency (injected; the real `AccountsStore` in production), collects per-account failures, classifies them once per failed account, and persists them to a new `scan_chars` table surfaced in `/scan/status` + `/scan/history`. The frontend `/scans` page renders per-char failure lines.

**Tech Stack:** TypeScript (Hono + zod-openapi + better-sqlite3 via `CoreDb`), vitest, biome; React + Vite frontend.

## Global Constraints

- Repo at `D:\Code Projects\GSIVPlatform`. **All edits go through bash** (the `write_file`/`edit_file` tools are confined to `C:\Users\rpgfi` and refuse `D:\`). Use `cd "/d/Code Projects/GSIVPlatform"` then `node -e`/`sed`/`cat >` heredoc for edits. `read_file` does work on `D:\` for reading.
- Gate: `cd backend && npm test && npm run typecheck && npm run lint` then `cd frontend && npm run build`.
- Review-gated rule: no `child_process`/file IO outside `core/` capabilities. The classifier only reuses `Ruby` + `Sge` (already review-gated) and reads `accounts`/`account_characters` via `this.db`. No new shell/file access.
- Failure `reason`/`error` strings are SGE/systemd messages (credential-free). Never log/return plaintext passwords.
- Conventional commits (`feat(accounts): ...`, `feat(scans): ...`).
- Testing rule (live smoke only, later): Fisternar/Neleourg only, Amn off-limits.

---

### Task 1: ScansStore — classifier interface + per-char failure persistence & surfacing

**Files:**
- Modify: `backend/src/modules/scans/store.ts`
- Test: `backend/tests/modules/scans/store.test.ts`

**Interfaces:**
- Produces (exported from `store.ts`): `CharFailure`, `CharFailureClassified`, `CharFailureClassifier`; `ScanAccountState` gains `failures: CharFailureClassified[]`; `history()` accounts gain `chars: { char_name; result; code; reason }[]`.
- Consumes: nothing new (uses existing `ScanCharResult`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/modules/scans/store.test.ts`. First add the type import at the top (after the existing `ScansStore` import):

```ts
import type { CharFailureClassifier } from "../../../src/modules/scans/store.js";
```

Extend `makeStore`'s `opts` type and the `ScansStore` construction to accept/inject a `classifier`:

```ts
function makeStore(
  opts: {
    results?: Record<string, "done" | "failed">;
    maxConcurrent?: number;
    okAccounts?: string[];
    skipAccounts?: string[];
    classifier?: CharFailureClassifier;
  } = {},
) {
  // ... existing body unchanged until the new ScansStore(...) call ...
  const store = new ScansStore(
    db,
    new EntryYaml(yamlPath),
    runner,
    (type, payload) => events.push({ type, payload: JSON.parse(JSON.stringify(payload)) }),
    (type, _c, detail) => logs.push(`${type}:${detail}`),
    {
      maxConcurrent: opts.maxConcurrent ?? 5,
      okAccounts: () => opts.okAccounts ?? ["BUCKWHEET", "ALT"],
      skipAccounts: opts.skipAccounts ?? [],
      classifier: opts.classifier,
    },
  );
  return { db, store, events, logs, runner, started };
}
```

Then append these tests inside the `describe("ScansStore", ...)` block:

```ts
  it("classifies failures once per failed account and surfaces them live + in history", async () => {
    const calls: { account: string; failed: { char: string }[] }[] = [];
    const classifier: CharFailureClassifier = {
      async refreshAndClassify(account, failed) {
        calls.push({ account, failed });
        return failed.map((f) => ({ ...f, code: "char_disabled", reason: "character not active on SGE" }));
      },
    };
    const { store } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" }, classifier });
    store.start();
    await store.whenIdle();
    expect(calls).toHaveLength(1); // once per account, not per char
    expect(calls[0].account).toBe("BUCKWHEET");
    expect(calls[0].failed.map((f) => f.char).sort()).toEqual(["Fisternar", "Zepherus"]);
    const acct = store.currentJob()?.accounts.find((a) => a.account === "BUCKWHEET");
    expect(acct?.failures.map((f) => f.code)).toEqual(["char_disabled", "char_disabled"]);
    const hist = store.history();
    const histAcct = hist.jobs[0].accounts.find((a) => a.account_name === "BUCKWHEET");
    expect(histAcct?.chars.map((c) => c.code)).toEqual(["char_disabled", "char_disabled"]);
  });

  it("falls back to transient without crashing when the classifier throws", async () => {
    const classifier: CharFailureClassifier = {
      async refreshAndClassify() {
        throw new Error("boom");
      },
    };
    const { store } = makeStore({ results: { Fisternar: "failed", Zepherus: "failed" }, classifier });
    store.start();
    await store.whenIdle();
    const acct = store.currentJob()?.accounts.find((a) => a.account === "BUCKWHEET");
    expect(acct?.failures.every((f) => f.code === "transient")).toBe(true);
    expect(store.currentJob()?.status).toBe("partial");
  });

  it("persists no scan_chars rows for accounts with zero failures", async () => {
    const { store } = makeStore(); // default runner: all done
    store.start();
    await store.whenIdle();
    const hist = store.history();
    expect(hist.jobs[0].accounts.every((a) => a.chars.length === 0)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/modules/scans/store.test.ts`
Expected: FAIL — the new tests reference `CharFailureClassifier` (not exported) and `a.chars`/`acct.failures` (missing).

- [ ] **Step 3: Implement the ScansStore changes**

Edit `backend/src/modules/scans/store.ts`.

(a) Add the classifier types near the top (after the existing `CharScanner` interface, before `MIGRATIONS`):

```ts
/** A failed character as the runner reports it (never "done"). */
export interface CharFailure {
  char: string;
  result: "timeout" | "failed";
  error?: string;
}

/** A failed character with its disambiguated reason. */
export interface CharFailureClassified extends CharFailure {
  code: string;
  reason: string;
}

/** Cross-references a fresh SGE re-check to explain why chars failed. */
export interface CharFailureClassifier {
  refreshAndClassify(account: string, failed: CharFailure[]): Promise<CharFailureClassified[]>;
}

/** No-op classifier: labels every failure transient (used when none is injected). */
const defaultClassifier: CharFailureClassifier = {
  async refreshAndClassify(_account, failed) {
    return failed.map((f) => ({ ...f, code: "transient", reason: f.error ?? f.result }));
  },
};
```

(b) Add the `failures` field to `ScanAccountState`:

```ts
export interface ScanAccountState {
  account: string;
  chars: string[];
  status: AccountStatus;
  charsDone: number;
  charsFailed: number;
  current: string | null;
  stage: ScanStage | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  failures: CharFailureClassified[];
}
```

(c) Add the `scan_chars` migration + index to the `MIGRATIONS` array (append before the closing `]`):

```ts
  `CREATE TABLE IF NOT EXISTS scan_chars (
    job_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    char_name TEXT NOT NULL,
    result TEXT NOT NULL,
    code TEXT NOT NULL,
    reason TEXT,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scan_chars_job ON scan_chars(job_id)`,
```

(d) Add `classifier` to `ScansStoreOptions` and store it in the constructor:

```ts
export interface ScansStoreOptions {
  maxConcurrent?: number;
  skipAccounts?: string[];
  okAccounts?: () => string[];
  now?: () => number;
  classifier?: CharFailureClassifier;
}
```

In the constructor body, after `this.now = opts.now ?? Date.now;` add:

```ts
    this.classifier = opts.classifier ?? defaultClassifier;
```

And add the field declaration alongside the other `private readonly` fields:

```ts
  private readonly classifier: CharFailureClassifier;
```

(e) In `start()`, initialize `failures: []` in each account map entry (add to the object literal):

```ts
        error: null,
        startedAt: null,
        finishedAt: null,
        failures: [],
```

(f) Replace `runJob`'s per-char result handling + add the classify call. Replace the block:

```ts
        for (const char of acct.chars) {
          acct.current = char;
          acct.stage = "starting";
          this.emit("scan_update", this.snapshot());
          const res = await this.runner.scanChar(char, (stage) => {
            acct.stage = stage;
            this.emit("scan_update", this.snapshot());
          });
          if (res.result === "done") acct.charsDone += 1;
          else {
            acct.charsFailed += 1;
            acct.error = acct.error ?? `${char}: ${res.error ?? res.result}`;
          }
          acct.current = null;
          acct.stage = null;
        }
        acct.status = acct.charsFailed === 0 ? "done" : acct.charsDone === 0 ? "failed" : "partial";
```

with:

```ts
        for (const char of acct.chars) {
          acct.current = char;
          acct.stage = "starting";
          this.emit("scan_update", this.snapshot());
          const res = await this.runner.scanChar(char, (stage) => {
            acct.stage = stage;
            this.emit("scan_update", this.snapshot());
          });
          if (res.result === "done") acct.charsDone += 1;
          else {
            acct.charsFailed += 1;
            acct.error = acct.error ?? `${char}: ${res.error ?? res.result}`;
            acct.failures.push({ char, result: res.result, error: res.error });
          }
          acct.current = null;
          acct.stage = null;
        }
        if (acct.failures.length > 0) {
          acct.failures = await this.classify(acct.account, acct.failures);
        }
        acct.status = acct.charsFailed === 0 ? "done" : acct.charsDone === 0 ? "failed" : "partial";
```

(g) Add the `classify` helper (place it just above `persistAccount`):

```ts
  private async classify(account: string, failures: CharFailure[]): Promise<CharFailureClassified[]> {
    try {
      return await this.classifier.refreshAndClassify(account, failures);
    } catch (err) {
      return failures.map((f) => ({
        ...f,
        code: "transient",
        reason: `classify failed: ${(err as Error).message}`,
      }));
    }
  }
```

(h) Extend `persistAccount` to write `scan_chars` rows. After the existing `this.db.prepare(...).run(...)` for `scan_accounts`, add:

```ts
    const insChar = this.db.prepare(
      `INSERT INTO scan_chars (job_id, account_name, char_name, result, code, reason, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const f of acct.failures) {
      insChar.run(jobId, acct.account, f.char, f.result, f.code, f.reason, f.error ?? null);
    }
```

(i) Extend `history()` to include per-char failures. Replace the `acctStmt` block and the return map. In `history()`, after the `acctStmt` declaration add:

```ts
    const charsStmt = this.db.prepare(
      "SELECT char_name, result, code, reason FROM scan_chars WHERE job_id = ? AND account_name = ? ORDER BY char_name",
    );
```

and replace the return with:

```ts
    return {
      jobs: jobs.map((j) => ({
        ...j,
        accounts: (acctStmt.all(j.id) as {
          account_name: string;
          status: string;
          chars_total: number;
          chars_done: number;
          chars_failed: number;
          error: string | null;
        }[]).map((a) => ({
          ...a,
          chars: charsStmt.all(j.id, a.account_name) as {
            char_name: string;
            result: string;
            code: string;
            reason: string | null;
          }[],
        })),
      })),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/modules/scans/store.test.ts`
Expected: PASS (all ScansStore tests, including the 3 new ones and the pre-existing ones which now use the default no-op classifier).

- [ ] **Step 5: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add backend/src/modules/scans/store.ts backend/tests/modules/scans/store.test.ts
git commit -m "feat(scans): classify and persist per-char scan failures"
```

---

### Task 2: AccountsStore — `refresh` extraction + `refreshAndClassify` classifier

**Files:**
- Modify: `backend/src/modules/accounts/store.ts`
- Test: `backend/tests/modules/accounts/store.test.ts`

**Interfaces:**
- Consumes (from Task 1): `CharFailure`, `CharFailureClassified` (type-only import from `../scans/store.js`).
- Produces: `AccountsStore.refresh(name, yamlChars?)` and `AccountsStore.refreshAndClassify(account, failed)` (structurally satisfies `CharFailureClassifier`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/modules/accounts/store.test.ts` (inside the existing `describe("AccountsStore", ...)` block, using the existing `makeStore`, `sgeOk`, `sgeError`, `failingRuby` helpers):

```ts
  describe("refreshAndClassify", () => {
    it("classifies start_failed without consulting SGE", async () => {
      const { store } = makeStore(); // default sge errors, but result === "failed" short-circuits
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "failed", error: "unit not found" },
      ]);
      expect(res).toEqual([
        {
          char: "Fisternar",
          result: "failed",
          error: "unit not found",
          code: "start_failed",
          reason: "systemd start failed: unit not found",
        },
      ]);
    });

    it("classifies auth_bad_password from a fresh SGE re-check", async () => {
      const { store } = makeStore({ sge: sgeError(new Error("invalid_password")) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "auth_bad_password", reason: "account auth: bad_password" });
    });

    it("classifies auth_decrypt_error when the password can't be decrypted", async () => {
      const { store } = makeStore({ ruby: failingRuby() });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "auth_decrypt_error" });
    });

    it("classifies sge_unreachable for a transport error, not an auth failure", async () => {
      const { store } = makeStore({ sge: sgeError(new Error("SGE timeout")) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "sge_unreachable" });
    });

    it("classifies char_disabled when the char is absent from SGE's active list", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Fisternar", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "char_disabled" });
    });

    it("classifies no_write when the char is active but produced no invdb write", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Zepherus", result: "timeout", error: "no invdb write" },
      ]);
      expect(res[0]).toMatchObject({ code: "no_write" });
    });

    it("classifies transient when auth ok + char active but never came online", async () => {
      const { store } = makeStore({ sge: sgeOk([{ slot: "1", name: "Zepherus" }]) });
      const res = await store.refreshAndClassify("BUCKWHEET", [
        { char: "Zepherus", result: "timeout", error: "not online" },
      ]);
      expect(res[0]).toMatchObject({ code: "transient" });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: FAIL — `refreshAndClassify` is not a function on `AccountsStore`.

- [ ] **Step 3: Implement the AccountsStore changes**

Edit `backend/src/modules/accounts/store.ts`.

(a) Add the type-only import + transport regex after the existing imports (line 6 area):

```ts
import type { CharFailure, CharFailureClassified } from "../scans/store.js";

/** SGE errors that mean "couldn't reach/verify SGE" rather than a definitive auth rejection. */
const SGE_TRANSPORT_RE = /timeout|certificate|ECONN|ENOTFOUND|ETIMEDOUT|EAI_|getaddrinfo/i;
```

(b) Replace the entire current `scanOne` method (from `/** Scan a single account. */` through its closing brace, lines ~120-199) with the `scanOne` + `refresh` + `refreshAndClassify` + `classifyFailure` methods:

```ts
  /** Scan a single account. */
  async scanOne(
    name: string,
    yamlChars?: { char_name: string; game_code: string }[],
  ): Promise<{ ok: boolean; error?: string }> {
    const r = await this.refresh(name, yamlChars);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  /**
   * Re-run the SGE auth + character-list check for one account and persist the
   * result (the original scanOne body). Used by scanOne and the failure
   * classifier. Returns the persisted auth state on success.
   */
  async refresh(
    name: string,
    yamlChars?: { char_name: string; game_code: string }[],
  ): Promise<{ ok: boolean; error?: string; authStatus: string; authError: string | null }> {
    const accountName = name.toUpperCase();
    const chars =
      yamlChars ??
      this.safeYamlChars()
        .filter((c) => c.account === accountName)
        .map((c) => ({ char_name: c.char_name, game_code: c.game_code }));
    if (!chars.length) {
      return { ok: false, error: "account not found in entry.yaml", authStatus: "unknown", authError: null };
    }

    const gameCode = chars[0].game_code || "GS3";
    let authStatus = "unknown";
    let authError: string | null = null;
    const characters: ScanCharacterRow[] = [];

    const decrypted = await this.ruby.decryptPassword(accountName, this.yaml.path);
    if (!decrypted.ok) {
      authStatus = "decrypt_error";
      authError = decrypted.error;
      this.saveScan(accountName, authStatus, authError, this.yamlOnlyChars(accountName, chars));
      return { ok: true, authStatus, authError };
    }

    try {
      const sgeChars = await this.sge.listCharacters(accountName, decrypted.plain, gameCode);
      authStatus = "ok";
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
      for (const sc of sgeChars) {
        characters.push({
          account_name: accountName,
          char_name: sc.name,
          slot: sc.slot,
          game_code: yamlMap.get(sc.name.toLowerCase())?.game_code ?? gameCode,
          source: "sge",
          status: "active",
          auto_added: autoAdded.has(sc.name.toLowerCase()) ? 1 : 0,
        });
      }
      const sgeNames = new Set(sgeChars.map((c) => c.name.toLowerCase()));
      for (const c of chars) {
        if (!sgeNames.has(c.char_name.toLowerCase())) {
          characters.push({
            account_name: accountName,
            char_name: c.char_name,
            slot: null,
            game_code: c.game_code,
            source: "entry_yaml",
            status: "entry_only",
            auto_added: 0,
          });
        }
      }
    } catch (err) {
      authStatus = (err as Error).message === "invalid_password" ? "bad_password" : "error";
      authError = (err as Error).message;
      this.saveScan(accountName, authStatus, authError, this.yamlOnlyChars(accountName, chars));
      return { ok: true, authStatus, authError };
    }

    this.saveScan(accountName, authStatus, authError, characters);
    return { ok: true, authStatus, authError };
  }

  /** Classify failed scan chars by cross-referencing a fresh SGE re-check. */
  async refreshAndClassify(account: string, failed: CharFailure[]): Promise<CharFailureClassified[]> {
    const r = await this.refresh(account);
    return failed.map((f) => this.classifyFailure(account, f, r.authStatus, r.authError));
  }

  private classifyFailure(
    account: string,
    f: CharFailure,
    authStatus: string,
    authError: string | null,
  ): CharFailureClassified {
    if (f.result === "failed") {
      return { ...f, code: "start_failed", reason: `systemd start failed: ${f.error ?? "unknown"}` };
    }
    if (authStatus === "bad_password") {
      return { ...f, code: "auth_bad_password", reason: "account auth: bad_password" };
    }
    if (authStatus === "decrypt_error") {
      return { ...f, code: "auth_decrypt_error", reason: `account password decrypt failed: ${authError ?? ""}` };
    }
    if (authStatus === "error") {
      if (SGE_TRANSPORT_RE.test(authError ?? "")) {
        return { ...f, code: "sge_unreachable", reason: "SGE unreachable during re-check (retry later)" };
      }
      return { ...f, code: "auth_error", reason: `account auth: ${authError ?? "error"}` };
    }
    const row = this.db
      .prepare("SELECT status FROM account_characters WHERE account_name = ? AND LOWER(char_name) = LOWER(?)")
      .get(account.toUpperCase(), f.char) as { status?: string } | undefined;
    if (row?.status !== "active") {
      return { ...f, code: "char_disabled", reason: "character not active on SGE (disabled/inactive/deleted)" };
    }
    if (f.result === "timeout" && f.error === "no invdb write") {
      return { ...f, code: "no_write", reason: "character online but inv.db3 not written (script/mechanical flake)" };
    }
    return { ...f, code: "transient", reason: "character active + auth ok but never came online (timing flake)" };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/modules/accounts/store.test.ts`
Expected: PASS — all pre-existing `scanOne` tests (the refactor preserves behavior) + the 7 new `refreshAndClassify` tests.

- [ ] **Step 5: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add backend/src/modules/accounts/store.ts backend/tests/modules/accounts/store.test.ts
git commit -m "feat(accounts): add SGE char-failure classifier (refreshAndClassify)"
```

---

### Task 3: Scans module routes — expose per-char failures in the response schemas

**Files:**
- Modify: `backend/src/modules/scans/index.ts`
- Test: `backend/tests/modules/scans/routes.test.ts`

**Interfaces:**
- Consumes: `ScansStore.history()` (now returns `chars`), `ScansStore.currentJob()` (now returns `failures`).
- Produces: `GET /scan/status` account schema gains `failures`; `GET /scan/history` account schema gains `chars`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/modules/scans/routes.test.ts`. Add a type import at the top (after the existing `ScansStore` import):

```ts
import type { CharFailureClassifier } from "../../../src/modules/scans/store.js";
```

Add this test inside `describe("scans module routes", ...)`:

```ts
  it("GET /scan/history includes per-char failure detail after a failing scan", async () => {
    const db = new CoreDb(":memory:");
    const yamlPath = join(dir, "entry-fail.yaml");
    writeFileSync(
      yamlPath,
      "accounts:\n  Buckwheet:\n    characters:\n      - char_name: Fisternar\n        game_code: GSIV\n",
    );
    const yaml = new EntryYaml(yamlPath);
    const runner = {
      async scanChar(char: string) {
        return { char, result: "failed" as const, error: "boom" };
      },
    };
    const classifier: CharFailureClassifier = {
      async refreshAndClassify(_account, failed) {
        return failed.map((f) => ({ ...f, code: "start_failed", reason: "systemd start failed: boom" }));
      },
    };
    const store = new ScansStore(db, yaml, runner, () => {}, () => {}, {
      okAccounts: () => ["BUCKWHEET"],
      classifier,
    });
    const registry = new Registry();
    registry.register(healthModule);
    registry.register(createScansModule(store, { exec: () => "" }));
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("limited:tok:scans.read,scans.write");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: new EventBus() });

    const start = await app.request("/api/modules/scans/scan", { method: "POST", headers: H, body: "{}" });
    expect(start.status).toBe(200);
    await store.whenIdle();

    const res = await app.request("/api/modules/scans/scan/history", { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobs: { accounts: { account_name: string; chars: { char_name: string; result: string; code: string; reason: string | null }[] }[] }[];
    };
    const acct = body.jobs[0].accounts.find((a) => a.account_name === "BUCKWHEET");
    expect(acct?.chars).toEqual([
      { char_name: "Fisternar", result: "failed", code: "start_failed", reason: "systemd start failed: boom" },
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/modules/scans/routes.test.ts`
Expected: FAIL — the `chars` field is absent from the history response (schema hasn't been updated; the store's `history()` already returns it, but the zod `historyRoute` schema strips/omits it — assert against actual behavior).

- [ ] **Step 3: Update the zod schemas**

Edit `backend/src/modules/scans/index.ts`.

(a) Add a char-failure schema after the `jobSchema` declaration:

```ts
const charFailureSchema = z.object({
  char: z.string(),
  result: z.string(),
  code: z.string(),
  reason: z.string(),
  error: z.string().nullable().optional(),
});
```

(b) Add `failures` to `accountSchema`:

```ts
const accountSchema = z.object({
  account: z.string(),
  chars: z.array(z.string()),
  status: z.string(),
  charsDone: z.number(),
  charsFailed: z.number(),
  current: z.string().nullable(),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  failures: z.array(charFailureSchema),
});
```

(c) In `historyRoute`'s response schema, add `chars` to the inner `accounts` object (inside the `z.array(z.object({ ... }))` for accounts):

```ts
                accounts: z.array(
                  z.object({
                    account_name: z.string(),
                    status: z.string(),
                    chars_total: z.number(),
                    chars_done: z.number(),
                    chars_failed: z.number(),
                    error: z.string().nullable(),
                    chars: z.array(
                      z.object({
                        char_name: z.string(),
                        result: z.string(),
                        code: z.string(),
                        reason: z.string().nullable(),
                      }),
                    ),
                  }),
                ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/modules/scans/routes.test.ts`
Expected: PASS — including the new integration test (history returns per-char `chars`).

- [ ] **Step 5: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add backend/src/modules/scans/index.ts backend/tests/modules/scans/routes.test.ts
git commit -m "feat(scans): expose per-char scan failures in routes"
```

---

### Task 4: Wire the real classifier into the server

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `accountsStore` (already constructed) → passed as `classifier` to `ScansStore`.
- Produces: production `ScansStore` uses `AccountsStore.refreshAndClassify` on failures.

- [ ] **Step 1: Edit the ScansStore construction**

In `backend/src/index.ts`, in the `new ScansStore(...)` call's options object, add the classifier (after the `skipAccounts` line):

```ts
  {
    skipAccounts: (process.env.SCAN_SKIP_ACCOUNTS ?? "UNFOCUSEDPIE")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    classifier: accountsStore,
  },
```

- [ ] **Step 2: Typecheck + full backend suite**

Run: `cd backend && npm test && npm run typecheck && npm run lint`
Expected: PASS (334 existing tests + new tests; typecheck confirms `AccountsStore` structurally satisfies `CharFailureClassifier`).

- [ ] **Step 3: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add backend/src/index.ts
git commit -m "chore(server): wire accounts classifier into scans store"
```

---

### Task 5: Frontend — render per-char failure reasons on /scans

**Files:**
- Modify: `frontend/src/pages/scans/index.tsx`

**Interfaces:**
- Consumes: `GET /scan/status` account `failures[]` and `GET /scan/history` account `chars[]`.
- Produces: live failure lines + expandable history failure list, color-coded.

- [ ] **Step 1: Update the response interfaces**

In `frontend/src/pages/scans/index.tsx`, add a `CharFailure` type and extend the two interfaces:

```ts
interface CharFailure {
  char: string;
  result: string;
  code: string;
  reason: string;
  error?: string | null;
}
interface ScanAccountState {
  account: string;
  chars: string[];
  status: string;
  charsDone: number;
  charsFailed: number;
  current: string | null;
  stage: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  failures: CharFailure[];
}
```

and `HistoryAccount` gains `chars`:

```ts
interface HistoryAccount {
  account_name: string;
  status: string;
  chars_total: number;
  chars_done: number;
  chars_failed: number;
  error: string | null;
  chars: { char_name: string; result: string; code: string; reason: string | null }[];
}
```

Add a tone map near `STAGE_LABEL`:

```ts
const FAILURE_TONE: Record<string, string> = {
  auth_bad_password: "var(--warn)",
  auth_error: "var(--warn)",
  auth_decrypt_error: "var(--warn)",
  sge_unreachable: "var(--warn)",
  char_disabled: "var(--bad)",
  no_write: "var(--text-muted)",
  transient: "var(--text-muted)",
  start_failed: "var(--text-muted)",
};
```

- [ ] **Step 2: Render live failure lines**

In the live job card, right after the existing `{a.error && (<div ...>{a.error}</div>)}` line, add:

```tsx
                {a.failures && a.failures.length > 0 && (
                  <div style={{ marginTop: "var(--space-1)" }}>
                    {a.failures.map((f) => (
                      <div key={f.char} style={{ fontSize: "var(--font-size-sm)", color: FAILURE_TONE[f.code] ?? "var(--bad)" }}>
                        ✗ {f.char} — <strong>{f.code}</strong> {f.reason}
                      </div>
                    ))}
                  </div>
                )}
```

- [ ] **Step 3: Render history failure detail**

In the History card, replace the current single-line per-job render (the `<div key={h.id} ...>` block) with a version that adds an expandable failure list. Replace:

```tsx
          history.slice(0, 10).map((h) => (
            <div key={h.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}>
              <strong>#{h.id}</strong> {h.status} · {h.accounts_done} ok / {h.accounts_failed} failed ·{" "}
              {new Date(h.started_at).toISOString().slice(0, 16)}Z
              {h.accounts_failed > 0 && canWrite && (
                <Button size="sm" variant="ghost" style={{ marginLeft: "var(--space-2)" }} onClick={() => void retry(h.id)} ariaLabel={`Retry job ${h.id}`}>
                  retry
                </Button>
              )}
            </div>
          ))
```

with:

```tsx
          history.slice(0, 10).map((h) => (
            <div key={h.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}>
              <strong>#{h.id}</strong> {h.status} · {h.accounts_done} ok / {h.accounts_failed} failed ·{" "}
              {new Date(h.started_at).toISOString().slice(0, 16)}Z
              {h.accounts_failed > 0 && canWrite && (
                <Button size="sm" variant="ghost" style={{ marginLeft: "var(--space-2)" }} onClick={() => void retry(h.id)} ariaLabel={`Retry job ${h.id}`}>
                  retry
                </Button>
              )}
              {h.accounts.some((a) => a.chars && a.chars.length > 0) && (
                <details style={{ marginTop: "var(--space-1)" }}>
                  <summary style={{ cursor: "pointer" }}>failed characters</summary>
                  {h.accounts
                    .filter((a) => a.chars && a.chars.length > 0)
                    .map((a) => (
                      <div key={a.account_name} style={{ margin: "var(--space-1) 0" }}>
                        <strong>{a.account_name}</strong>
                        {a.chars.map((c) => (
                          <div key={c.char_name} style={{ marginLeft: "var(--space-2)", color: FAILURE_TONE[c.code] ?? "var(--bad)" }}>
                            ✗ {c.char_name} — <strong>{c.code}</strong> {c.reason ?? ""}
                          </div>
                        ))}
                      </div>
                    ))}
                </details>
              )}
            </div>
          ))
```

- [ ] **Step 4: Build the frontend**

Run: `cd frontend && npm run build`
Expected: PASS (TypeScript compiles; no unused-var/lint errors).

- [ ] **Step 5: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add frontend/src/pages/scans/index.tsx
git commit -m "feat(scans): render per-char scan failure reasons"
```

---

### Task 6: Full gate + docs

**Files:**
- Modify: `docs/STATUS.md`

**Interfaces:** none (docs + verification).

- [ ] **Step 1: Run the full gate**

```bash
cd "/d/Code Projects/GSIVPlatform/backend" && npm test && npm run typecheck && npm run lint
cd "/d/Code Projects/GSIVPlatform/frontend" && npm run build
```
Expected: all green.

- [ ] **Step 2: Append a session-log entry to `docs/STATUS.md` §7**

Add a new bullet under the existing "Done since this handoff" section summarizing: char-failure disambiguation live (classifier reuses scanOne, `refreshAndClassify`, 8 codes incl. `sge_unreachable`, `scan_chars` table, per-char failures on /scans + /accounts write-back, N tests green).

- [ ] **Step 3: Commit**

```bash
cd "/d/Code Projects/GSIVPlatform"
git add docs/STATUS.md
git commit -m "docs: char-failure disambiguation (STATUS §7)"
```

---

## Deploy & live smoke (after merge, Fisternar/Neleourg only)

1. Merge the branch (`gh pr merge`).
2. Deploy backend `dist` + frontend contents into `/opt/gsiv-platform/frontend` (Caddy root); verify the public bundle is `text/javascript`.
3. Live smoke (Fisternar/Neleourg only; Amn off-limits): stop a known-active char's `gs4sd-lich@<Char>` unit, run a single-account scan, confirm the failure is classified `transient`; confirm a stale/entry_only char classifies `char_disabled`; confirm /accounts reflects the write-back.
