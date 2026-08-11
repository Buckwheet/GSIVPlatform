# GSIVPlatform v2 — Server Deployment

## Current state (2026-08-11)

v2 is the **only** backend on the production OVH server since 2026-08-11 (v1 retired):

| | v2 (GSIVPlatform) | v1 (GSIVDashboard) |
|---|---|---|
| Service | `gsiv-platform.service` | `gs4sd-backend.service` — **stopped + disabled 2026-08-11** |
| Port | **3102** | 3100 (free) |
| Path | `/opt/gsiv-platform/backend` (frontend dist: `/opt/gsiv-platform/frontend`) | `/opt/gs4sd/backend` (files kept for rollback; Lich runtime stays at `/opt/gs4sd/lich5`) |
| Inventory DB | `inv.db3` → `/opt/gs4sd/lich5/data/inv.db3` (read-only, `INV_DB_PATH`) | same file |
| Auth | token + scopes (`*` admin; `machine` token for Lich scripts) | env token map, no scopes (dead) |

## Files on the server

- `/opt/gsiv-platform/backend/` — `dist/` (built), `package.json`, `node_modules`
- `/opt/gsiv-platform/backend/.env` — **server-only, never committed** (mode 600)
- `/opt/gsiv-platform/frontend/` — built frontend dist (served by Caddy)
- `/etc/systemd/system/gsiv-platform.service` — unit (env from `.env`, `Restart=on-failure`)
- `/etc/caddy/Caddyfile` — `gsiv.phylactery.ovh` site block (backups: `Caddyfile.bak-*`)

## Env (server-only)

```
PORT=3102
REDIS_URL=            # empty => in-memory KV
DB_PATH=/opt/gsiv-platform/backend/data/gsiv.db
INV_DB_PATH=/opt/gs4sd/lich5/data/inv.db3
PRICING_DB_PATH=/opt/gsiv-platform/backend/data/pricing.db
ENTRY_YAML_PATH=/opt/gs4sd/lich5/data/entry.yaml
LICH_DB_PATH=/opt/gs4sd/lich5/data/lich.db3
ANALYSIS_DATA_DIR=/opt/gs4sd/data
LICH_LOG_DIR=/opt/gs4sd/lich5/logs
TOTP_SECRET_PATH=/opt/gsiv-platform/backend/data/totp_secret
# optional gameUp probe overrides for the lich watchdog:
GAME_HOST=storm.gs4.game.play.net
GAME_PORT=10024
# admin token + scoped machine token used by every Lich script / watchdog / invdb scanner
AUTH_TOKENS=admin:<uuid>:*,machine:<uuid>:gems.read,gems.write,healer.read,healer.write,characters.read,characters.write,pricing.read,pricing.write,lich.read,lich.write
```

Token generated with `node -e "console.log(require('crypto').randomUUID())"` —
**rotate by editing the server .env and restarting**; never commit it.

## Redeploy (backend + frontend)

```bash
cd backend && npm run build
cd ../frontend && npm run build
# stage to separate names — dist/ (backend) and frontend-dist/ (frontend)
scp -r backend/dist backend/package.json backend/package-lock.json ubuntu@51.68.235.144:/tmp/gsiv-deploy/
scp -r frontend/dist ubuntu@51.68.235.144:/tmp/gsiv-deploy/frontend-dist
```

**NOTE — copy the `dist` folder itself, not its contents** (`cp -r /tmp/gsiv-deploy/*` puts `dist/` back at `backend/dist`; `dist/*` would scatter files at the backend root and leave the old `dist/` in place — happened 2026-08-11, service kept serving 3 modules).

```bash
ssh ubuntu@51.68.235.144 "set -e
  sudo cp -r /tmp/gsiv-deploy/dist /opt/gsiv-platform/backend/   # overwrites backend/dist
  sudo cp /tmp/gsiv-deploy/package.json /tmp/gsiv-deploy/package-lock.json /opt/gsiv-platform/backend/
  sudo rm -rf /opt/gsiv-platform/frontend && sudo mkdir -p /opt/gsiv-platform/frontend
  sudo cp -r /tmp/gsiv-deploy/frontend/dist/* /opt/gsiv-platform/frontend/
  cd /opt/gsiv-platform/backend && sudo npm install --omit=dev
  sudo systemctl restart gsiv-platform"
```

