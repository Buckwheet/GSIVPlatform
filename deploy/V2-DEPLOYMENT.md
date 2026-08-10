# GSIVPlatform v2 — Server Deployment

## Current state (2026-08-10)

v2 is deployed on the production OVH server **alongside** v1 (non-destructive):

| | v1 (GSIVDashboard) | v2 (GSIVPlatform) |
|---|---|---|
| Service | `gs4sd-backend.service` | `gsiv-platform.service` |
| Port | 3100 | **3102** |
| Path | `/opt/gs4sd/backend` | `/opt/gsiv-platform/backend` |
| Inventory DB | `invdb.ts` → `/opt/gs4sd/lich5/data/inv.db3` | same file, **read-only** via `INV_DB_PATH` |
| Auth | env token map, no scopes | token + scopes (`*` admin) |

## Files on the server

- `/opt/gsiv-platform/backend/` — `dist/` (built), `package.json`, `node_modules`
- `/opt/gsiv-platform/backend/.env` — **server-only, never committed** (mode 600)
- `/etc/systemd/system/gsiv-platform.service` — unit (env from `.env`, `Restart=on-failure`)

## Env (server-only)

```
PORT=3102
REDIS_URL=            # empty => in-memory KV
DB_PATH=/opt/gsiv-platform/backend/data/gsiv.db
INV_DB_PATH=/opt/gs4sd/lich5/data/inv.db3
PRICING_DB_PATH=/opt/gsiv-platform/backend/data/pricing.db
AUTH_TOKENS=admin:<uuid>:*
```

Token generated with `node -e "console.log(require('crypto').randomUUID())"` —
**rotate by editing the server .env and restarting**; never commit it.

## Redeploy

```bash
cd backend && npm run build
scp -r dist package.json package-lock.json ubuntu@51.68.235.144:/tmp/gsiv-deploy/
ssh ubuntu@51.68.235.144 "sudo cp -r /tmp/gsiv-deploy/* /opt/gsiv-platform/backend/ && cd /opt/gsiv-platform/backend && npm install --omit=dev && sudo systemctl restart gsiv-platform"
```

## Verify

```bash
curl -s http://127.0.0.1:3102/health
TOK=$(grep '^AUTH_TOKENS=' /opt/gsiv-platform/backend/.env | cut -d: -f2)
curl -s http://127.0.0.1:3102/api/modules/inventory/summary -H "Authorization: Bearer $TOK"
curl -s http://127.0.0.1:3102/api/spec -H "Authorization: Bearer $TOK"
```

## Verified live (2026-08-10)

- `/health` 200, module status 200, spec lists health/inventory/pricing
- Inventory against real prod DB: 73 characters / 5,981 items / 840,340,579 silvers
- No-auth requests → 401
- Service survives restart

## Not yet done

- Public exposure (Caddy subdomain/path for :3102) — deliberate, not wired yet
- Pricing data import from the old sales-tracker DB (`/opt/sales-tracker/data/sales.db`)
- Lich autoprice URL migration to `/api/modules/pricing/*`
- Retire v1 (port 3100) once all modules are ported
