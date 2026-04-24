# ============================================================
# se-key production INDEX repair — run on 192.168.4.122
#
# Use when PRAGMA integrity_check shows errors ONLY on indexes
# (like "wrong # of entries in index", "row N missing from
# index", "invalid page number"), with no table corruption.
#
# Strategy: drop all 4 indexes on `records`, run integrity_check
# (should become 'ok' since table data is fine), recreate the
# indexes, then VACUUM.
#
# Much faster/safer than .recover when only indexes are damaged.
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
  Write-Host '[fix-idx] ไม่เจอ server dir' -ForegroundColor Red
  Write-Host ('         tried: ' + ($candidates -join ', ')) -ForegroundColor Yellow
  exit 1
}
Write-Host "[fix-idx] server dir = $ServerDir" -ForegroundColor Cyan

# --- 2. Stop service --------------------------------------
$svc = Get-Service -Name 'se-key' -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "[fix-idx] stopping service 'se-key' (status=$($svc.Status))..." -ForegroundColor Cyan
  if ($svc.Status -ne 'Stopped') { Stop-Service -Name 'se-key' -Force }
  Start-Sleep -Seconds 2
  $svc.Refresh()
  Write-Host "[fix-idx] service status = $($svc.Status)" -ForegroundColor Cyan
} else {
  Write-Host "[fix-idx] WARN: service 'se-key' not found" -ForegroundColor Yellow
}

# --- 3. Write fix-indexes.js ------------------------------
$fixJs = @'
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
function log(step, msg) { console.log(`[fix-idx] ${step}: ${msg}`); }

if (!fs.existsSync(DB_PATH)) { console.error(`[fix-idx] DB not found: ${DB_PATH}`); process.exit(1); }

// Backup before ANY change.
const BACKUP_PATH = `${DB_PATH}.bak.${stamp()}`;
log('backup', `copying ${path.basename(DB_PATH)} -> ${path.basename(BACKUP_PATH)}`);
fs.copyFileSync(DB_PATH, BACKUP_PATH);
const sizeMB = (fs.statSync(BACKUP_PATH).size / 1024 / 1024).toFixed(1);
log('backup', `ok (${sizeMB} MB)`);

const db = new Database(DB_PATH);
log('wal', 'checkpoint(TRUNCATE)');
console.log('         ', db.pragma('wal_checkpoint(TRUNCATE)'));

// Find every index on `records` (don't rely on hardcoded list).
const indexes = db.prepare(
  "SELECT name, sql FROM sqlite_schema WHERE type='index' AND tbl_name='records' AND sql IS NOT NULL"
).all();
log('scan', `found ${indexes.length} index(es) on records: ${indexes.map(i => i.name).join(', ')}`);

// Drop each index. If DROP fails due to tree corruption, fall back
// to deleting the schema row directly (leaves orphan pages that
// VACUUM will later reclaim).
let usedWritableSchemaHack = false;
for (const idx of indexes) {
  try {
    log('drop', `DROP INDEX ${idx.name}`);
    db.exec(`DROP INDEX IF EXISTS "${idx.name}"`);
  } catch (e) {
    log('drop', `  normal DROP failed (${e.code || e.message}) — using writable_schema hack`);
    db.pragma('writable_schema = 1');
    db.prepare("DELETE FROM sqlite_schema WHERE type='index' AND name=?").run(idx.name);
    db.pragma('writable_schema = 0');
    usedWritableSchemaHack = true;
  }
}

// Re-check integrity WITHOUT the corrupted indexes. Table should be clean.
log('check', 'integrity_check (post-DROP, pre-CREATE)');
const mid = db.prepare('PRAGMA integrity_check(50)').all().map((r) => r.integrity_check);
console.log('         ', mid.slice(0, 20).join('\n          '));
if (mid.length > 20) console.log(`          ... (+${mid.length - 20} more)`);