Frontend assets use hashed filenames, so a stale browser cache is fine; `index.html` is served with `no-cache` by Caddy.

## Verify

```bash
curl -s http://127.0.0.1:3102/health
TOK=$(grep '^AUTH_TOKENS=' /opt/gsiv-platform/backend/.env | cut -d: -f2)
curl -s http://127.0.0.1:3102/api/modules/inventory/summary -H "Authorization: Bearer $TOK"
curl -s http://127.0.0.1:3102/api/spec -H "Authorization: Bearer $TOK"   # should list all 9 modules (health/inventory/pricing/gems/healer/characters/accounts/config/analysis)
# Frontend + Caddy routing (no DNS needed):
curl -s -H 'Host: gsiv.phylactery.ovh' http://127.0.0.1/ | head
curl -s -H 'Host: gsiv.phylactery.ovh' -H "Authorization: Bearer $TOK" http://127.0.0.1/api/modules/gems/jars
```

## Verified live (2026-08-11)

- `/health` 200; spec lists **all 9 modules** (63 paths); no-auth → 401
- Inventory against real prod DB; config reads real lich.db3/entry.yaml; analysis endpoints serve
- Caddy `gsiv.phylactery.ovh` block: SPA + deep links, `/api` (200 with token / 401 without), `/health`, assets — all verified via Host-header curl
- Service survives restart (`systemctl restart gsiv-platform`)

## Not yet done

- **Cloudflare DNS**: A record `gsiv` → `51.68.235.144` (proxied) — the only thing between the site and the public internet
- Stream more chars (3-step recipe below) when they come online. Zero-click Watch flow: **confirmed in a real browser 2026-08-12**; the login-form flash seen on load was fixed (app.js patch 2, see §VellumFE) — hard-refresh to verify after any rebuild
- `gs4sd_streamer.lic` / `ebounty_tracker.lic` are retired with v1 (BuckTV replaced by VellumFE; bounty has no v2 home yet)

## Lich + Ruby upgrade (2026-08-11: v5.16.2 -> v5.19.1, Ruby 3.2 -> 4.0.6)

Lich 5.19+ requires **Ruby >= 4.0** (v5.19.1 pins `.ruby-version` 4.0.3). Ubuntu 24.04's apt Ruby is
3.2, so the server uses **rbenv Ruby 4.0.6** (`/home/ubuntu/.rbenv/versions/4.0.6`). The Lich install
at `/opt/gs4sd/lich5` is a git clone of `elanthia-online/lich-5`; upgrades are done by tag checkout
(`scripts/`, `data/`, `maps/`, `logs/` are gitignored -> preserved; backup first).

**Current versions:** Ruby 4.0.6 (rbenv), Lich v5.19.1 (detached HEAD at tag). Bundle: full
`bundle install` under 4.0.6 (78 gems; gtk3/curses native builds succeeded so no `BUNDLE_WITHOUT`
needed). Lich units run `/home/ubuntu/.rbenv/versions/4.0.6/bin/ruby` (base unit + every
per-char override + lich-test — ALL must be repointed together).

**To update Lich again:**
1. Backup: `sudo tar czf /opt/gs4sd/lich5-upgrade-backup-YYYY-MM-DD.tgz --exclude=logs --exclude=.git -C /opt/gs4sd lich5`
2. `cd /opt/gs4sd/lich5 && git fetch --tags origin && git checkout v<new>` (or `git checkout main` to track upstream)
3. `export PATH="$HOME/.rbenv/versions/4.0.6/bin:$PATH" && bundle install`
4. There is no throwaway test char — **Amn is off-limits; test only on Fisternar/Neleourg**. After
   `bundle install`, boot-check the new stack directly: `cd /opt/gs4sd/lich5 && DISPLAY= timeout 20
   ruby lich.rbw --login Fisternar --without-frontend --scripts=/opt/gs4sd/lich5/scripts` and watch
   the unit journal/`/opt/gs4sd/lich5/logs` for a clean boot before restarting the units.
5. `sudo systemctl restart gs4sd-lich@Fisternar gs4sd-lich@Neleourg` (brief per-char disconnect).
6. Verify: `systemctl is-active` both; `curl localhost:3102/api/modules/lich/watchdog` (heartbeats fresh);
   `curl localhost:3102/api/modules/gameview/streams` with the admin token (`up:true` for both) — the
   gameview probe confirms the detach servers answer. VellumFE dials the detach port only when a
   browser session connects, so no idle TCP connections is normal.

