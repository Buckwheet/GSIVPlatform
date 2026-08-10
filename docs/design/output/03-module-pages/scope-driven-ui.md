# Scope-Driven UI

**Principle:** a page renders exactly the affordances its token's scopes allow. The server *enforces* scopes (`requireScope` middleware, approved design §6); the UI *mirrors* them so a user never sees a control that would 403. Read-only pages never show write affordances.

---

## 1. Where scopes come from

- Every token carries a scope list; admin token gets `*` (approved design §6).
- Scope naming: `<module>.<verb>` — `inventory.read`, `gems.write`, `bounty.write`, `accounts.entry`, etc.
- The shell's auth context (`frontend/src/core/auth.tsx`, brief 01) exposes:

```ts
// reference sketch
interface Auth {
  token: string;
  scopes: Set<string> | "*";   // normalized: "*" means all
  totpVerified: boolean;       // session-level second factor (Accounts only)
}
function can(auth: Auth, scope: string): boolean {
  return auth.scopes === "*" || auth.scopes.has(scope);
}
```

- Pages read scopes from context and **re-derive affordances on every auth change** (token switch, TOTP verify). They never cache a scope decision.

---

## 2. Rendering rules

| Rule | Behavior |
|---|---|
| **Data is scope-checked at the server; the page still hides what it can't read** | A page renders even if it has *some* of the read scopes — regions whose scope is missing show a "no permission to view" placeholder instead of failing the whole page. |
| **Write affordances require the write scope** | A `gems.read`-only token sees the jar board with no Claim/Clear buttons. |
| **Hidden, not disabled** | When a scope is missing, the control is **not rendered at all** (matches brief 03: read-only pages must not show write affordances). We never show a disabled button the user can't meaningfully use. |
| **Admin `*`** | Renders everything. |
| **TOTP is a second gate, not a scope** | `accounts.entry` editing requires scope **and** a verified TOTP in this session. |

### The `ScopeGate` primitive

```tsx
// reference sketch — in frontend/src/core
function ScopeGate({ scope, children, fallback = null }) {
  const auth = useAuth();
  return can(auth, scope) ? children : fallback;
}

// usage: wrap the action cluster once, not each button
<ScopeGate scope="gems.write">
  <CardActions claim={...} clear={...} />
</ScopeGate>
```

Rule of thumb: **one ScopeGate per action cluster** (a card's action row, a toolbar's bulk bar), not per micro-button — keeps permission logic readable and matches the per-pattern action placement.

---

## 3. What each page hides (matrix)

| Page | Read scope | Write scope(s) | Hidden when write scope missing |
|---|---|---|---|
| Inventory | `inventory.read` | — | n/a (read-only page; no write affordances ever) |
| Pricing | `pricing.read` | `pricing.write` | Run scraper/import button |
| Gems/Jars | `gems.read` | `gems.write` | Claim / Clear / queue-management actions |
| Bounty | `bounty.read` | `bounty.write` | Complete / Remove actions |
| Healer | `healer.read` | `healer.write` | Accept / Complete actions |
| Characters | `characters.read` | `characters.write` | Start / Stop / Restart, bulk actions |
| Accounts | `accounts.read` | `accounts.write`, `accounts.entry` (+TOTP) | Scan button; entry.yaml edit panel |
| Config | `config.read` | `config.write` | Save / edit affordances |
| Analysis | `analysis.read` | `analysis.write` | Run / Upload buttons |

> Draft scope names above match the module contract convention (`<module>.<verb>`) and the `page-map.md` endpoint tables; final scope names are frozen by the module registry at implementation time.

---

## 4. Read-only page rule (inventory)

Inventory has **no write scope at all** — the module is read-only. Consequence:

- No action buttons, no kebab menus with write entries, no bulk bars, no "edit" affordance anywhere.
- Row hover gives *view* affordances only (details modal).
- This is the pattern's simplest case and the one brief 03 calls out explicitly: **a read-only page must not show write affordances — not even disabled ones.**

---

## 5. Partial-scope pages (the interesting case)

Example: a token with `gems.read` only.

- The board renders fully (snapshot + live deltas) because reading is allowed.
- Every card's action row is absent (ScopeGate hides the whole cluster).
- The board strip may show "view-only" subtly in the meta line — a *readable* hint, not a fake disabled control.
- `stale`/`reconnecting` indicators still work identically (they are read-side).

Example: `healer.write` but no `healer.read` (unusual but legal):

- The page shows the "no permission to view" placeholder for the registry/requests data.
- Writing is impossible without the data view, so the page is effectively a placeholder — server would also reject reads. No error spam: one clear placeholder.

---

## 6. TOTP gate (Accounts entry.yaml)

Not a scope — a second factor. Flow:

```
[Edit entry.yaml] click ──▶ ScopeGate(accounts.entry) passes (scope ok)
                            └─▶ TOTPVerify panel (token input)
                                 ├─ verify ok → unlock editor for session TTL (e.g. 5 min)
                                 └─ verify fail → inline error, locked
On TTL expiry: editor re-locks with "session expired — re-verify" warning.
```

- The **save button** and the **editor** are both inside the TOTP-locked region.
- Viewing entry.yaml (if `accounts.read` allows) stays readable without TOTP; only *editing* is gated.

---

## 7. 401 / 403 flows

- **401 (bad/expired token):** shell intercepts globally → redirect to login with `?returnTo=currentPath` (brief 01). Pages don't handle 401s.
- **403 on an action (scope revoked between render and click):** the mutation API client surfaces a typed error; the page shows a toast ("action not permitted for this token"), **and re-derives affordances** from the (now updated) auth context — the button disappears.
- The WS hook similarly handles permission-denied *topics* by treating them as offline-with-tooltip (§7 of `ws-data-pattern.md`).

---

## 8. Consistency with server enforcement

UI scopes are **cosmetic**; the registry enforces the real rule (`requireScope` on every route, fail-fast boot validation — approved design §4/§6). If UI and server disagree, the server wins, and the 403 flow above reconciles the UI. Do not rely on hiding to protect data — it only protects UX.

---

## 9. Anti-patterns

- ❌ Disabled buttons with tooltips as the *only* gating (clutters read-only pages; brief requires hidden).
- ❌ Caching `can()` results in module state (stale after token change).
- ❌ Client-side route guards as the security boundary (they are a UX nicety only).
- ❌ One giant ScopeGate around the page when only the action cluster is scope-dependent (hides readable data).
