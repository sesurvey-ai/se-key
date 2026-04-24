# ============================================================
# se-key production DB REBUILD — run on 192.168.4.122
#
# Use when index-only corruption cannot be fixed in-place
# (fix-indexes-on-prod.ps1 exited because writable_schema is
# blocked). Strategy: copy all table rows to a fresh DB via a
# rowid scan (bypasses corrupted indexes), recreate indexes
# clean on the new DB, then swap files atomically.
#
# Safe because the source DB is opened read-only — the original
# file is never written to and is renamed to `.corrupted.<ts>`
# after the swap, not deleted.
#
# Paste into PowerShell (Run as Administrator) on prod.
# ============================================================

$ErrorActionPreference = 'Stop'

# --- 1. Locate server dir ---------------------------------
$candidates = @(
  'C:\se-key\server',
  'C:\Users\i9\Desktop\se-key\server',
  'D:\se-key\server'
)
$ServerDir = $candidates | Where-Object { Test-Path (Join-Path $_ 'src\server.js') } | Select-Object -First 1
if (-not $ServerDir) {
  Write-Host '[rebuild] ไม่เจอ server dir' -ForegroundColor Red
  exit 1
}
Write-Host "[rebuild] server dir = $ServerDir" -ForegroundColor Cyan

# --- 2. Stop service --------------------------------------
$svc = Get-Service -Name 'se-key' -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "[rebuild] stopping service 'se-key' (status=$($svc.Status))..." -ForegroundColor Cyan
  if ($svc.Status -ne 'Stopped') { Stop-Service -Name 'se-key' -Force }
  Start-Sleep -Seconds 2
  $svc.Refresh()
  Write-Host "[rebuild] service status = $($svc.Status)" -ForegroundColor Cyan
}

# --- 3. Write rebuild-db.js -------------------------------
$rebuildJs = @'
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SE_KEY_DB || path.join(__dirname, '..', 'data.db');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function log(step, msg) { console.log(`[rebuild] ${step}: ${msg}`); }

if (!fs.existsSync(DB_PATH)) { console.error(`[rebuild] DB not found: ${DB_PATH}`); process.exit(1); }

const TS = stamp();
const NEW_PATH = `${DB_PATH}.new.${TS}`;
const OLD_PATH = `${DB_PATH}.corrupted.${TS}`;

if (fs.existsSync(NEW_PATH)) fs.unlinkSync(NEW_PATH);

// --- Open source read-only (corrupt DB, NEVER written) ---
log('open', `source ${path.basename(DB_PATH)} read-only`);
const src = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// Get CREATE TABLE SQL for `records` from source schema.
const tableRow = src.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='records'").get();
if (!tableRow || !tableRow.sql) {
  console.error('[rebuild] FATAL: records table not found in source schema');
  src.close();
  process.exit(1);
}
const tableSql = tableRow.sql;
log('schema', 'found records CREATE TABLE');

const cols = src.prepare('PRAGMA table_info(records)').all().map((c) => c.name);
log('schema', `${cols.length} columns: ${cols.join(', ')}`);

const oldCount = src.prepare('SELECT COUNT(*) AS c FROM records').get().c;
log('scan', `source rows: ${oldCount}`);

// --- Create fresh destination DB ------------------------
log('create', `new DB at ${path.basename(NEW_PATH)}`);
const dst = new Database(NEW_PATH);
dst.pragma('journal_mode = WAL');
dst.pragma('synchronous = NORMAL');
dst.exec(tableSql);
// Match the runtime pragmas used by server/src/db.js so new DB boots identically.

// --- Copy rows via rowid scan (bypasses ALL indexes) ----
log('copy', 'streaming rows (ORDER BY rowid) — index-free scan...');
const selectStmt = src.prepare('SELECT * FROM records ORDER BY rowid');
const colList = cols.map((c) => `"${c}"`).join(', ');
const placeholders = cols.map((c) => `@${c}`).join(', ');
const insertStmt = dst.prepare(`INSERT INTO records (${colList}) VALUES (${placeholders})`);

const insertBatch = dst.transaction((rows) => {
  for (const row of rows) insertStmt.run(row);
});

let copied = 0;
let skipped = 0;
let batch = [];
const BATCH_SIZE = 5000;
const t0 = Date.now();
const iter = selectStmt.iterate();
while (true) {
  let row;
  try {
    const next = iter.next();
    if (next.done) break;
    row = next.value;
  } catch (e) {
    // Individual row read failed — corrupted table page. Skip and continue.
    skipped++;
    log('copy', `  row read error at ~${copied + skipped}: ${e.code || e.message} — skipping`);
    continue;
  }
  batch.push(row);
  copied++;
  if (batch.length >= BATCH_SIZE) {
    insertBatch(batch);
    batch = [];
    if (copied % 50000 === 0) {
      const pct = ((copied / oldCount) * 100).toFixed(1);
      log('copy', `  ${copied} / ${oldCount} rows (${pct}%)`);
    }
  }
}
if (batch.length > 0) insertBatch(batch);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
log('copy', `done: ${copied} copied, ${skipped} skipped, ${elapsed}s`);