**Rollback:** restore the tar (or `git checkout` the recorded HEAD) + point the units back at
`/usr/bin/ruby` (or the previous rbenv version) + `daemon-reload` + restart.

**Gotchas hit during the 2026-08-11 upgrade:**
- `systemctl start` on an already-active unit is a no-op — after repointing ExecStart you MUST
  `systemctl restart` (the units auto-restart on failure with the OLD config; don't be fooled).
- `pkill -f 'lich.rbw'` matches your own shell if the pattern appears in the ssh command line —
  it killed the live units and dropped the ssh session. Use exact patterns / `pgrep` first.

## Lich migration + v1 retirement (2026-08-11)

All Lich integration now runs against v2 `/api/modules/*`; v1 (port 3100) is retired.

**New module — `lich`** (`/api/modules/lich/*`, scopes `lich.read`/`lich.write`, KV-backed):
- `POST /publish` — publisher heartbeat (room_id + resources + spells, arbitrary JSON)
- `GET /status/:char` — latest published state (404 when none)
- `GET /watchdog` — `{gameUp, checkedAt, characters:[{name,online,lastSeen,ageSec}]}`; gameUp = TCP probe
  to `storm.gs4.game.play.net:10024` (env `GAME_HOST`/`GAME_PORT`, 30s cache); online = heartbeat within 30s
- `POST /commands` + `GET /commands/:char` — FIFO command queue (the invdb scanner's `;invdb` channel)
- `POST /premium` — premium-info collector

**Machine token** (`machine:<uuid>:<scopes>`) is used by: Lich units (`GS4SD_URL=http://localhost:3102`,
`GS4SD_TOKEN` env), `gs4sd-watchdog.sh` (timer), `invdb-parallel.sh`/`invdb-scan.sh`. Rotate by editing
`AUTH_TOKENS` in the server `.env` and restarting — same as the admin token.

**Script URL moves (GSIVDashboard repo):** jar family → `/api/modules/gems/*` + `/api/modules/pricing/*`;
healer/call_healer → `/api/modules/healer/*`; publisher/premium/gift_claim/courier room lookups →
`/api/modules/lich/*`; `gs4sd_streamer.lic` removed from Lich start-scripts (BuckTV retired).

**Watchdog gotcha (important):** v1's `/api/watchdog` only listed the 2 actively-managed chars; v2's
managed list is every entry.yaml char. The watchdog script therefore gates restarts on
`systemctl is-enabled` — only enabled units (currently Fisternar, Neleourg) are restarted. Without the
gate a single timer run started ~70 disabled Lich units and blew the v2 rate limit (120 req/min per token).

**Caddy:** `dashboard.phylactery.ovh` and `sales.phylactery.ovh` now 301 to `gsiv.phylactery.ovh`
(fishbyte + bucktv still served under the dashboard host); `@sales` backend block removed
(`gs4-sales-backend.service` stopped + disabled). Backups: `Caddyfile.bak-2026-08-11-retire`. Server
`.env` backup: `.env.bak-2026-08-11`; unit backups: `gs4sd-lich@.service.bak-2026-08-11`,
`<char>.conf.bak-2026-08-11`, script backups `*.lic.bak-2026-08-11` / `*.sh.bak-2026-08-11` under
`/opt/gs4sd`.

## VellumFE streams (2026-08-11)

Headless per-character game streams replacing bucktv's role (dashboard Watch links).
- Binary: upstream `Nisugi/VellumFE` `v0.3.0-beta.37` linux-x86_64 (sha256-verified) at `/opt/vellumfe/vellum-fe`; deps `libspeechd2 libasound2t64` (Ubuntu 24.04).
- Lich: each streamed char's unit gets `--detachable-client=<port>` (Profanity detach protocol — VellumFE is ProfanityFE rewritten). Drop-ins: `/etc/systemd/system/gs4sd-lich@<Char>.service.d/override.conf` (backed up before edit).
- Stream unit: `vellum-fe@<Char>.service` template + per-char drop-in override for ports. Alloc: detach `9101+`, web `9201+` by char (Fisternar 9101/9201, Neleourg 9102/9202).
- Caddy: `vellum.phylactery.ovh` → basic_auth (`gsiv` user, hash in Caddyfile; change with `caddy hash-password`) → reverse_proxy `127.0.0.1:<web>`.
- Web UI auth: pairing token per data dir (`~/.vellum-fe`, shown at boot: `Web UI: .../play#token=<t>`); pairing is remembered per browser. The UI prefills the Lich-attach form from `#rhost=/#rport=` but deliberately never auto-connects — one Connect click per session.
- Platform seam: backend `gameview` module (`/api/modules/gameview/streams`, scope `gameview.read`) built from `VELLUM_BASE_URL` + `VELLUM_STREAMS` env; Characters page renders a Watch column (new tab).
- Scaling: to stream another char, add `--detachable-client=<port>` to its Lich unit (restart — brief disconnect), a `vellum-fe@<Char>` port override, and the `VELLUM_STREAMS` entry.
- **Rebuild recipe (two GSIVPlatform app.js patches):** the stock web UI only prefills the Lich form (never auto-connects), and the assets are embedded in the binary. To rebuild:
  1. `sudo apt-get install -y build-essential pkg-config perl curl libasound2-dev libudev-dev libspeechd-dev clang libclang-dev` + Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal`).
  2. `sudo git clone --depth 1 https://github.com/Nisugi/VellumFE.git /opt/vellumfe-src && sudo chown -R ubuntu:ubuntu /opt/vellumfe-src`.
  3. Patch `src/frontend/web/assets/app.js` (back up first: `cp app.js app.js.bak-<date>`):
     - **Patch 1 — zero-click auto-connect** (stock only prefills, never connects): declare `let autoConnectLich = false;` near the `bootLich` block; in the `if (bootLich) {...}` block add `autoConnectLich = true;` after the prefill lines; in `setSession()` fire `sendJson("connect", { mode: "lich", host: bootLich.host, port: bootLich.port, character: bootLich.name || null, profile_name: null, custom_launch: null })` when `autoConnectLich && session.session_control && (session.state === "idle" || session.state === "disconnected")` and clear `autoConnectLich` (fire once).
     - **Patch 2 — no login-form flash on Watch deep links** (2026-08-12; the attach form flashed for a split second before the auto-connect resolved): add `let zeroClickConnecting = false;` next to `autoConnectLich`; in the `if (bootLich) {...}` block set `zeroClickConnecting = true; sessionForm.hidden = true; sessionStatus.textContent = "Connecting to the game…"; sessionStatus.hidden = false;`; in `setSession()` clear it (`zeroClickConnecting = false; sessionForm.hidden = false;`) once `session.state` leaves `idle`/`disconnected` or `session.error` is set (so a failed connect never strands the login UI); in `updateSessionUiInner()` keep the "Connecting to the game…" status (not the form) while `zeroClickConnecting` is true.
  4. `source ~/.cargo/env && cd /opt/vellumfe-src && cargo build --release` (~15-25 min).
  5. Stop the units, `cp /opt/vellumfe/vellum-fe /opt/vellumfe/vellum-fe.bak-<tag>` (binary is busy while running — stop first), copy `target/release/vellum-fe` over, start the units.
  6. Stream URLs (gameview module) must use `#lich=<host>:<port>&name=<char>` (NOT rhost/rport — that prefills the Remote tab, not the Lich tab).
- **Cache gotcha (2026-08-12):** vellum-fe serves `/app.js` with `cache-control: max-age=14400` (4h). After ANY rebuild, browsers keep the old UI for up to 4h — a "fix didn't work" report may be stale cache, not a bad patch. Verify with a hard refresh / incognito tab. Backup trail on the server: `/opt/vellumfe/vellum-fe.bak-beta37` (stock), `vellum-fe.bak-2026-08-12` (patch 1 only), source `app.js.bak-2026-08-12` (before patch 2).
- **Sales pipeline (2026-08-12):** v2 is the single live source. Hourly `gsiv-sales-scan.timer` → `gsiv-sales-scan.service` runs `deploy/gsiv-sales-scan.sh` (`POST /api/modules/pricing/scrape` then `POST /api/modules/your-shops/scan` with the machine token from `/etc/gsiv-sales-scan.env`, 0600). The v1 `gs4-sales-scraper.timer` is DISABLED (its db `/opt/sales-tracker/data/sales.db` is a frozen archive). To run a scan manually: `sudo systemctl start gsiv-sales-scan.service`.
