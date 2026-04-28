#!/usr/bin/env bash
# Build a Chrome Web Store submission zip for eclaim3-extension/.
# manifest.json must be at the ROOT of the zip (CWS requirement).
# Output: eclaim3-extension-vX.Y.Z.zip in repo root.

set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
SRC="${ROOT}/eclaim3-extension"

log()  { printf '\033[1;34m[ext-zip]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail   ]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -d "$SRC" ]] || fail "missing folder: $SRC"
[[ -f "$SRC/manifest.json" ]] || fail "missing $SRC/manifest.json"

VERSION=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -n1)
[[ -n "$VERSION" ]] || fail "could not read version from manifest.json"

OUT="${ROOT}/eclaim3-extension-v${VERSION}.zip"
rm -f "$OUT"

log "version: ${VERSION}"
log "creating ${OUT}..."

# Zip the *contents* of eclaim3-extension/ so manifest.json lands at zip root.
# Exclude repo-only docs and OS junk that should not ship in the package.
( cd "$SRC" && zip -qr "$OUT" . \
    -x 'README.md' \
       'PRIVACY.md' \
       'STORE_LISTING.md' \
       '.DS_Store' \
       '**/.DS_Store' \
       '*.bak' \
       '*.bak.*' )

# Sanity: manifest.json must be at zip root.
if ! unzip -l "$OUT" | awk '{print $4}' | grep -qx 'manifest.json'; then
  fail "manifest.json not at zip root — Chrome Web Store will reject"
fi

OUT_SIZE=$(du -h "$OUT" | awk '{print $1}')
log "done: ${OUT} (${OUT_SIZE})"
log ""
log "contents:"
unzip -l "$OUT" | awk 'NR>3 && NF>=4 {print "  " $4}' | grep -v '^  $'
log ""
log "next: upload at https://chrome.google.com/webstore/devconsole"
