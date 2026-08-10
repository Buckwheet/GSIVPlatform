# Design 04 — Game View (VellumFE deep-link seam)

**Status:** Draft for review
**Inputs:** Approved platform design `docs/design/2026-08-10-modular-platform-design.md` (§9 VellumFE), brief 01 (shell & nav), brief 04 (this brief).
**Reference (inspiration only, never copied — GPL-3.0):** `D:\GSIV Development\VellumFE\` (WS `hello` → snapshot scrollback → live deltas, lag re-sync, pairing-token auth, per-stream routing).

## Scope

This design covers **the seam only** — how a user gets from GSIVPlatform into a live view of a running character, and back. The viewer itself is VellumFE's; we never reimplement streaming, never embed the viewer's internals, and never import any of its code.

## TL;DR

| Question | Decision | Rationale |
|---|---|---|
| Handoff model | **New tab, not iframe** | Auth separation is decisive: dashboard Bearer/scope token vs VellumFE pairing token on a separate origin. An iframe fuses two unrelated auth systems visually and invites token sharing; a separate tab keeps them airtight. Secondary: GPL-3.0 isolation, resilience (a dead viewer never breaks the dashboard), full-screen long-lived viewing, dashboard state survives on return. |
| Deep-link shape | `{VELLUM_BASE_URL}/?char=<CharacterName>` | Matches VellumFE's per-stream routing; one link = one character = one tab. |
| Auth handoff | Manual pairing in the viewer on first visit; optional short-lived one-time `otp=` only if VellumFE exposes a handoff-token API | Dashboard cannot set cookies on VellumFE's origin and must not put long-lived tokens in URLs. |
| Availability | Server-side health probe → `/api/modules/gameview/health` | Avoids browser CORS on a foreign origin, gives one source of truth, stays a thin seam. |
| Multi-character | **Dashboard is the hub** (list + per-char Watch everywhere); the viewer is a single-character viewport | No cross-origin session protocol needed; switching = back to dashboard, watch another char (new tab). |
| Back navigation | Browser/OS back to the dashboard tab (its state survives); optional `returnTo` link rendered by VellumFE | The dashboard tab never closed, so returning is instant — no reload, no re-auth. |

## Files in this design

1. `entry-points.md` — every way in, with exact UI treatment.
2. `deep-link-contract.md` — the URL contract and configuration surface.
3. `states.md` — viewer up / down / loading / auth states at every entry point.
4. `flow.md` — Mermaid/ASCII flows: watch → view → back, viewer-down, pairing, multi-char.

Companion: brief 01's shell design (`output/01-shell-and-nav/`) owns the nav slot, status strip, and shell-level error states; this design owns everything at/after the VellumFE seam.

---

## The handoff decision: new tab, not iframe

### Recommendation

Open VellumFE in a **new browser tab** (target `_blank`). The dashboard never frames VellumFE.

### Rationale

1. **Auth separation (decisive).** GSIVPlatform authenticates with a scoped Bearer token in its own context. VellumFE authenticates with its **pairing token**, lives on its own origin, and the dashboard *cannot* set cookies on it. An iframe would visually fuse the two into "one product" while still not sharing anything real — users would expect the dashboard's session to carry over, it never would, and the temptation to tunnel tokens through URLs grows. A new tab makes the boundary explicit: *this is a different service, it has its own session.* No iframe means no `frame-ancestors` relaxation, no cross-origin messaging API to build, no token-sharing surface at all.
2. **License isolation.** VellumFE is GPL-3.0; GSIVPlatform stays private. Separate process, separate origin, separate tab keeps the two not only legally but *visually* isolated — nothing in the platform chrome ever shows VellumFE code, and nothing in the viewer ever shows dashboard chrome.
3. **Resilience.** If VellumFE dies mid-viewing, the dashboard tab is untouched — the user returns to a healthy dashboard showing the "viewer offline" state with retry. An iframe that dies renders a broken region *inside* the dashboard and can take focus/scroll with it.
4. **It's a full-screen, long-lived activity.** Live game view = scrollback, live deltas, phone use. That is a browser tab's job, not a content pane's. An iframe gives no extra integration anyway: no scripting access, no shared storage — only layout embedding, which we don't want.
5. **Return is free.** Because the dashboard tab never closes, "back" is just focusing the dashboard tab — state, route, and WS connection all preserved. No reload, no re-auth.

### Rejected alternatives

- **Iframe** — rejected above. Would only be revisited if a future requirement demanded a live *embedded glance* pane (e.g. quick-monitor), and then only with VellumFE's explicit cooperation (CSP `frame-ancestors` allowance, viewer handles its own pairing, no auth fusion). Not now.
- **Hybrid (new tab + embeddable widget)** — over-engineers the seam; VellumFE would have to build and maintain a second integration. Keep one contract.
- **Polling thumbnail / screenshot embed** — not a live view, violates "keep the seam thin", adds polling load on a GPL service for zero user value.

### What this means for the seam

- The dashboard provides: entry points, deep-link URLs, availability state, and back affordances. Nothing else.
- VellumFE provides: the viewer, pairing, per-character routing, and (optionally) the `returnTo` link and health endpoint.

## Explicitly out of scope

- Any streaming/reconnect/scrollback code in the dashboard.
- Any iframe wrapper or token-sharing mechanism.
- Any copy or port of VellumFE UI code.
- Choosing/pairing the actual VellumFE deployment URL — that is deploy config (see `deep-link-contract.md`).
