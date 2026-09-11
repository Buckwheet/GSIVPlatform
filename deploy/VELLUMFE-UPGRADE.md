# VellumFE upgrade playbook — new upstream release → OVH box

> **Read this when the dashboard says a new VellumFE release is out.**
> Companion artifacts: `deploy/vellumfe/gsiv-webui.patch` (the exact delta we
> carry), `deploy/vellumfe/build-vellumfe.sh` (box-side build).
> Runtime/deploy context: `deploy/V2-DEPLOYMENT.md` §VellumFE.

**Last run:** 2026-08-11 (hand-built, undocumented) — the box runs a
**`0.3.0-beta.37`** binary built by hand from source with two hand-edited
web-UI patches. Those patches are now captured as the patch artifact above
(verified byte-identical, sha256 `6f2a408f…`).

---

## 1. The loop

1. Upstream `Nisugi/VellumFE` publishes a **pre-release** (they are all marked
   Pre-release, so `/releases/latest` never matches — the checker lists and
   sorts releases, `vX.Y.Z-beta.N`).
2. The platform's `updates` check compares that tag with the deployed version
   and files a **notification in the dashboard 🔔 bell** that stays unread until
   acked.
3. You come here, we run this playbook, then ack the bell.

Manual check, any time:

```bash
gh release list -R Nisugi/VellumFE --limit 5                    # what upstream published
ssh ubuntu@51.68.235.144 '/opt/vellumfe/vellum-fe --version'     # what the box runs
cd "D:/GSIV Development/VellumFE" && git fetch upstream && git describe --tags upstream/main
```

---

## 2. What we take from a release (and what we don't)

A VellumFE release ships Linux/macOS/Windows/Android/iOS binaries. We take
**one artifact**, rebuilt on the box:

| Take | Why |
|---|---|
| `/opt/vellumfe-build/<tag>/target/release/vellum-fe` → `/opt/vellumfe/vellum-fe` | The only thing that ships. ~63 MB, linux-x86_64, **all** web assets (incl. `app.js`) are compiled into it. |
| its `--version` string | Recorded as `VELLUM_VERSION` in the server `.env`; this is what the bell compares against. |
| the rebuilt `app.js` inside it | Because it carries our two patches (§2.2). |

| Do **not** take | Why |
|---|---|
| the release's own `vellum-fe-linux-x86_64.tar.gz` | Stock: **no zero-click Watch connect**. Useful only as a diagnostic/rollback to answer "is this bug ours or upstream's". |
| the repo's Rust source into our tree | We carry **no** Rust changes. Our delta is confined to the embedded web UI. |
| `SHA256SUMS.txt` from the release | Covers *their* assets, not our patched build. Ours is verified by `--version` + the bytes we built. |
| macOS/Windows/Android/iOS assets | The box is headless Linux. |
| config / data | `~/.vellum-fe` on the box (pairing token, saved profiles) and the systemd/Caddy wiring are **not** touched by an upgrade. |

### 2.1 The seam, as it exists today

| Piece | Value |
|---|---|
| Binary | `/opt/vellumfe/vellum-fe` (currently `vellum-fe 0.3.0-beta.37`) |
| Build source (historical) | `/opt/vellumfe-src` — shallow upstream clone @ `526b263`, hand-patched `app.js` |
| Stream unit | `/etc/systemd/system/vellum-fe@.service` (template) + per-char drop-ins `vellum-fe@<Char>.service.d/` |
| Streamed chars | **discover, don't assume:** `ssh ubuntu@51.68.235.144 "ls -d /etc/systemd/system/vellum-fe@*.service.d"` (4 as of 2026-08-11: Aeton, Diynasta, Neleourg, Vaikar) |
| Ports | detach `910X`, web `920X`, per char (`VELLUM_STREAMS` in the server `.env`) |
| Public URL | `https://<char>.phylactery.ovh/play#token=…&lich=127.0.0.1:<detach>&name=<Char>` via Caddy (`vellum.phylactery.ovh` carries basic_auth) |
| Platform seam | backend module `gameview` (`VELLUM_BASE_URL`, `VELLUM_STREAM_DOMAIN`, `VELLUM_STREAMS`, `VELLUM_TOKEN`, scope `gameview.read`) |

**Versions as of 2026-09-11:** box `0.3.0-beta.37` · upstream latest
`v0.3.0-beta.50` (pre-release, published 2026-09-09) · local fork `0.3.0-beta.44`
→ the box is **13 releases behind**, so the 🔔 alert should already be showing it.

### 2.2 Our carried delta — `gsiv-webui.patch` (5 hunks, ~40 lines)

Both patches live in upstream's `src/frontend/web/assets/app.js`, which is
**embedded in the binary** — hence "change the web UI" means "rebuild the
binary":

1. **Zero-click Lich attach** (`autoConnectLich`) — from a `#lich=host:port&name=Char`
   deep link the UI connects by itself. Without it the dashboard Watch flow
   needs a manual Connect click per tab.