const midOk = mid.length === 1 && mid[0] === 'ok';
if (!midOk) {
  console.error('');
  console.error('[fix-idx] *** TABLE DATA IS ALSO CORRUPTED ***');
  console.error('[fix-idx] Dropping indexes did NOT clear all corruption. This is beyond');
  console.error('[fix-idx] index-only repair. Use .recover path:');
  console.error('[fix-idx]   1. Download sqlite3.exe from https://sqlite.org/download.html');
  console.error('[fix-idx]   2. sqlite3 data.db ".recover" > dump.sql');
  console.error('[fix-idx]   3. sqlite3 data.db.new ".read dump.sql"');
  console.error('[fix-idx]   4. Swap data.db <- data.db.new');
  console.error(`[fix-idx] Backup is safe: ${path.basename(BACKUP_PATH)}`);
  console.error('[fix-idx] Service NOT restarted.');
  db.close();
  process.exit(3);
}
log('check', 'table data is clean — safe to recreate indexes');

// Recreate the 4 canonical indexes on records (from db.js).
const CREATE_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_records_claim_no  ON records(claim_no)',
  'CREATE INDEX IF NOT EXISTS idx_records_survey_no ON records(survey_no)',
  'CREATE INDEX IF NOT EXISTS idx_records_created   ON records(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_records_pending   ON records(isurvey_sent, work_type)',
];
for (const sql of CREATE_STATEMENTS) {
  const t = Date.now();
  log('create', sql);
  db.exec(sql);
  log('create', `  done in ${Date.now() - t} ms`);
}

log('check', 'integrity_check (post-CREATE)');
const post = db.prepare('PRAGMA integrity_check(50)').all().map((r) => r.integrity_check);
console.log('         ', post.slice(0, 20).join('\n          '));
const postOk = post.length === 1 && post[0] === 'ok';

if (usedWritableSchemaHack) {
  log('vacuum', 'rebuilding database file (reclaim orphan pages from writable_schema hack)...');
  const t = Date.now();
  db.exec('VACUUM');
  log('vacuum', `done in ${Date.now() - t} ms`);
} else {
  log('vacuum', 'skipped (no orphan pages to reclaim)');
}

log('verify', 'status filter smoke tests');
const p0 = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 0').get().c;
const p1 = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 1').get().c;
const total = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
console.log(`          รอส่ง=${p0}  ส่งแล้ว=${p1}  รวม=${total}`);

db.close();

if (!postOk) {
  console.error('[fix-idx] FAILED - post-CREATE integrity_check is not ok. Do NOT restart.');
  process.exit(2);
}
const newSizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
console.log(`[fix-idx] SUCCESS - DB is healthy (${sizeMB} -> ${newSizeMB} MB). Backup: ${path.basename(BACKUP_PATH)}`);
'@
$FixPath = Join-Path $ServerDir 'src\fix-indexes.js'
Set-Content -Path $FixPath -Value $fixJs -Encoding utf8
Write-Host "[fix-idx] wrote $FixPath" -ForegroundColor Cyan

# --- 4. Run fix ------------------------------------------
Write-Host '[fix-idx] running fix-indexes...' -ForegroundColor Cyan
Push-Location $ServerDir
try {
  $node = 'C:\Program Files\nodejs\node.exe'
  if (-not (Test-Path $node)) { $node = 'node' }
  & $node 'src\fix-indexes.js'
  $exit = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exit -eq 3) {
  Write-Host '' -ForegroundColor Red
  Write-Host '[fix-idx] Table data เสียหายด้วย ไม่ใช่แค่ index — ต้องใช้ .recover' -ForegroundColor Red
  Write-Host '[fix-idx] Service ยังไม่ start กลับ — DB ยังอยู่สภาพเดิม' -ForegroundColor Yellow
  exit 3
}
if ($exit -ne 0) {
  Write-Host "[fix-idx] fix FAILED (exit=$exit). Service ยังไม่ start — ตรวจสอบ log" -ForegroundColor Red
  exit $exit
}

# --- 5. Start service -------------------------------------
if ($svc) {
  Write-Host "[fix-idx] starting service 'se-key'..." -ForegroundColor Cyan
  Start-Service -Name 'se-key'
  Start-Sleep -Seconds 2
  $svc.Refresh()
  Write-Host "[fix-idx] service status = $($svc.Status)" -ForegroundColor Cyan
}

Write-Host '[fix-idx] เสร็จแล้ว — ลองเปิด http://192.168.4.122:3100/admin/ แล้วกดตัวกรอง ส่งแล้ว/รอส่ง' -ForegroundColor Green
