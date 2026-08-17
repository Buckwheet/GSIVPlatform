# Auto-provision VellumFE streams on launch (2026-08-17)

## Intent

Today `POST /api/modules/gameview/launch/:char` 404s for any char that has no
`VELLUM_STREAMS` entry. Bringing a newly-started character online with a
stream (as was done manually for **Vaikar**) currently requires the 3-step
§VellumFE recipe (add `--detachable-client`, a `vellum-fe@<Char>` unit, a
`VELLUM_STREAMS` entry + Caddy host). The user asked that this happen
**automatically for any future character launch** — it is part of the launch
spec.

Decisions (user-confirmed):
- **Trigger:** auto-provision inside `POST /launch/:char` only, for chars that
  are not yet in `VELLUM_STREAMS`. `GET /streams` / Watch links for a live but
  unprovisioned char do NOT provision; `launch` is the explicit action.
- **Side effects:** fully automatic **and reversible** — every file write is
  backup-then-write, Caddy config is validated before reload, and partial
  failures roll the machine back to the pre-provision state.
- **Ports:** auto next-free (910X detach / 920X web), lowest unused pair.

## Design

New review-gated core capability `core/stream-provision.ts` (the platform's
only code that mutates the host stream stack). The `gameview` module keeps NO
file/systemd logic — it calls the provisioner, mirroring the other
review-gated capabilities (`Systemd`, `ConfigFiles`, `InvDb`, …).

A new self-contained provisioner class `StreamProvisioner`:

```ts
class StreamProvisioner {
  constructor(opts) {
    // injectables for tests:
    //   readFile / writeFile / copyFile / resolve paths (Caddyfile, .env, systemd dirs)
    //   systemctl exec (show/daemon-reload/enable/start/restart)
    //   caddy validate exec
    //   currentStreams: () => Record<Char,{detach,web}>   // parity with module's view
    //   dataDir for .env
  }
  async provision(char): Promise<ProvisionResult>   // port assignment + applied state
  async rollback(char): Promise<void>               // undo a failed/partial provision
}
```

### Provision sequence for an unprovisioned char (all steps idempotent/guarded)

1. `validateCharName(char)` (existing). Reject already-provisioned chars.
2. Read the char's **effective** Lich ExecStart via `systemctl show
   gs4sd-lich@<Char>.service -p ExecStart` and extract its `--start-scripts=…`
   value (preserve the char's configured scripts). Reuse the regex from the
   Lich unit format. With no unit yet, fall back to the Lich template's default
   `--start-scripts` seed (see note).
3. Allocate the lowest unused `(detach, web)` pair in 9100+/9200+ across
   current streams *and* any running `vellum-fe@` unit (belt-and-braces).
4. Write Lich drop-in
   `gs4sd-lich@<Char>.service.d/override.conf`:
   - `ExecStart=` then the full command rebuilt with `--detachable-client=<detach>`
     and the original `--start-scripts` (strip any pre-existing `--detachable-client`,
     so we never double-add).
5. Write `vellum-fe@<Char>.service.d/override.conf` (ports `<detach>/<web>`).
6. `systemctl daemon-reload`.
7. `systemctl enable --now vellum-fe@<Char>` (starts the stream).
8. Restart the Lich unit (`systemctl restart gs4sd-lich@<Char>`) so the detach
   server comes up (launch means the char is coming online anyway — brief
   disconnect is expected/acceptable).
9. **Caddy**: back up the Caddyfile; add the `@<char> host <char>.phylactery.ovh`
   matcher (near the other `@v…` matchers) and a
   `handle @<char> { reverse_proxy 127.0.0.1:<web> }` block (near the other
   handlers); run `caddy validate` and only then reload (`caddy reload` /
   `systemctl reload caddy`). On validate failure, restore the backup.
10. **Server `.env`**: back it up; rewrite the `VELLUM_STREAMS` line to append
    `,<Char>:<detach>:<web>`.
11. **Running module view**: append to the module's live streams map so the
    launch response and subsequent `GET /streams` reflect the new char without a
    mid-request backend restart (restarting the backend would kill this in-flight
    response). The `.env` change is persisted for the next boot; the in-memory
    update covers the current process.

### Rollback

If any step after writing the first file fails, the provisioner restores every
backup it created (drop-ins removed, Caddyfile/.env restored, `daemon-reload`, and
if a new vellum-fe unit was enabled it is stopped + disabled) before returning an
error. The launch handler maps a provision failure to 500 with a clean message.

### Security notes

- All char-derived paths go through `validateCharName` → the same strict
  `[A-Za-z][A-Za-z0-9_-]{0,31}` check as `Systemd`, so no traversal/escape into
  other units or files.
- Systemd unit writing is confined to the systemd dir; Caddyfile/.env paths are
  injected (server-only), never derived from request input.
- No shell strings: `execFile`/args arrays only, consistent with SECURITY.md.
- The endpoint is already scope-gated (`lich.write`/`characters.write`).
- Adding this is documented in `backend/SECURITY.md`.

## Tests

- Port allocator: skips used ports, picks lowest free, handles empty.
- start-scripts extraction from a sample Lich ExecStart (with/without detach).
- Drop-in content generation for Lich + vellum-fe.
- Caddyfile mutation produces valid blocks; backup on validate failure.
- `.env` rewriting preserves other keys.
- Launch flow: unprovisioned char → provisioner invoked → 200 with URL;
  already-provisioned char → no provisioner call; provision failure → 500.
- Rollback restores all prior files.

## Deploy / verify

Deployed 2026-08-17 (backend dist + package files to `/opt/gsiv-platform/backend`, service restarted). Live-verified: `GET /streams` returns all 3 streamed chars `up:true`; `POST /launch/Fisternar` (already-provisioned) → 200 `started:false` (no provisioning attempted — no regression); service booted clean. The new env vars (`VELLUM_SYSTEMD_DIR`/`VELLUM_CADDYFILE`/`VELLUM_ENV_FILE`) are optional — unset on the server, so the provisioner falls back to the real host paths.

The **auto-provision path itself** is covered by unit/module tests (provision flow, drop-in content, port allocation, caddy/.env extension, rollback on invalid config, no-op for existing, 500 on provision failure) but is **not** forced live: the only launchable in-play chars (Fisternar/Neleourg/Vaikar) are already streaming, and Amn is off-limits. The first real trigger is the user's next launch of a newly-streamed character — which is the intended production scenario.

