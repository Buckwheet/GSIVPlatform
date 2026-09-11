#!/usr/bin/env bash
# Build a GSIVPlatform-patched VellumFE binary FROM A PUBLIC UPSTREAM TAG.
#
# Runs on the OVH box (linux-x86_64). Builds into a NEW directory under
# /opt/vellumfe-build and NEVER touches the live tree (/opt/vellumfe) or a
# running vellum-fe@<Char> unit — stopping units and swapping the binary is a
# separate, explicit playbook step (deploy/VELLUMFE-UPGRADE.md step 6).
#
# usage: build-vellumfe.sh <tag> [patch-file] [build-root]
#   tag         upstream release tag, e.g. v0.3.0-beta.50 (must exist upstream)
#   patch-file  default /tmp/gsiv-webui.patch (repo: deploy/vellumfe/gsiv-webui.patch)
#   build-root  default /opt/vellumfe-build
#
# Success prints one greppable line:
#   BUILD-OK tag=<tag> version=<v> sha256=<hash> pristine_appjs=<h> patched_appjs=<h> binary=<path>
# (both app.js hashes are provenance: GitHub tag archives are NOT immutable — see below)
set -euo pipefail

TAG="${1:?usage: build-vellumfe.sh <tag> [patch-file] [build-root]}"
PATCH_FILE="${2:-/tmp/gsiv-webui.patch}"
BUILD_ROOT="${3:-/opt/vellumfe-build}"
SRC="$BUILD_ROOT/$TAG"
UPSTREAM="https://github.com/Nisugi/VellumFE"

say() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$PATCH_FILE" ] || die "patch file not found: $PATCH_FILE"
[ -f "$HOME/.cargo/env" ] || die "no rust toolchain at \$HOME/.cargo/env — see VELLUMFE-UPGRADE.md §Prereqs"
# shellcheck disable=SC1091
. "$HOME/.cargo/env"

say "unpacking $UPSTREAM @ $TAG"
rm -rf "$SRC"
mkdir -p "$SRC"
curl -fsSL "$UPSTREAM/archive/refs/tags/$TAG.tar.gz" | tar xz -C "$SRC" --strip-components=1
[ -f "$SRC/Cargo.toml" ] || die "tarball did not unpack a Cargo.toml (does tag $TAG exist upstream?)"

SRC_VERSION="$(grep -m1 '^version' "$SRC/Cargo.toml" | cut -d'"' -f2)"
say "source version: $SRC_VERSION"
[ "$SRC_VERSION" = "${TAG#v}" ] || die "tag $TAG does not match source version $SRC_VERSION — wrong tag?"

# Provenance. GitHub tag archives are NOT immutable: on 2026-09-11 this exact
# tag URL returned a 326 KB app.js, then 317 KB minutes later. So record the
# hash of the file we actually patched; if it differs from a previous build of
# the same tag (or from deploy/VELLUMFE-UPGRADE.md §2.3), stop and check what
# moved instead of assuming our patch went stale.
APPJS="$SRC/src/frontend/web/assets/app.js"
PRISTINE_HASH="$(sha256sum "$APPJS" | cut -d' ' -f1)"
say "pristine app.js sha256: $PRISTINE_HASH"

say "applying GSIV web-UI patch: $PATCH_FILE"
# git apply (not patch(1)): no fuzz — a changed upstream app.js fails loudly.
( cd "$SRC" && git apply -p1 "$PATCH_FILE" ) \
  || die "patch did not apply to $TAG — port it (VELLUMFE-UPGRADE.md step 3), then re-run"
for marker in 'let autoConnectLich = false;' 'let zeroClickConnecting = false;'; do
  grep -qF "$marker" "$APPJS" || die "marker missing after apply: $marker"
done
PATCHED_HASH="$(sha256sum "$APPJS" | cut -d' ' -f1)"
say "patched app.js sha256: $PATCHED_HASH"
say "patch markers verified (autoConnectLich + zeroClickConnecting)"

say "cargo build --release — 15-25 min; live streams keep running while this builds"
( cd "$SRC" && cargo build --release )

BIN="$SRC/target/release/vellum-fe"
[ -x "$BIN" ] || die "expected binary not found: $BIN"
VERSION="$("$BIN" --version)"
HASH="$(sha256sum "$BIN" | cut -d' ' -f1)"
printf 'BUILD-OK tag=%s version=%s sha256=%s pristine_appjs=%s patched_appjs=%s binary=%s\n' \
  "$TAG" "$VERSION" "$HASH" "$PRISTINE_HASH" "$PATCHED_HASH" "$BIN"
