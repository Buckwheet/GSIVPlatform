# Design Brief 04 — Game View (VellumFE deep-link UX)

## Context

GSIVPlatform greenfield rewrite. The dashboard will NOT embed a game stream
viewer (v1's BuckTV is being retired). Instead, **VellumFE** — a separate
GPL-3.0 GemStone IV client — runs headless on the server and serves its own
phone-web UI. GSIVPlatform links to it. Read the approved design
`docs/design/2026-08-10-modular-platform-design.md` (§9 VellumFE) and brief 01
(which has a nav slot for this).

Reference (inspiration only, never copy code — GPL-3.0):
`D:\GSIV Development\VellumFE\` — its web server provides: WS with
`hello` → snapshot (300-line scrollback) → live deltas, lag re-sync, pairing
token auth, per-stream routing.

## Goal

Design the **user experience of watching a character's game**, from the
dashboard's perspective: how a user gets from the dashboard into a live view
of a running character, and back. The viewer itself is VellumFE's; we design
the seam.

## Requirements

1. **Entry points**: (a) a "Game View" nav item (overview of running
   characters), (b) a per-character "Watch" action wherever characters appear
   (dashboard strip, characters page), (c) optionally a keyboard shortcut.
2. **Deep-link contract**: define the URL shape VellumFE must serve for a
   specific character (e.g. `https://vellum.phylactery.ovh/?char=Fisternar`)
   — document the assumption; the actual URL comes from deploy config.
3. **Handoff UX**: what the dashboard shows before/during handoff (loading,
   "opening viewer…"), and whether it opens in a new tab vs embedded iframe —
   recommend one with rationale (consider auth: dashboard token vs VellumFE
   pairing token).
4. **Viewer-down handling**: VellumFE unreachable → the dashboard must show
   a clear "viewer offline" state at every entry point, not a broken tab.
5. **Back-navigation**: how the user returns to the dashboard from the viewer
   (deep-link back, or the viewer's own nav).
6. **Multi-character**: switching between characters while viewing — is that
   the dashboard's job (list + watch per char) or the viewer's? Recommend the
   split.

## Constraints

- VellumFE is a separate process + origin; the dashboard cannot set cookies
  on it. Auth is via VellumFE's own pairing token — design how the user gets
  that token (manual entry in the viewer, or dashboard-prefilled link if a
  token API exists).
- Keep the seam thin: the dashboard should not reimplement any streaming.

## Deliverables (Markdown in `docs/design/output/04-game-view/`)

1. `README.md` — index + the recommended handoff model (new-tab vs iframe)
   with rationale.
2. `entry-points.md` — all entry points with exact UI treatment.
3. `deep-link-contract.md` — the URL contract and configuration surface.
4. `states.md` — viewer up/down/loading/auth states at every entry point.
5. `flow.md` — user flow diagrams (Mermaid/ASCII): dashboard → watch → view →
   back, and multi-character switching.