2. **No login-form flash** (`zeroClickConnecting`) — while that connect is in
   flight the attach form stays hidden and a "Connecting to the game…" status
   shows; on failure the form comes back (never stranded).

Upstream will **not** fold these in: `app.js` says it deliberately keeps deep
links "prefill only — never auto-connect, so a malicious QR can't point the app
at an attacker's socket unseen". This divergence is permanent; re-apply per
release.

### 2.3 Known-good hashes (provenance)

| File | sha256 | Size |
|---|---|---|
| `app.js` as deployed (upstream `526b263` + patch) | `6f2a408fe3de1aaaea3c63169f3ee3348422dc86b48b4729a794cd9e8d187a59` | 294,784 B |
| upstream `app.js` @ `526b263` (pre-patch) | `009bc3ee5f9ad44c5cf099573c01c662852a32e01396e0fa548b35f09ec35413` | 292,949 B |
| upstream `app.js` @ tag `v0.3.0-beta.50` (pre-patch, checked 2026-09-11) | `52892d9e304329da2b0e7284f8e8777388d5995a3ea18d5c404d268f14881f31` | 317,961 B |

**Verified 2026-09-11:** the current patch still applies to `v0.3.0-beta.50`
unchanged (`Hunk #2/#3/#4 succeeded at +64 lines`) — upstream grew `app.js`
*above* our anchors but left the context intact, so a beta.50 upgrade needs
**no porting** (§3's merge is a no-op; result 319,796 B, 4 × `autoConnectLich`
+ 5 × `zeroClickConnecting`).

**Do not treat a tag as immutable.** On 2026-09-11 the same
`.../archive/refs/tags/v0.3.0-beta.50.tar.gz` URL served a **326 KB** `app.js`
and then a **317 KB** one minutes later. Always compare the `pristine_appjs=`
hash printed by §5 with the row above (or with the previous build of that
tag); if it moved, upstream re-cut or force-moved the tag — decide whether to
build the new bytes or pin the tag's commit SHA first.

---

## 3. Port the patch to the new tag (authoring side, this machine)

Our canonical authoring place is the fork `Buckwheet/VellumFE`, branch `gsiv`
(Nisugi's repo is the `upstream` remote). The fork is **private** — the box
cannot clone it — so what travels to the server is the *exported patch*, never
the fork.

```bash
cd "D:/GSIV Development/VellumFE"
git fetch upstream --tags
git switch gsiv
git merge <new-tag>                       # e.g. v0.3.0-beta.50
#   clean merge  -> nothing to do
#   conflict in src/frontend/web/assets/app.js -> re-apply the two features
#   (autoConnectLich, zeroClickConnecting) onto upstream's new code; keep the
#   GSIVPlatform: comments so the next port is obvious.
git diff <new-tag> -- src/frontend/web/assets/app.js > /tmp/gsiv-webui.patch
git commit && git push                    # branch gsiv, never main
```

Then refresh the artifact in this repo (this is the file the box applies):

```bash
cp /tmp/gsiv-webui.patch "D:/Code Projects/GSIVPlatform/deploy/vellumfe/gsiv-webui.patch"
```

**Release review checklist** (read `git log <old-tag>..<new-tag> --oneline` and
the web-asset diff before building):

- Does `app.js` still parse `#lich=` / `#token=` the same way (fragment shape,
  `name=` param)? A rename silently breaks every Watch link.
- Did upstream add its own auto-connect / "connect on deep link" option? Then
  **drop patch 1** and re-derive, rather than fighting it.
- Did `setSession()` / `updateSessionUiInner()` / `SESSION_PROGRESS` move or get
  renamed? That is what patch 2 hooks into.
- Did the detach/Lich-attach affordance or the `.webinfo` pairing URL change?
  (Upstream `docs/lich-remote-connect-plan.md`.)
- Does `vellum-fe --version` still print `vellum-fe <semver>`? The bell's
  comparison depends on it.

## 4. Prereqs on the box (one-time — already done for beta.37)

```bash
sudo apt-get install -y build-essential pkg-config perl curl libasound2-dev \
  libudev-dev libspeechd-dev clang libclang-dev libspeechd2 libasound2t64
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
```

Disk: each unpacked source tree is ~1.8 GB (observed for beta.50) plus
`target/`; `/opt` had 155 GB free. Prune old `/opt/vellumfe-build/<tag>` trees
when convenient.

## 5. Build (box side — no downtime, live streams keep running)

```bash
scp deploy/vellumfe/gsiv-webui.patch deploy/vellumfe/build-vellumfe.sh ubuntu@51.68.235.144:/tmp/
ssh ubuntu@51.68.235.144 'chmod +x /tmp/build-vellumfe.sh && \
  sudo mkdir -p /opt/vellumfe-build && sudo chown ubuntu:ubuntu /opt/vellumfe-build && \
  /tmp/build-vellumfe.sh v0.3.0-beta.NN'
```

Success ends with one line to record:

```
BUILD-OK tag=v0.3.0-beta.NN version=vellum-fe 0.3.0-beta.NN sha256=<hash> pristine_appjs=<hash> patched_appjs=<hash> binary=/opt/vellumfe-build/v0.3.0-beta.NN/target/release/vellum-fe
```

If it fails at `applying GSIV web-UI patch`, upstream moved `app.js` — go back
to §3 and port it. **Never** fall back to patching by hand on the box: that is
how the two patches ended up living only in a backup file.

## 6. Swap + restart  ⚠️ approval gates

**Get the user's go-ahead first.** Restarting a unit drops that character's
stream for a few seconds; per standing rules **test only on Fisternar/Neleourg**
and **Amn is off-limits** for any testing.

```bash
ssh ubuntu@51.68.235.144
CHARS="$(ls -d /etc/systemd/system/vellum-fe@*.service.d | sed 's#.*vellum-fe@##;s#\.service\.d##')"
UNITS="$(for c in $CHARS; do echo vellum-fe@$c; done)"
OLD="$(/opt/vellumfe/vellum-fe --version | awk '{print $2}')"       # e.g. 0.3.0-beta.37

sudo systemctl stop $UNITS                                          # binary is busy while running
sudo cp /opt/vellumfe/vellum-fe /opt/vellumfe/vellum-fe.bak-$OLD    # rollback point
sudo cp /opt/vellumfe-build/v0.3.0-beta.NN/target/release/vellum-fe /opt/vellumfe/vellum-fe
sudo chown ubuntu:ubuntu /opt/vellumfe/vellum-fe
sudo systemctl start $UNITS
/opt/vellumfe/vellum-fe --version                                   # must print the new tag
```

## 7. Verify

```bash
# a) public page still serves the full app shell (not a 0-byte body)
curl -s -o /dev/null -w '%{size_download}\n' https://<char>.phylactery.ovh/play    # ≈19471
# b) every unit active, every web port listening
systemctl is-active $(for c in $CHARS; do echo vellum-fe@$c; done); ss -ltn | grep 920
# c) OUR patches are in the shipped bytes
strings /opt/vellumfe/vellum-fe | grep -c 'Connecting to the game…'   # >0
strings /opt/vellumfe/vellum-fe | grep -c 'zeroClickConnecting'       # >0
```

d) In a browser, open a Watch link from the dashboard: it must connect with
**zero clicks** and show no login-form flash. **Hard refresh / incognito** —
vellum-fe serves the embedded assets with `cache-control: max-age=14400`, so a
stale tab keeps the old UI for up to 4h and looks like a failed upgrade.

