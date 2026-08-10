# Navigation Information Architecture

## 1. Model

Navigation is **data-driven**: a `NavItem[]` assembled from core shell items +
module manifest entries (`routing.md` §2). The shell never hardcodes a module
name; ordering, grouping, and visibility all come from data.

```
navItems = [
  ...coreItems,                       // Dashboard, Game View
  ...manifest.moduleNavItems,         // one per module with nav metadata
].sort(byGroupOrder, then by item.order)
```

## 2. Groups & ordering

| Group | Nav title | Items (order) | Rationale |
|---|---|---|---|
| `overview` | Overview | Dashboard (10), Game View (20) | landing + live viewing |
| `operations` | Operations | Inventory (10), Gems (20), Jars (30), Bounty (40), Queue (50), Healer (60) | the daily loop: what you own → what's being made → what's pending → who needs help |
| `market` | Market | Pricing (10) | sales-tracker domain |
| `people` | People | Characters (10), Accounts (20) | game entities vs. login identities |
| `platform` | Platform | Entry (10), Config (20), Analysis (30) | admin + insight, lowest traffic, at the bottom |

Group ordering follows traffic: overview → operations → market → people →
platform. Items within a group follow the porting order from the parent
design (§8) as a tiebreak so the list is stable as modules land.

## 3. Item spec

| # | Item | Icon | Group | Order | Path | Scope gate |
|---|---|---|---|---|---|---|
| 1 | Dashboard | ◎ | overview | 10 | `/` | any read |
| 2 | Game View | 📺 | overview | 20 | `/watch` | characters.read |
| 3 | Inventory | 🎒 | operations | 10 | `/inventory` | inventory.read |
| 4 | Gems | 💎 | operations | 20 | `/gems` | gems.read |
| 5 | Jars | 🫙 | operations | 30 | `/jars` | jars.read |
| 6 | Bounty | 🎯 | operations | 40 | `/bounty` | bounty.read |
| 7 | Queue | ⏳ | operations | 50 | `/queue` | queue.read |
| 8 | Healer | ⛑️ | operations | 60 | `/healer` | healer.read |
| 9 | Pricing | 🏷️ | market | 10 | `/pricing` | pricing.read |
| 10 | Characters | 🧝 | people | 10 | `/characters` | characters.read |
| 11 | Accounts | 👥 | people | 20 | `/accounts` | accounts.read |
| 12 | Entry | 🔑 | platform | 10 | `/entry` | entry.read |
| 13 | Config | ⚙️ | platform | 20 | `/config` | config.read |
| 14 | Analysis | 📊 | platform | 30 | `/analysis` | analysis.read |

Icons are emoji for zero-dependency parity with v1's tone; the `icon` field in
the manifest stores either an emoji or an SVG token, decided by the icon set
adopted in brief 02. Game View is rendered with a distinguishing "external"
chevron (↗) because it leaves the app.

## 4. Labels

- Sentence case ("Game View", not "GAME VIEW").
- Module registry `title` is the single source for the label; the shell never
  renames a module.
- Labels ≤ 2 words; long module titles get a `shortLabel` in the manifest used
  by collapsed rails and mobile.

## 5. Active state

- Exact match: `aria-current="page"` + filled/colored pill.
- Prefix match (e.g. `/characters/:charId`): parent item stays active
  (`aria-current` set, detail page shows a back affordance).
- Nav is keyboard-operable: arrow keys move between items within a group,
  `Tab` moves groups, `Home`/`End` jump to first/last.

```
  Active (filled)        Inactive (ghost)
  ┌────────────────┐     ┌────────────────┐
  │◤ 🎒 Inventory   │     │  ⏳ Queue       │
  └────────────────┘     └────────────────┘
```

## 6. Scope visibility

- Item hidden entirely if the token lacks its scope (`can(...)`), or shown
  disabled with a lock when hiding would be surprising (admin-only items in
  the Platform group). Default: **hide**, configurable per item via the
  manifest (`hiddenWhenDenied`).
- A token with `admin` (`*`) sees everything.
- If the token holds no scope for a group, the group header is hidden too —
  the nav never renders empty groups.

## 7. Behavior rules

- **New module in registry → new item automatically.** No shell code change.
- **Collapsed rail (desktop):** icons only, tooltip = title.
- **Mobile drawer:** full-width items, touch target ≥ 44 px, groups collapsed
  by default (first group expanded).
- **Badges:** opt-in per module (`badge: (state) => number | null`), e.g.
  Queue shows pending count; badges render right-aligned, only when ≥ 1, and
  are driven by WS events so they update live.
- **Reordering** is a registry/manifest decision, not a per-user drag feature
  in v2.0 (note in open questions).
