# Page Patterns

Six reusable page patterns. Each section defines: **when to use**, **anatomy**, **data-fetch/WS strategy**, **actions placement**, **states**, and **mobile behavior**. Patterns compose — a page can be a primary pattern with sections that use another pattern (documented per module in `page-map.md`).

> Conventions referenced throughout: endpoints are `GET/POST /api/modules/<module>/<resource>`, scopes are `<module>.<verb>`, and the WS event bus carries `state.*`, `stream.*`, and `module.*` messages (see `ws-data-pattern.md`).

---

## Cross-cutting states (every pattern)

Every page and every data region implements these in the same visual language (primitives from brief 02):

| State | What renders | Where it lives |
|---|---|---|
| **Loading** | `Skeleton` matching the real layout (table rows, card outlines, chart blocks) — never a bare spinner | Per region, on first fetch |
| **Empty** | Icon + one-line reason + one natural next action ("No jars pending", "Run your first analysis", "Reset filters") | Per region |
| **Error + retry** | Inline `Alert` with the failure reason + `Retry` button that refetches the region; keep last-known data visible if available | Per region |
| **Stale** | StatusDot (`--warn`) + "last update Xs ago" near the data; fed by the WS hook's heartbeat (`ws-data-pattern.md`) | WS-fed regions only |
| **Auth/401** | Shell intercepts 401 → redirect to login with `?returnTo=`; page may show a brief inline "session expired, redirecting…" | Shell + page fallback |

Read-only pages additionally render **no write affordances** (rule in `scope-driven-ui.md`).

---

## Pattern 1 — List/Search

**When to use.** The page's primary job is finding things in a collection: inventory items/characters/locations, pricing sales and listings, accounts, characters. Works for any module whose content is "rows I filter and maybe act on."

**Anatomy.**

```
┌ Toolbar ──────────────────────────────────────────────┐
│ [Search…]  [Type ▾] [Status ▾] [Sort ▾]  [⛶ density] │  (n results)
├ List region ──────────────────────────────────────────┤
│  header row (sortable columns)                        │
│  row  | name | status | key metric | updated | actions│
│  row  | …    | …     | …          | …       | [⚙]    │
│  …                                                       │
├ Footer ───────────────────────────────────────────────┤
│  « 1 2 3 … »   page size ▾   (results: 1–50 of 1,204)  │
└───────────────────────────────────────────────────────┘
```

- **Toolbar:** search input (debounced 300 ms), filter selects, sort select, density toggle. Result count always visible in or under the toolbar.
- **List:** `Table` at compact density on desktop; card grid at comfortable density / narrow widths.
- **Pagination:** server-side when the collection is large (inventory, pricing sales); client-side for small sets (characters, healer registry).
- **Row click** opens the entity in the Detail pattern (full page or modal) when the entity has more to show.

**Data-fetch / WS strategy.**

