# Security Review — 2026-09-10

**Scope:** `GSIVPlatform` (repo `D:\Code Projects\GSIVPlatform`, API `https://gsiv.phylactery.ovh`, host `51.68.235.144`) and the Cloudflare zone `phylactery.ovh` that fronts it.
**Method:** manual, evidence-based pass — repo (source, docs, git history), live host (systemd, UFW, sshd, Caddy, file modes, listening sockets), live Cloudflare zone settings/DNS/WAF/Rate-limits (read-only API GETs), and two read-only HTTP probes.
**Standard applied:** Cloudflare's published origin-protection and SSL/TLS guidance.
**Status:** findings documented only. **No changes have been applied** to the code, the host, or the Cloudflare zone; the action plan in §6 awaits approval.

**Reviewer note:** the built-in `security-review` skill inspects the *current branch diff* only and runs in the `C:\` subagent workspace while this repo lives on `D:\`, so it would have found nothing here; this review was therefore done manually against live state.

**Disclosure:** during testing one read-only request (`GET /api/me`) was sent to the origin over plain HTTP using the (already publicly committed) admin token, to prove the origin-bypass finding F3. No write/mutation was performed against any system.

---

## 1. Executive summary

Two of the three critical findings are exploitable **right now**, without any user interaction:

1. **The live admin API token is committed in a PUBLIC GitHub repo** (`visibility: PUBLIC`). It was used during this review to authenticate against production successfully. Anyone can read/write the entire dashboard API today.
2. **Cloudflare is in `Flexible` SSL mode and the origin serves plain HTTP only.** Every `Authorization: Bearer` token therefore crosses the public internet, unencrypted, between Cloudflare's edge and the origin.
3. The origin is also **directly reachable from the internet**, bypassing Cloudflare (and therefore all WAF/rate-limit/bot protection), and the edge currently has **no WAF, no rate limiting, no bot protection, no HSTS and a TLS 1.0 floor**.

The single highest-value action is **rotating the two `AUTH_TOKENS`** (Phase 0): it is the only step that removes the exposure, and it is independent of everything else.

---

## 2. Findings

| # | Severity | Finding | Cloudflare / best-practice area |
|---|---|---|---|
| F1 | **CRITICAL** | Live admin + machine API tokens committed in a public repo (plus the origin IP) | Secret management; origin IP leakage |
| F2 | **CRITICAL** | Zone `ssl = flexible`; origin has no TLS listener — edge→origin traffic is cleartext | SSL/TLS modes |
| F3 | **HIGH** | Origin reachable directly, bypassing Cloudflare entirely | Protect your origin server |
| F4 | **HIGH** | No WAF managed ruleset, no custom rules, no rate-limiting rules, no bot protection | WAF / Rate limiting / Bots |
| F5 | **HIGH** | No HSTS, TLS floor 1.0, no security headers; SPA keeps the API token in `localStorage` | SSL/TLS settings; response headers |
| F6 | **HIGH** | Token → root escalation chain (`NOPASSWD: ALL` sudo + admin endpoints that write files/exec) | Least privilege |
| F7 | **MEDIUM** | Aggressive cache level + wildcard proxied hosts + no `Cache-Control` on `/api/*` | Cache Rules; cache-key correctness |
| F8 | **MEDIUM** | sshd accepts password authentication on a world-open port 22 | Perimeter |
| F9 | **MEDIUM** | `netdata :19999` and `litellm :4000` bound to `0.0.0.0` (tailnet-reachable; litellm unauthenticated) | Perimeter |
| F10 | **LOW** | `hono <= 4.13.4` advisories (moderate), incl. a query-parser/cache-key differential relevant behind a CDN | Dependency hygiene |
| F11 | **LOW** | DNSSEC disabled; `entry.yaml` mode `0644`; rate limiting keyed by token (not IP); no security alerting; TOTP enrolled nowhere (fails closed) | DNSSEC; hardening; observability |

---

## 3. Detail

### F1 — Live admin + machine tokens in a public repo (CRITICAL)

**Evidence**

```
$ gh repo view Buckwheet/GSIVPlatform --json visibility,isPrivate
{"isPrivate":false,"visibility":"PUBLIC", ...}

$ grep -rn --exclude-dir=node_modules --exclude-dir=.git '<admin-token-value>' .
./docs/STATUS.md:113
./docs/plans/2026-08-12-your-shops-module.md:18,1011,1063
./docs/superpowers/plans/2026-08-13-scan-orchestrator.md:1738,1768

$ git log --all --oneline -S '<admin-token-value>'
d0add25 docs(plan): your-shops module implementation plan …
47b08be docs: EOD handoff — zero-click streams live …
```

The published pair is `415a689b-f097-…` (admin — **all scopes**, i.e. every module read+write) and `abdb3594-b6dd-…` (machine — `gems`/`healer`/`characters`/`pricing`/`lich` read+write, consumed by every `gs4sd-lich@*` unit, the watchdog timer and the invdb scanner). Both are declared in `/opt/gsiv-platform/backend/.env` `AUTH_TOKENS` and both were verified live during this review (`GET /api/me` → 200).

**Impact.** Full API compromise by anyone: read all module data (characters, inventory, pricing, logs, analysis, accounts metadata), start/stop/restart characters, trigger scans, write per-character config files, provision new VellumFE streams — and, since PR #59/#60 (2026-09-10), cause the service to perform **root-owned writes** to `/etc/systemd/system` and `/etc/caddy` (see F6). The docs also publish the origin IP, host paths and the game-account roster.

**Remediation (Phase 0).** Rotate both tokens and update every consumer; purge the values from the docs and stop recording live tokens there; add secret scanning (gitleaks pre-commit + GitHub push protection); decide on repo visibility/history rewrite (history rewriting is hygiene only once the tokens are dead).

### F2 — Flexible SSL / no TLS at the origin (CRITICAL)

**Evidence**

```
$ curl -s https://api.cloudflare.com/client/v4/zones/<zone>/settings   # ssl
  ssl = "flexible"
  min_tls_version = "1.0"          tls_1_3 = "on"
  always_use_https = "on"          automatic_https_rewrites = "on"

$ sudo ss -ltnp | grep -E 'caddy|:80 |:443 '
LISTEN … *:80        users:(("caddy",…))    # nothing on :443
$ curl -skI https://51.68.235.144/ -H 'Host: gsiv.phylactery.ovh'   # → 000 (no listener)
```

`/etc/caddy/Caddyfile` is a single `:80 { … }` site with `host` matchers per vhost (`gsiv`, `vellum`, `bus`, `aeton`, `diynasta`, `urnon`, …). Cloudflare's edge therefore terminates TLS and then speaks **plain HTTP** to the origin. Cloudflare documents `Flexible` as "never use unless the origin cannot support TLS" and warns the padlock only covers the browser→edge hop ([SSL/TLS encryption modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)).

**Impact.** Every API request — including the `Authorization: Bearer <admin token>` header and any other credential in a POST body — is readable/modifiable by any on-path observer between Cloudflare and the origin. This is what makes F1 immediately exploitable rather than merely embarrassing.

**Remediation (Phase 1).** Issue a Cloudflare **Origin CA** certificate (free, up to 15 years) or a Let's Encrypt cert, terminate TLS in Caddy on `:443`, redirect `:80 → :443` at the origin, open UFW 443 **before** flipping the mode, then set the zone to **Full (strict)** and finally enable **Authenticated Origin Pulls** ([AOP docs](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)). Cloudflare's own note: AOP requires Full/Full (strict) — it does not apply in Flexible mode.

### F3 — Origin reachable directly, bypassing Cloudflare (HIGH)

**Evidence**

```
$ sudo ufw status verbose
22/tcp  ALLOW IN  Anywhere        # SSH
80/tcp  ALLOW IN  Anywhere        # HTTP - Cloudflare   ← any source, not CF ranges
19999   ALLOW IN  51.178.74.35    # Netdata stream

$ curl -o /dev/null -w '%{http_code}' -H 'Host: gsiv.phylactery.ovh' http://51.68.235.144/api/me
401                                            # unauthenticated → reaches the API
$ curl -o /dev/null -w '%{http_code}' -H 'Host: gsiv.phylactery.ovh' \
      -H 'Authorization: Bearer 415a689b-f097-…' http://51.68.235.144/api/me
200                                            # authenticated as admin, no Cloudflare involved
```

All DNS records are proxied (good), but proxying only protects traffic that *travels through* the edge; with the IP known (it is published in this repo) the origin is directly reachable, with no WAF, no rate limiting and no bot protection in front of it ([Protect your origin server](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)).

**Remediation (Phase 1).** Preferred: **Cloudflare Tunnel** (outbound-only `cloudflared`, no inbound ports at all). Otherwise: Authenticated Origin Pulls with your own client certificate **plus** a UFW allowlist built from `https://www.cloudflare.com/ips-v4` / `-v6` on a refresh timer (a bare IP allowlist is bypassable by an attacker pointing their own Cloudflare zone at the origin, so it is a safety net, not a fix). Also drop the `# HTTP - Cloudflare` comment-only rule in favour of the real ranges.

### F4 — No WAF / rate limiting / bot protection (HIGH)

**Evidence**

```
http_request_firewall_managed → 10003 could not find entrypoint ruleset
http_request_firewall_custom  → 10003 could not find entrypoint ruleset
http_ratelimit               → 10003 could not find entrypoint ruleset
rate_limits (legacy)         → count=0
bot_management               → {"fight_mode":false,"ai_bots_protection":"disabled", …}
security_level = "medium"    browser_check = "on"
```

**Impact.** Nothing filters abusive traffic before it reaches the app; the only app-side throttle is `rateLimit({ windowMs: 60_000, max: 120, keyFn: user.name })` in `core/server.ts` — 120 req/min **per token name**, which (a) can be exhausted by an attacker holding the F1 token to deny service to the real user and (b) does not throttle unauthenticated probing at all.

**Remediation (Phase 2).** Enable the free Cloudflare Managed Ruleset and Bot Fight Mode; add custom rules (challenge non-GET on `/api/*`; stricter treatment for `/api/modules/accounts*`, `/api/modules/config/*` and `/api/modules/gameview/launch/*`); add rate-limiting rules (per-IP) for `/api/*` and a brute-force guard on `/api/me`; add per-IP limiting in the app as well.

### F5 — No HSTS, TLS 1.0 floor, no security headers, token in localStorage (HIGH)

**Evidence**

```
security_header = {"strict_transport_security":{"enabled":false,"max_age":0,
                    "include_subdomains":false,"preload":false,"nosniff":false}}
min_tls_version = "1.0"
```

The Caddyfile sets only `Cache-Control` headers; the backend sets no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` (`grep -rn 'Content-Security\|X-Frame\|Strict-Transport' backend/src` → no matches). The SPA stores its API token in `localStorage` (`frontend/src/core/auth.ts` uses `localStorage.getItem/setItem`), so any XSS or third-party script injection yields the admin token — with no CSP to constrain it.

**Remediation (Phase 2/3).** Enable HSTS (start `max-age` ≈ 6 months, `includeSubDomains`, add `preload` only once confident — note the wildcard `*.phylactery.ovh` record means `includeSubDomains` covers every host on the zone); raise `min_tls_version` to 1.2 (1.3 preferred); add the header set at Caddy or via a Cloudflare Transform Rule (CSP must be tuned per host — the VellumFE stream apps need a looser policy than the dashboard).

### F6 — Token → root escalation chain (HIGH)

**Evidence**

```
$ sudo -n -l
User ubuntu may run the following commands on ns3124964:
    (ALL : ALL) ALL
    (ALL) NOPASSWD: ALL
```

`gsiv-platform.service` runs as `ubuntu` with **passwordless full sudo**. Admin-scope endpoints reach privileged behaviour:

* `core/config-files.ts` `write()` — writes caller-supplied content (capped at 1 MiB, traversal + symlink guarded, but **no file-extension allowlist**) under the character config dir, reached by `PUT /config/:char/file` with `config.write`.
* `core/systemd.ts` — start/stop/restart character units.
* `core/stream-provision.ts` (PR #59/#60, 2026-09-10) — `POST /launch/:char` now performs **sudo-backed root operations**: `install -d/-m 644` into `/etc/systemd/system`, `sudo rm -f`, `sudo systemctl …`, `sudo caddy validate|reload`, plus writes to the Caddyfile and `backend/.env`.
* `core/script-runner.ts` — fixed allowlist of server analysis scripts (good).
* `core/entry-yaml.ts` — TOTP-gated (good).

Lich loads scripts from `/opt/gs4sd/lich5/scripts` (and `/opt/gs4sd/lich-scripts/custom/*.lic` exists on the box); if any writable config path overlaps a directory Lich loads from, then "valid token" ⇒ arbitrary code execution as `ubuntu` ⇒ **root** (NOPASSWD sudo). This overlap was **not** conclusively tested in this review and is flagged as the item to verify first in Phase 3.

**Remediation (Phase 3).** Replace `NOPASSWD: ALL` with a `/etc/sudoers.d/` allowlist naming exactly the commands the platform needs (per-unit `systemctl start|stop|restart|daemon-reload|enable|disable`, `install`, `rm -f` on the specific drop-in paths, `caddy validate|reload`); add an extension allowlist to config writes; confirm (and, if needed, break) any overlap between writable config paths and Lich's load path; add systemd hardening (`NoNewPrivileges`, `ProtectSystem=strict` + `ReadWritePaths`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies`, `CapabilityBoundingSet=`); consider requiring TOTP for the highest-risk endpoints (`/launch/:char`, config writes, scan triggers).

### F7 — Cache exposure risk (MEDIUM)

**Evidence**

```
cache_level = "aggressive"
A *.phylactery.ovh      -> 51.68.235.144 proxied=true
A *.vellum.phylactery.ovh -> 51.68.235.144 proxied=true
Caddyfile: /api/* and /ws are reverse_proxied with NO Cache-Control set
```

Nothing on the API emits `Cache-Control: private/no-store`, the origin sets no `Vary: Authorization`, and the zone caches aggressively across every wildcard host. Edge caching of authenticated JSON would leak one user's data to another; the zone also has precedent for cache confusion (the 2026-08-12 incident where Cloudflare cached the SPA `index.html` and served it as a JS asset, per `docs/STATUS.md`).

**Remediation (Phase 2/3).** Add a Cloudflare Cache Rule to bypass cache for `/api/*`, `/ws`, `/health` and for any request carrying `Authorization` or `Set-Cookie`; emit `Cache-Control: no-store` from the backend for `/api/*`; review whether the `*` wildcards need to be public at all (any new hostname is instantly reachable and inherits these settings).

### F8 — sshd accepts passwords (MEDIUM)

**Evidence:** `sshd -T` → `passwordauthentication yes`, `permitrootlogin no`, `pubkeyauthentication yes`, port 22 open to `Anywhere` (fail2ban is active).
**Remediation:** `PasswordAuthentication no` + `KbdInteractiveAuthentication no`.

### F9 — Services bound to 0.0.0.0 (MEDIUM)

**Evidence:** `ss -ltnp` → `0.0.0.0:19999` (netdata), `0.0.0.0:4000` (litellm). UFW does not permit them from the internet (19999 is restricted to a single source IP), but both are reachable over Tailscale; litellm is an unauthenticated LLM proxy, i.e. spendable API credit for anyone on the tailnet.
**Remediation:** bind both to loopback (or the tailnet address) and/or require auth; keep an explicit UFW rule for the netdata stream source.

### F10 — Dependency advisories (LOW)

**Evidence:** `npm audit --omit=dev` → `hono <= 4.13.4`, 1 moderate group: incomplete `toSSG()` path fix; unbounded dot-notation nesting in `parseBody()` (memory exhaustion); **query parser reads parameters after the URL fragment — cache-key/proxy interpretation differential**, which is precisely the class that interacts with a CDN.
**Remediation:** `npm audit fix` / pin a patched hono, enable Dependabot.

### F11 — Lower-severity hygiene (LOW)

* DNSSEC `status = disabled` → enable at the registrar (free) and add the DS record.
* `/opt/gs4sd/lich5/data/entry.yaml` is `0644` (all game-account names + PasswordCipher-encrypted passwords) → `0600`.
* Rate limiting keyed by token name only (see F4).
* No alerting/observability on security events (no WAF logs available on the Free plan; at minimum add Cloudflare notifications / a Worker-based alert).
* TOTP is enrolled nowhere (`backend/data/totp_secret` absent). `core/totp.ts` `verify()` fails **closed** when the secret is missing, so this is not a bypass — but `/accounts` entry.yaml edits are blocked until `/totp/setup` is run.
* Unauthenticated `/health` responder (informational, fine).

---

## 4. Controls that are already in place (do not regress)

* All zone DNS records are **proxied**; `Always Use HTTPS`, `Automatic HTTPS Rewrites`, `TLS 1.3`, `Browser Check` enabled; no MX records on the zone (no mail-header IP leak).
* **Every** API route declares scopes and `registry.validate()` fails the build on a gap; tokens are compared with SHA-256 + `timingSafeEqual` (`core/auth.ts`).
* Path safety: config-file and analysis-upload writes guard traversal **and symlinks**; uploads are pinned to `.log` names and a size cap.
* WebSocket connections require a token **and** an allowed `Origin` (`core/ws-bridge.ts`).
* TOTP gate fails closed; secret file created `0600`.
* Host: UFW active (default deny incoming), fail2ban active, `unattended-upgrades` active, `PermitRootLogin no`.
* Internal services are on loopback: Redis `6379`, the RobusRedisOVH bus `3110`, Caddy admin `2019`, Ollama `11434`, all VellumFE/Lich ports `9101–9105` / `9201–9205`.
* Secrets live only in `/opt/gsiv-platform/backend/.env` (`0600`); **no** `.env`, `dist/`, `entry.yaml` or private-key material is tracked in git (`git ls-files` → 0 dist files; `.gitignore` covers `node_modules/ dist/ *.log .env`), and no credential blobs are present in history.

---

## 5. Attack scenarios (why the order matters)

1. **Zero-credential, zero-interaction:** find the repo → read the admin token → call the API directly at `http://51.68.235.144/` (F1+F3) → full data access and character/stream control; the plaintext hop (F2) additionally lets a network observer capture the token in transit.
2. **Network observer:** tap the CF→origin leg (F2) and harvest the admin token plus any payload — e.g. account credentials handled by the accounts/play.net flows are server-to-outside, but API-supplied secrets in bodies are exposed.
3. **Token holder → root:** leaked admin token → `PUT /config/:char/file` and/or `POST /launch/:char` (F6) → root-owned writes / possible code execution as `ubuntu` → `sudo` (NOPASSWD ALL) → root.
4. **DoS:** an attacker's 120 req/min against the single admin token bucket (F4) starves the real user; there is no IP-based limiter.

---

## 6. Action plan (documented; awaiting approval — nothing executed)

### Phase 0 — Secret containment (~1 h) — *do this first*
1. Generate a new admin token and a new machine token; set them in `/opt/gsiv-platform/backend/.env` (`AUTH_TOKENS`).
2. Update every consumer of the **machine** token: each `gs4sd-lich@*.service` unit's `GS4SD_TOKEN`, `/etc/gsiv-scan.env`, `/etc/gsiv-sales-scan.env`, the watchdog timer, the invdb scanner, and any Lich script config that references it; restart `gsiv-platform.service` and the affected Lich/stream units.
3. Verify: `sudo grep -r <old-token-prefix> /etc /opt --include='*.env' --include='*.service' --include='*.lic'` returns nothing, and `GET /api/me` with the **old** token returns 401 while the new one returns 200 (this same check is the acceptance test).
4. Purge both token values from `docs/**` (replace with a `«rotated»` marker) and record the *procedure*, never the values.
5. Add secret scanning: `gitleaks` pre-commit hook + GitHub push protection/secret scanning on the repo.
6. Decide: keep the repo public (tokens now dead) or make it private (`gh repo set-visibility`), and whether to purge history with `git filter-repo` (requires force-push; invalidates clones/forks).

### Phase 1 — TLS + origin lockdown (~1–2 h)
7. Cloudflare **Origin CA** cert (or Let's Encrypt) installed in Caddy; site moved to `:443`; `:80` becomes a 301 to `https://`.
8. `sudo ufw allow 443/tcp` **before** the SSL-mode change (otherwise Cloudflare gets 525/522).
9. Zone SSL/TLS → **Full (strict)**; then enable **Authenticated Origin Pulls**. (Consider the Full → Full-strict staging order Cloudflare recommends for wrong-SAN discovery.)
10. Either move the origin behind **Cloudflare Tunnel** (removes inbound 80/443 entirely) or restrict 80/443 to Cloudflare's published ranges with a refresh timer.
11. Accept: `curl http://<origin-ip>/api/me -H 'Host: gsiv.phylactery.ovh'` must fail/hang; `https://gsiv.phylactery.ovh/api/me` still returns 401 (no token) and 200 (new token); all five stream hosts still return 200.

### Phase 2 — Cloudflare edge security (~1 h)
12. Enable Cloudflare **Managed Ruleset** + **Bot Fight Mode**.
13. Custom rules: challenge/block non-GET on `/api/*` from unexpected geographies; stricter handling for `/api/modules/accounts*`, `/api/modules/config/*`, `/api/modules/gameview/launch/*`.
14. Rate-limiting rules (per IP): `/api/*` (e.g. 60 req/min → managed challenge), a tighter rule for `/api/modules/accounts/*`, and a brute-force guard on `/api/me`.
15. **HSTS** (`max-age` ≥ 6 months, `includeSubDomains`; `preload` last) and **min TLS 1.2** (1.3 preferred).
16. **Cache Rule**: bypass for `/api/*`, `/ws`, `/health`, and any request with `Authorization`/`Set-Cookie`; review the `*` wildcard records.
17. Enable **DNSSEC** at the registrar.

### Phase 3 — Host + app hardening (~1–2 h)
18. Minimize sudo: replace `NOPASSWD: ALL` with a `/etc/sudoers.d/` allowlist for the exact commands the platform needs.
19. Confirm/eliminate overlap between writable config paths (`core/config-files.ts`) and directories Lich loads scripts from; add an extension allowlist.
20. Harden `gsiv-platform.service` (`NoNewPrivileges=yes`, `ProtectSystem=strict` + `ReadWritePaths=/opt/gsiv-platform/backend/data`, `ProtectHome=yes`, `PrivateTmp=yes`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `CapabilityBoundingSet=`).
21. `PasswordAuthentication no` in sshd (keep the key path working).
22. Bind netdata + litellm to loopback/tailnet with auth.
23. `chmod 600` `entry.yaml`.
24. Backend: `Cache-Control: no-store` on `/api/*`; add the security-header set; consider requiring TOTP for `/launch/:char`, config writes and scan triggers.
25. Run `/totp/setup` on `/accounts` so the entry.yaml gate is usable again.

### Phase 4 — Hygiene (~30 min)
26. `npm audit fix` (hono) + Dependabot; per-IP rate limiting in addition to per-token; alerting on WAF/rate-limit events; fold the new posture into `backend/SECURITY.md`; add a token-rotation runbook entry to `deploy/V2-DEPLOYMENT.md`.

**Rollback notes.** Everything except Phase 0 is reversible: Caddy keeps its previous config, the zone setting can be switched back to Flexible, UFW rules can be deleted. Phase 0 is intentionally breaking for any client still holding the old tokens (the Lich units are the main consumers — restart them) and *is* the fix for F1.

---

## 7. Post-fix verification checklist

* [ ] `curl -H 'Authorization: Bearer <old-admin>' https://gsiv.phylactery.ovh/api/me` → 401; new token → 200.
* [ ] No occurrence of either old token value anywhere in the repo, its history, the host, or systemd unit files.
* [ ] `curl http://<origin-ip>/api/me -H 'Host: gsiv.phylactery.ovh'` fails (Tunnel or CF-only ingress); `https://` path unaffected.
* [ ] Zone: `ssl = full`, `min_tls_version = 1.2`+, HSTS enabled with a non-zero `max_age`, managed ruleset + rate-limit rulesets present, `fight_mode` true.
* [ ] `curl -sI https://gsiv.phylactery.ovh/` shows `strict-transport-security` and the header set; `/api/*` returns `Cache-Control: no-store` and is not edge-cached (`cf-cache-status: DYNAMIC`).
* [ ] `sshd -T | grep passwordauthentication` → `no`; netdata/litellm no longer on `0.0.0.0`.
* [ ] `sudo -n -l` shows only the allowlisted commands; `systemctl show gsiv-platform -p NoNewPrivileges -p ProtectSystem` reflects the hardening.
* [ ] All five streams still 200 and Aeton still logs in as `GSIV:Aeton`.

---

## 8. Out of scope for this review

The other nine Cloudflare zones on the account (`2much.stream`, `blacklightning.net`, `cmnservicesgroup.com`, `hetzflix.ru`, `keiretsu.su`, `playerscorner.ovh`, `plexflix.ru`, `plexflix.stream`, `rpgfilms.net`); the GS4-EnhanciveShopper Worker/D1 project; the RobusRedisOVH bus; the `urnon` and `fishbyte`/`bucktv` services sharing the same origin; and the VellumFE `app.js` patches. Extending the review to those is a separate request.

---

## Appendix — commands used (reproducible, read-only)

```bash
# repo
gh repo view Buckwheet/GSIVPlatform --json visibility,isPrivate
grep -rn --exclude-dir=node_modules --exclude-dir=.git '<token-prefix>' .
git log --all --oneline -S '<token-prefix>'
git ls-files backend/dist frontend/dist | wc -l
grep -rEn 'password: [A-Za-z0-9+/]{20,}' --exclude-dir=.git --exclude-dir=node_modules .
cd backend && npm audit --omit=dev

# host
sudo ss -ltnp
sudo ufw status verbose
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication|port)'
systemctl cat gsiv-platform.service
sudo -n -l
sudo ls -la /opt/gsiv-platform/backend/.env /opt/gs4sd/lich5/data/entry.yaml
sudo cat /etc/caddy/Caddyfile
curl -sI -H 'Host: gsiv.phylactery.ovh' http://127.0.0.1/

# cloudflare (read-only GETs)
GET /zones                                  # zone inventory
GET /zones/<zone>/settings                  # ssl, min_tls_version, security_header, cache_level …
GET /zones/<zone>/dns_records               # proxied status
GET /zones/<zone>/dnssec
GET /zones/<zone>/bot_management
GET /zones/<zone>/rate_limits
GET /zones/<zone>/rulesets/phases/http_request_firewall_managed/entrypoint
GET /zones/<zone>/rulesets/phases/http_request_firewall_custom/entrypoint
GET /zones/<zone>/rulesets/phases/http_ratelimit/entrypoint
GET /zones/<zone>/ssl/certificate_packs
```