// --- Recreate indexes on new DB ------------------------
log('index', 'creating 4 indexes on clean DB...');
for (const sql of [
  'CREATE INDEX idx_records_claim_no  ON records(claim_no)',
  'CREATE INDEX idx_records_survey_no ON records(survey_no)',
  'CREATE INDEX idx_records_created   ON records(created_at)',
  'CREATE INDEX idx_records_pending   ON records(isurvey_sent, work_type)',
]) {
  const t = Date.now();
  log('index', `  ${sql}`);
  dst.exec(sql);
  log('index', `    done in ${Date.now() - t} ms`);
}

// --- Verify new DB --------------------------------------
log('check', 'integrity_check on NEW DB');
const integ = dst.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join('; ');
console.log('          ', integ);
const newCount = dst.prepare('SELECT COUNT(*) AS c FROM records').get().c;
const p0 = dst.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 0').get().c;
const p1 = dst.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 1').get().c;
log('verify', `old=${oldCount}  new=${newCount}  lost=${oldCount - newCount}  รอส่ง=${p0}  ส่งแล้ว=${p1}`);

// Close both connections before file swap (Windows locks).
dst.close();
src.close();

if (integ !== 'ok') {
  console.error(`[rebuild] FAILED - new DB integrity_check = ${integ}`);
  console.error(`[rebuild] New DB left at: ${NEW_PATH}`);
  console.error('[rebuild] Source DB untouched. Service NOT restarted.');
  process.exit(2);
}

// --- Swap files -----------------------------------------
log('swap', `rename ${path.basename(DB_PATH)} -> ${path.basename(OLD_PATH)}`);
fs.renameSync(DB_PATH, OLD_PATH);
for (const ext of ['-wal', '-shm']) {
  const p = DB_PATH + ext;
  if (fs.existsSync(p)) {
    const oldStranded = `${OLD_PATH}${ext}`;
    try { fs.renameSync(p, oldStranded); } catch { /* ignore */ }
  }
}
log('swap', `rename ${path.basename(NEW_PATH)} -> ${path.basename(DB_PATH)}`);
fs.renameSync(NEW_PATH, DB_PATH);

const lostPct = oldCount > 0 ? ((skipped / oldCount) * 100).toFixed(3) : '0';
console.log(`[rebuild] SUCCESS — DB rebuilt clean. Kept ${copied}/${oldCount} rows (lost ${skipped}, ${lostPct}%).`);
console.log(`[rebuild] Old corrupted DB preserved as: ${path.basename(OLD_PATH)}`);
'@
$RebuildPath = Join-Path $ServerDir 'src\rebuild-db.js'
Set-Content -Path $RebuildPath -Value $rebuildJs -Encoding utf8
Write-Host "[rebuild] wrote $RebuildPath" -ForegroundColor Cyan

# --- 4. Run rebuild ---------------------------------------
Write-Host '[rebuild] running rebuild... (อาจใช้เวลา 2-5 นาที สำหรับ 320k rows)' -ForegroundColor Cyan
Push-Location $ServerDir
try {
  $node = 'C:\Program Files\nodejs\node.exe'
  if (-not (Test-Path $node)) { $node = 'node' }
  & $node 'src\rebuild-db.js'
  $exit = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exit -ne 0) {
  Write-Host "[rebuild] rebuild FAILED (exit=$exit). Service ยังไม่ start" -ForegroundColor Red
  Write-Host '[rebuild] DB เดิมยังอยู่สภาพเดิมไม่ถูกแตะ (เปิด read-only เท่านั้น)' -ForegroundColor Yellow
  exit $exit
}

# --- 5. Start service -------------------------------------
if ($svc) {
  Write-Host "[rebuild] starting service 'se-key'..." -ForegroundColor Cyan
  Start-Service -Name 'se-key'
  Start-Sleep -Seconds 2
  $svc.Refresh()
  Write-Host "[rebuild] service status = $($svc.Status)" -ForegroundColor Cyan
}

Write-Host '[rebuild] เสร็จแล้ว — ลองเปิด http://192.168.4.122:3100/admin/ กดตัวกรอง ส่งแล้ว/รอส่ง' -ForegroundColor Green
Write-Host '[rebuild] ถ้าใช้งานได้ปกติ 1-2 วัน แล้วค่อยลบไฟล์ data.db.corrupted.* และ data.db.bak.* เพื่อคืนพื้นที่' -ForegroundColor Gray