e) Confirm the detach attach really happened (`journalctl -u vellum-fe@<Char> -n 50`).

## 8. Record + ack

```bash
ssh ubuntu@51.68.235.144 "sudo sed -i 's#^VELLUM_VERSION=.*#VELLUM_VERSION=0.3.0-beta.NN#' \
  /opt/gsiv-platform/backend/.env || echo VELLUM_VERSION=0.3.0-beta.NN | sudo tee -a /opt/gsiv-platform/backend/.env; \
  sudo systemctl restart gsiv-platform"
```

Then ack the bell in the dashboard; the next check should report no update
available. Finally update this file's **Last run** line, the VellumFE version
noted in `docs/STATUS.md` §5, and the backup trail below.

## 9. Rollback

```bash
sudo systemctl stop $UNITS
sudo cp /opt/vellumfe/vellum-fe.bak-<old-tag> /opt/vellumfe/vellum-fe
sudo systemctl start $UNITS
# and restore VELLUM_VERSION in the server .env + restart gsiv-platform
```

Instant, because the previous binary is kept in place. Backup trail on the box:
`vellum-fe.bak-beta37` (stock, unpatched), `vellum-fe.bak-2026-08-12` (patch 1
only), `vellum-fe.bak-<old-tag>` (each playbook run). Keep the last two.

## 10. Gotchas already paid for

- **4h asset cache** (above) — "the fix didn't work" is usually a cached tab.
- **Copy the binary only while stopped** — `cp` over a running binary fails with
  "text file busy".
- **Caddy per-char blocks must be top-level siblings** (one tab indent). A
  nested `handle` still passes `caddy validate` but serves an empty body; after
  any Caddy edit verify the public `/play` byte size, not just locally.
- **`#lich=`, not `#rhost=`** in stream URLs — `rhost/rport` prefills the Remote
  tab, not the Lich tab, so zero-click silently never fires.
- **The pairing token is per data dir** (`~/.vellum-fe`) and is reused as-is by
  an upgrade; if a stream ever prompts for pairing, the token in `VELLUM_TOKEN`
  / the `#token=` fragment mismatches the data dir.
- **`/opt/vellumfe-src` is historical** after the first playbook run — builds
  happen in `/opt/vellumfe-build/<tag>`. Keep the old tree until one upgraded
  binary has been verified end-to-end, then it can go.
- **Tag archives can change under you** (§2.3) — always read the
  `pristine_appjs=` hash the build prints, and compare it with the previous
  build of the same tag before you swap the binary in.
