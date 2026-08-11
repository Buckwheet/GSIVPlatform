# GSIVPlatform v2 — Server Deployment

## Current state (2026-08-11)

v2 is deployed on the production OVH server **alongside** v1 (non-destructive):

| | v1 (GSIVDashboard) | v2 (GSIVPlatform) |
|---|---|---|
| Service | `gs4sd-backend.service` | `gsiv-platform.service` |
| Port | 3100 | **3102** |
| Path | `/opt/gs4sd/backend` | `/opt/gsiv-platform/backend` (frontend dist: `/opt/gsiv-platform/frontend`) |
| Inventory DB | `invdb.ts` → `/opt/gs4sd/lich5/data/inv.db3` | same file, **read-only** via `INV_DB_PATH` |
| Auth | env token map, no scopes | token + scopes (`*` admin) |

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
AUTH_TOKENS=admin:<uuid>:*
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
- Pricing data import from the old sales-tracker DB (`/opt/sales-tracker/data/sales.db`)
- Lich autoprice URL migration to `/api/modules/pricing/*` (+ jar seller, healer, characters watchdog, config, accounts)
- Retire v1 (port 3100) once all modules are ported

## VellumFE streams (2026-08-11)

Headless per-character game streams replacing bucktv's role (dashboard Watch links).
- Binary: upstream `Nisugi/VellumFE` `v0.3.0-beta.37` linux-x86_64 (sha256-verified) at `/opt/vellumfe/vellum-fe`; deps `libspeechd2 libasound2t64` (Ubuntu 24.04).
- Lich: each streamed char's unit gets `--detachable-client=<port>` (Profanity detach protocol — VellumFE is ProfanityFE rewritten). Drop-ins: `/etc/systemd/system/gs4sd-lich@<Char>.service.d/override.conf` (backed up before edit).
- Stream unit: `vellum-fe@<Char>.service` template + per-char drop-in override for ports. Alloc: detach `9101+`, web `9201+` by char (Fisternar 9101/9201, Neleourg 9102/9202).
- Caddy: `vellum.phylactery.ovh` → basic_auth (`gsiv` user, hash in Caddyfile; change with `caddy hash-password`) → reverse_proxy `127.0.0.1:<web>`.
- Web UI auth: pairing token per data dir (`~/.vellum-fe`, shown at boot: `Web UI: .../play#token=<t>`); pairing is remembered per browser. The UI prefills the Lich-attach form from `#rhost=/#rport=` but deliberately never auto-connects — one Connect click per session.
- Platform seam: backend `gameview` module (`/api/modules/gameview/streams`, scope `gameview.read`) built from `VELLUM_BASE_URL` + `VELLUM_STREAMS` env; Characters page renders a Watch column (new tab).
- Scaling: to stream another char, add `--detachable-client=<port>` to its Lich unit (restart — brief disconnect), a `vellum-fe@<Char>` port override, and the `VELLUM_STREAMS` entry.
- **Rebuild recipe (zero-click auto-connect patch):** the stock web UI only prefills the Lich form (never auto-connects), and the assets are embedded in the binary. To rebuild:
  1. `sudo apt-get install -y build-essential pkg-config perl curl libasound2-dev libudev-dev libspeechd-dev clang libclang-dev` + Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal`).
  2. `sudo git clone --depth 1 https://github.com/Nisugi/VellumFE.git /opt/vellumfe-src && sudo chown -R ubuntu:ubuntu /opt/vellumfe-src`.
  3. Patch `src/frontend/web/assets/app.js`: declare `let autoConnectLich = false`; in the `if (bootLich) {...}` block add `autoConnectLich = true;`; in `setSession()` fire `sendJson("connect", { mode: "lich", host: bootLich.host, port: bootLich.port, character: bootLich.name || null, profile_name: null, custom_launch: null })` when `autoConnectLich && session.session_control && (state === "idle" || "disconnected")` (once).
  4. `source ~/.cargo/env && cd /opt/vellumfe-src && cargo build --release` (~15-25 min).
  5. Stop the units, `cp /opt/vellumfe/vellum-fe /opt/vellumfe/vellum-fe.bak-<tag>` (binary is busy while running — stop first), copy `target/release/vellum-fe` over, start the units.
  6. Stream URLs (gameview module) must use `#lich=<host>:<port>&name=<char>` (NOT rhost/rport — that prefills the Remote tab, not the Lich tab).