- **Server-side querying** for large collections: `GET /api/modules/<m>/<resource>?q=&filter=&sort=&page=&pageSize=` — search/filter/sort/pagination all server-side; the typed client (from the OpenAPI spec) drives this.
- **Client-side filtering** for small, cheap collections (≤ a few hundred rows): fetch once, filter in memory.
- **WS:** optional, only when row data changes live (e.g. characters' systemd status). Subscribe to `state.<module>.<resource>` and patch the affected rows in place — never refetch the whole list for one row change.
- Keep search text in the URL query param so it survives reload/share.

**Actions placement.**

- **Primary action** per row: trailing column, right-aligned, explicit `Button` (e.g. "Restart").
- **Secondary actions:** kebab menu `⚙` in the same trailing column (e.g. "View details", "Watch").
- **Bulk actions** (e.g. "Restart selected", "Clear queue"): appear in the toolbar only when ≥1 row is selected (checkbox column appears only when the page's scopes allow the write).
- **Create action** (e.g. Analysis "Run", Accounts "Scan"): primary `Button` in the toolbar, right side.
- On narrow screens, per-row actions collapse into the card's action row (see Mobile).

**States.**

- **Loading:** skeleton header + 6–10 skeleton rows (or cards).
- **Empty:** "No <items> match your filters" with a "Clear filters" action; separate copy for "no data at all" with the module's first-run action.
- **Error:** alert + retry refetching the current query; keep last-known rows visible with a stale tint if available.
- **Stale:** only if WS-fed (e.g. character status) — warn dot + "Xs ago".

**Mobile behavior.**

- Toolbar wraps: search full-width on top, filters behind a "Filters" sheet (bottom-sheet, brief 02), result count below.
- Table becomes **cards**: show 2–3 key columns + status dot; details in the card body.
- Pagination → "Load more" button at list end.
- Tap targets ≥44 px; row actions as explicit buttons in the card, not hover-revealed.

**Variants.** Tabbed List/Search (Pricing: Sales / Listings / My shop; Inventory: Items / Characters / Locations). Each tab is a full List/Search region sharing the toolbar pattern.

---

## Pattern 2 — Detail

**When to use.** A single entity deserves a dedicated view: one jar, one account, one analysis run, one bounty. Entry point is usually a List/Search row click or a WS "activity" link.

**Anatomy.**

```
┌ Back link: ← Gems/Jars                          [action bar] ─┐
├ Summary header ──────────────────────────────────────────────┤
│  Title + status dot   key stat   key stat   key stat         │
│  one-line description / meta (id, updated)                   │
├ Sections (Tabs) ─────────────────────────────────────────────┤
│  [Overview] [History] [Notes]                                │
│  …section content…                                           │
├ Footer / meta ───────────────────────────────────────────────┤
│  created, source, last WS update                             │
└──────────────────────────────────────────────────────────────┘
```

**Data-fetch / WS strategy.**

- `GET /api/modules/<m>/<resource>/:id` for the full entity.
- **WS:** subscribe to `state.<module>.<resource>` (filtered to this id) so a live entity updates in place — jar fullness, bounty progress, analysis run status.
- Related sections lazy-load on tab activation.

**Actions placement.**

- **Action bar:** top-right, sticky under the shell header; primary action as filled `Button` (e.g. "Claim"), secondary as outline, destructive ("Remove bounty") as the last, separated item that opens a `Confirm` modal.
- No actions inline in section bodies unless they are section-scoped (e.g. "Download log" in an Analysis run's log section).

**States.**

- **Loading:** skeleton of the summary header + section blocks.
- **Empty/404:** "No <entity> with id X" + back link; treat as error-with-retry only if a network failure caused it.
- **Error:** alert + retry refetching the entity; keep stale copy visible with warn tint if previously loaded.
- **Stale:** WS-fed entities show "live, Xs ago" indicator; pauses (reconnecting) show the WS hook's status.

**Mobile behavior.**

- Header compresses: title + status dot + primary action; secondary actions behind an overflow menu.
- Sections become an accordion stack (no tabs).
- Action bar becomes a **sticky bottom bar** with the primary action full-width.

---

## Pattern 3 — Live status board

**When to use.** The page is a real-time operation surface: statuses change under the user and actions have urgency. Gems/Jars (jar pipeline), Bounty (active bounty), Healer (pending requests). **Requires WS.**

**Anatomy.**

```
┌ Board strip ────────────────────────────────────────────────┐
│ ● connected · last update 2s ago    [Filter: pending only ▾] │
├ Card grid ──────────────────────────────────────────────────┤
│  ┌ Card ──────────────────────┐   ┌ Card ─────────────────┐ │
│  │ Char name · StatusDot       │   │ …                     │ │
│  │ ▓▓▓▓▓▓░░░ 60% fullness      │   │                       │ │
│  │ updated 2s ago              │   │ [Accept] [Complete]   │ │
│  │ [Claim] [Clear]             │   └──────────────────────┘ │
│  └─────────────────────────────┘   …                        │
└─────────────────────────────────────────────────────────────┘
```

- **Card:** identity + StatusDot, primary metric as a `Bar` (fullness, HP/Spirit), key facts, `updated` timestamp, action row.
- Cards **animate in/out** on add/remove; existing cards **patch in place** on update (no re-layout flash — CSS transitions, brief 02 motion).
- Optional secondary region: **queue** (Gems/Jars) or **registry** (Healer) as a compact List/Search strip below/beside the board.

**Data-fetch / WS strategy.**

- Initial snapshot: `GET /api/modules/<m>/<resource>` (or the `state.*` snapshot via the WS hook).
- Live: subscribe to `state.<module>.<resource>`; the hook applies deltas (`ws-data-pattern.md`).
- **No polling.** If WS is down, the board shows last-known data + the hook's reconnect/offline state — it never falls back to a timer.

**Actions placement.**

- **Per-card action row:** always visible (urgency), bottom of the card. Primary first ("Claim", "Accept"), destructive last with `Confirm` modal ("Clear", "Remove").
- While an action is in flight: button shows `pending` state; the card is visually locked until the WS event confirms the new state (server-authoritative, no local optimism).
- Queue/registry rows use Pattern 1 action rules.

**States.**

- **Loading:** skeleton cards (3–6) matching card shape.
- **Empty:** "No <pending jars/requests> right now" + subtle "waiting for updates…" pulse.
- **Error:** alert + retry (refetch snapshot). Keep last-known board rendered with warn tint.
- **Stale/offline:** board strip shows `reconnecting`/`offline` (warn/bad dot + "last update Ns ago"); cards stay visible. This is the *most important* state for ops surfaces — it must be impossible to miss.

**Mobile behavior.**

- Single-column card stack; action row stays visible with ≥44 px targets.
- `Confirm` modals render as bottom sheets.
- Pull-to-refresh is accepted as a manual fallback (refetch snapshot) but is *not* the data path.

---

## Pattern 4 — Dashboard/Overview (landing)

**When to use.** The app's landing page, and any module-level "overview" tab that aggregates other pages. Primary consumer of cross-module data; its job is **navigation + at-a-glance health**, not operations.

**Anatomy.**

```
┌ Header: welcome + date + game server status ───────────────┐
├ Alert banner (0) ──────────────────────────────────────────┤  (dismissible, stacked)
├ Tile row ──────────────────────────────────────────────────┤
│ [📦 Inventory] [💰 Pricing] [⚗ Gems/Jars] [🎯 Bounty] …    │  → each links to module
├ Live character strip ─────────────────────────────────────┤
│  ●Aelotoi  ●Necromancer  ●Sorcerer   (per-character dot)  │  → click = character detail
├ Two-column: recent activity | alerts ──────────────────────┤
└────────────────────────────────────────────────────────────┘
```

**Data-fetch / WS strategy.**

- Aggregated data: module summary endpoints (`GET /api/modules/<m>/summary`) or a core `/api/overview` that fans out — decide in implementation; keep the page's fetch count ≤ 4–5 parallel requests.
- **WS:** subscribe to `state.characters.status` (character strip) and alert topics; everything else can be snapshot + periodic refresh.
- Tiles show live-ish counts from summaries, refreshed on focus/visibility change.

**Actions placement.**

- **None.** Tiles and rows are navigation (links). The only "action" is dismissing an alert or "View all →" links into the module.
- This is deliberate: the landing never mutates; write affordances live in the module pages.

**States.**

- **Loading:** skeleton tiles + skeleton strip.
- **Empty:** first-run state ("Connect your first character / import inventory…") with links to the relevant module.
- **Error:** per-region retry (a failed character strip must not blank the whole page).
- **Stale/offline:** global strip already shows connection; character strip additionally shows per-character stale dots.

**Mobile behavior.**

- Single column: tiles become full-width cards with icon + count; character strip becomes a **horizontal scroll row**; recent activity compresses to the last 3 items.

---

## Pattern 5 — Form/Edit

**When to use.** The page's job is editing structured data: Config (per-character config/go2/eherbs), Accounts entry.yaml (TOTP-gated). Also used as a modal/sheet for small create/edit actions in other patterns (Analysis "Run", Pricing "scraper settings").

**Anatomy.**

```
┌ Header: entity context (character name) + status ───────────┐
├ Form region ────────────────────────────────────────────────┤
│  Section: <group label>                                     │
│    field          field          field                      │
│    field (textarea/editor)                                  │
│  Section: …                                                 │
│  validation summary (errors, count)                         │
├ Sticky action bar ──────────────────────────────────────────┤
│  [Reset]                [Save]  ● unsaved changes           │
└─────────────────────────────────────────────────────────────┘
```

- For text-ish config (go2/eherbs): a `Textarea`/code editor with monospace font (design system font is already monospace).
- **TOTP gate (Accounts entry.yaml):** before the form renders editable, the page shows a `TOTPVerify` panel (token input + verify). Editing is unlocked for the session (configurable TTL); on expiry the form locks again with a warning. Full flow in `scope-driven-ui.md`.

**Data-fetch / WS strategy.**

- `GET /api/modules/<m>/config/:character` populates the form; `PUT /api/modules/<m>/config/:character` saves.
- **No WS.** Save is request/response with explicit success/error.
- Concurrent-edit protection: save returns `409 Conflict` if the server-side revision changed since load → offer "Reload server version" (discarding local edits) or "Force overwrite" (if scope allows).

**Actions placement.**

- **Primary `Save`** in the sticky action bar (bottom of content on desktop; fixed bottom bar on mobile). Disabled while invalid or saving ("Saving…" label).
- **Reset** discards to last-loaded state (confirm if dirty).
- Destructive actions (if any, e.g. "Delete account") live in a separated zone at the bottom, never next to Save.

**States.**

- **Loading:** skeleton fields (labels + input shapes).
- **Empty:** new-entity form (no GET needed) — e.g. "Create analysis run".
- **Validation:** inline field errors on blur + a summary banner ("3 errors"); `Save` disabled until valid. Server-side validation errors map back to fields with a toast.
- **Error:** save failure → keep edits, toast + inline alert, retry without data loss.
- **Dirty indicator:** "● unsaved changes" in the action bar; beforeunload guard on desktop.

**Mobile behavior.**

- Single column, fields stacked; sticky bottom bar with `Save` full-width.
- TOTP verify panel renders as a sheet; keep the numeric input large (44 px).

---

## Pattern 6 — History/Trends

**When to use.** Time-series or analytical content: Pricing trends & gem intelligence, Bounty stats (per task/creature/zone), Analysis run history. Combines a chart region with a table region.

**Anatomy.**

```
┌ Control bar ────────────────────────────────────────────────┐
│ [Metric ▾] [Range: 24h | 7d | 30d | custom] [Bucket ▾]      │
├ Chart region ───────────────────────────────────────────────┤
│  (canvas/SVG line or bar chart; empty-range overlay)        │
├ Table region ───────────────────────────────────────────────┤
│  period | value | delta ▴▾ | n      (rows link to Detail)   │
├ Footer ─────────────────────────────────────────────────────┤
│  generated at … · [Export CSV]                              │
└─────────────────────────────────────────────────────────────┘
```

**Data-fetch / WS strategy.**

- `GET /api/modules/<m>/trends?metric=&from=&to=&bucket=` (server aggregates; the client never aggregates time series).
- **WS:** optional, for live appends (Analysis run progress, Pricing import events). Live series append as points; historical ranges refetch on range change.
- Cache per (metric, range, bucket) so switching metrics is instant.

**Actions placement.**

- **Minimal:** "Export CSV" in the footer; table row actions ("Open run") follow Pattern 2 links.
- Analysis variant: primary "Run" / "Upload" in the control bar (opens Form/Edit sheet).

**States.**

- **Loading:** skeleton chart block + skeleton table rows.
- **Empty:** "No data in this range" overlay on the chart + hint to widen the range.
- **Error:** alert + retry refetching the range; keep the last chart with a stale tint.
- **Stale:** only when live (warn dot + "Xs ago" near the control bar).

**Mobile behavior.**

- Chart full-width with a range preset row (24h/7d/30d chips); no hover — show values on tap (tooltip pin).
- Table collapses to a compact list (period, value, delta arrow).
- Export moves into an overflow menu.

**Chart rule.** Lightweight rendering only: inline SVG for line/bar series, or a thin canvas wrapper. No `chart.js`/`recharts`-style dependency assumption. Y-axis auto-scales with sensible 0-baseline for counts; percentages clamp to 0–100.

---

## Pattern composition summary

| Pattern | Primary home | Composed into |
|---|---|---|
| 1 List/Search | Inventory, Pricing, Characters, Accounts | Bounty queue, Healer registry |
| 2 Detail | Gems/Jars (jar), Accounts (account), Analysis (run) | Pricing (listing), Bounty (active) |
| 3 Live status board | Gems/Jars, Bounty, Healer | Characters (status columns) |
| 4 Dashboard/Overview | Landing | — |
| 5 Form/Edit | Config, Accounts (entry.yaml) | Analysis (run/upload sheet) |
| 6 History/Trends | Pricing, Analysis, Bounty | — |
