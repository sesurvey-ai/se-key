#!/usr/bin/env bash
# Build a deploy zip for Windows. Run on the Mac dev machine.
# Output: se-key-deploy-YYYYMMDD-HHMM.zip (one level up from repo root)

set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="../se-key-deploy-${STAMP}.zip"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[fail ]\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Refuse to run if a server is listening on :3100 — WAL would be inconsistent.
if lsof -i :3100 >/dev/null 2>&1; then
  warn "server is running on port 3100. Stop it first:"
  warn "  pkill -f 'node.*server.js'    # or kill by PID"
  fail "aborting to avoid WAL inconsistency"
fi

# 2. Sanity checks — required artifacts.
[[ -f server/data.db   ]] || fail "server/data.db missing"
[[ -f server/.env      ]] || fail "server/.env missing"
[[ -f server/package.json ]] || fail "server/package.json missing"

# 3. Checkpoint WAL so data.db is self-contained.
log "checkpointing WAL..."
sqlite3 server/data.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null

# 4. Stats.
DB_ROWS=$(sqlite3 server/data.db "SELECT COUNT(*) FROM records;")
DB_SIZE=$(du -h server/data.db | awk '{print $1}')
log "DB: ${DB_ROWS} rows, ${DB_SIZE}"

# 5. Build zip. Exclude things that should be regenerated on Windows.
log "creating ${OUT}..."
rm -f "${OUT}"
zip -qr "${OUT}" \
  server/ \
  se-key-extension/ \
  README.md \
  -x 'server/node_modules/*' \
     'server/logs/*' \
     'server/.DS_Store' \
     'server/*.db-shm' \
     'server/*.db-wal' \
     'server/*.bak*' \
     '**/.DS_Store' \
     'se-key-extension/.DS_Store'

# 6. Report.
OUT_SIZE=$(du -h "${OUT}" | awk '{print $1}')
log "done: ${OUT} (${OUT_SIZE})"
log ""
log "contents summary:"
unzip -l "${OUT}" | awk 'NR>3 && NF>=4 {print}' | head -30
COUNT=$(unzip -l "${OUT}" | awk 'END{print $2}')
log "total entries: ${COUNT}"
log ""
log "next: copy ${OUT} to Windows, extract to C:\\se-key\\, then:"
log "  cd C:\\se-key\\server"
log "  npm install"
log "  node --env-file=.env src/server.js"
