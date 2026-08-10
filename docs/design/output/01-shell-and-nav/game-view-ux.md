# Game View (VellumFE) Deep-Link UX

## 1. Relationship

VellumFE is a **separate GPL-3.0 service** (parent design §9). The platform
never embeds or imports it; it only *links* to it. The shell's job is to make
that link obvious, per-character, and honest about availability.

Rules:

- **Link, never iframe.** No `<iframe>` embed: license isolation, separate
  auth, and CSP all argue for a new-tab link.
- **One affordance pattern, many placements.** `WatchButton` is the single
  component; it renders wherever a character is on screen.
- **Honesty first.** If the viewer is down, buttons say so instead of
  dead-linking.

## 2. Discovery: `/api/core/vellum`

A core endpoint (not a module) reports what the shell needs to render the
affordance:

```json
GET /api/core/vellum
{
  "baseUrl": "https://vellum.<host>",
  "healthy": true,
  "charBaseUrl": "https://vellum.<host>/?char={char}",
  "knownCharacters": ["Winter", "Gardenia"]
}
```

- The shell probes this at boot (after auth) and every 60 s; results live in
  `RegistryProvider` / a small `VellumProvider`.
- If the endpoint itself fails, the affordance treats the viewer as unknown —
  buttons enabled but labeled "viewer status unknown" (see §4).

## 3. Placements

| Placement | Component | Behavior |
|---|---|---|
| Nav | "Game View" item (📺) | routes to `/watch` |
| `/watch` (hub) | `WatchHubPage` | character grid → Open viewer (primary), status dots, viewer-health banner |
| Dashboard character cards | `WatchButton` (secondary) | `Open viewer · Winter ↗` |
| Characters table rows | `WatchButton` (row action) | icon button with tooltip "Watch Winter" |
| StatusStrip | Watch chip per online char | one-tap deep link while watching a game |

Deep link target: `{charBaseUrl}` with the character name URL-encoded,
opened with `target="_blank" rel="noopener noreferrer"`.

## 4. Viewer-down fallback

| Viewer state | Nav "Game View" | `/watch` hub | WatchButton |
|---|---|---|---|
| healthy | normal | grid + "Viewer online" pill | enabled |
| down (`healthy:false`) | shows "offline" dot | banner "Viewer offline — retry" + retry button; links stay but warn | disabled w/ tooltip "Viewer offline" |
| unknown (probe failed) | subtle "?" dot | banner "Viewer status unknown" | enabled, tooltip "Viewer status unknown" |

- Retry re-probes `/api/core/vellum`; a failed probe never blocks navigation
  or the rest of the app.
- Opening a link when the viewer is down still works (it may load later) — we
  warn, we don't prevent.

## 5. `/watch` hub page

```
┌─ PageHeader: Game View · [Viewer online ●] [↻ Check] ──────────┐
│                                                                │
│  Characters                   (from characters module, read)   │
│  ┌──────────────┐ ┌──────────────┐                             │
│  │ 🧝 Winter    │ │ 🧝 Gardenia  │                             │
│  │ ● online     │ │ ○ offline    │                             │
│  │ [▶ Open] ↗   │ │ [▶ Open] ↗   │                             │
│  └──────────────┘ └──────────────┘                             │
│  [If no characters: empty state → "Add characters first" +     │
│   link to Characters]                                          │
└────────────────────────────────────────────────────────────────┘
```

- The hub is read-only shell chrome: it lists characters via the
  `characters.read` scope and renders WatchButtons; it does not implement
  viewer functionality.

## 6. Auth note

- VellumFE has its own login; the platform's token is never passed to it. If
  the viewer redirects to its own login for a character, that's expected —
  the affordance is a deep link, not an SSO.
- The shell remembers the last-viewed character (`localStorage`) and offers it
  as the primary "Open viewer" action on the hub.
