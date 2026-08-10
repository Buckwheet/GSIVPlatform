# Deep-Link Contract — VellumFE

The URL shape the dashboard produces for VellumFE, and the configuration surface behind it. VellumFE's own route handling is out of scope; this document fixes the **contract** the dashboard emits and the assumptions the dashboard relies on.

## 1. URL shape

```
{VELLUM_BASE_URL}/?char=<CharacterName>[&returnTo=<encoded dashboard URL>][&otp=<one-time handoff>]
```

- **`char` (required)** — the character's name, URL-encoded, **case preserved** (GemStone character names are case-significant, e.g. `Fisternar`). Exactly one character per link; one viewer tab shows one stream.
- **`returnTo` (optional)** — URL-encoded dashboard URL (the page the Watch was clicked from, or `/game-view`). VellumFE *may* render it as a "← Back to GSIVPlatform" link in its own chrome. Dashboard sends it; VellumFE validates it (see §4).
- **`otp` (optional, future)** — a one-time pairing handoff token **only if** VellumFE implements a handoff-token API. See §5.
- Unknown query params are ignored by the contract (VellumFE may define its own, e.g. `theme`).

### Examples

```
https://vellum.phylactery.ovh/?char=Fisternar
https://vellum.phylactery.ovh/?char=Zim&returnTo=https%3A%2F%2Fplatform.phylactery.ovh%2Fgame-view
https://vellum.phylactery.ovh/?char=Fisternar&otp=8f3k2m9x          # future, see §5
```

## 2. Contract assumptions (documented, must hold)

These are the minimum guarantees the dashboard's UX depends on:

| # | Assumption | Owner |
|---|---|---|
| A1 | A `?char=<name>` deep link routes to that character's live view (VellumFE's per-stream routing). | VellumFE |
| A2 | VellumFE remembers a successful pairing in its own storage, so subsequent deep links to the same install don't re-pair. | VellumFE |
| A3 | VellumFE serves a lightweight health endpoint (e.g. `GET /healthz` → 200/JSON) reachable from the platform backend. | VellumFE |
| A4 | VellumFE renders a "← Back" affordance for `returnTo` **only after** validating the origin against its configured allow-list (open-redirect safety). | VellumFE |
| A5 | No long-lived pairing token ever goes in the URL. | both |

If A1–A3 can't be satisfied, the dashboard degrades to "always assume up + link out" (viewer-down detection disabled) — see `states.md` §Degradation.

## 3. Configuration surface

All values come from deploy config — **never hardcoded** in frontend code.

| Key | Where | Meaning | Example |
|---|---|---|---|
| `VELLUM_BASE_URL` | backend env | base URL for the health probe | `https://vellum.phylactery.ovh` |
| `VITE_VELLUM_BASE_URL` (or runtime-injected `window.__config.vellumBaseUrl` via Caddy template) | frontend build/runtime | base URL used by `buildVellumDeepLink` | same |
| `VELLUM_HEALTH_URL` (optional) | backend env | overrides default `${VELLUM_BASE_URL}/healthz` | — |
| `VELLUM_HEALTH_INTERVAL_MS` | backend env | probe cadence, default 15_000 | `15000` |
| `VELLUM_HEALTH_TIMEOUT_MS` | backend env | probe timeout, default 2_000 | `2000` |
| `VELLUM_RETURN_ALLOWLIST` | VellumFE config | origins allowed for `returnTo` | `https://platform.phylactery.ovh` |
| `VELLUM_OTP_TTL_S` | VellumFE config | one-time token lifetime (future) | `60` |

The frontend never sees `VELLUM_RETURN_ALLOWLIST`; it lives on the VellumFE side.

## 4. Security rules

1. **No long-lived tokens in URLs.** `otp` (if adopted) is single-use with `TTL ≤ 60s`, generated server-side, never the pairing token itself.
2. **`returnTo` is a potential open redirect.** The dashboard restricts it to dashboard-origin URLs it knows (`location.origin` + same-origin paths only) when building; VellumFE additionally validates against its allow-list before rendering. Defense in depth on both sides.
3. **`rel="noopener noreferrer"`** on every new-tab anchor so the dashboard origin never leaks in `Referer` to the viewer.
4. No dashboard auth token, scope list, or session material is ever placed in the deep link.

## 5. Auth handoff (pairing token)

- **Default (required path):** the user pairs **manually inside the viewer** on first visit — VellumFE's existing pairing-token flow. The dashboard's only job: a one-line hint ("First visit? You'll pair once in the viewer") at each entry point, and a `returnTo` so they can get back afterward. The pairing token is stored by VellumFE only (A2); the dashboard never sees or stores it.
- **Optional (future):** if VellumFE exposes a **handoff-token API** (e.g. `POST /api/handoff` → single-use `otp`), the platform backend can mint one at watch-time and append `&otp=`. This is strictly a VellumFE capability; until it exists, the manual path is the contract. Mark as an open item.

## 6. Frontend builder (single source of truth)

```ts
// frontend/src/core/vellum.ts
export function buildVellumDeepLink(
  charName: string,
  opts: { returnTo?: string } = {},
): string {
  const base = window.__config?.vellumBaseUrl ?? import.meta.env.VITE_VELLUM_BASE_URL;
  if (!base) throw new Error("VELLUM_BASE_URL not configured"); // fail loudly, never emit a broken link
  const params = new URLSearchParams({ char: charName });
  if (opts.returnTo) params.set("returnTo", opts.returnTo);
  return `${base}/?${params.toString()}`;
}
```

- One function, used by every entry point (`entry-points.md`).
- **Fail loudly** if the base URL is missing — a nav entry or Watch button must never render a `undefined/?char=` link.

## 7. Health probe (backend, read-only)

- The platform backend polls `${VELLUM_BASE_URL}/healthz` every `VELLUM_HEALTH_INTERVAL_MS` (from the same server, no CORS involved) and exposes the result as a read-only module route:

```
GET /api/modules/gameview/health
→ 200 { "ok": true,  "lastChecked": "<iso>", "latencyMs": 42, "viewerVersion": "2.4.1" }
→ 200 { "ok": false, "lastChecked": "<iso>", "error": "timeout" }
```

- The frontend receives pushes via the existing WS bus (`gameview.health` event) and can fall back to polling the route. This keeps the browser free of cross-origin probes and gives the shell one source of truth for the nav dot and all Watch buttons.
- Character running/stopped state comes from **platform state** (characters module / status strip), never from VellumFE.

## 8. Open items

1. Confirm VellumFE serves `GET /healthz` and honors `?char=` (A1–A3) with the actual deployment.
2. Handoff-token API (`&otp=`) — feature request against VellumFE; not blocking.
3. `VELLUM_RETURN_ALLOWLIST` final value.
