// Repair SQLite data.db — fixes transient "database disk image is malformed"
// errors that can appear on large WAL databases (e.g. admin page status filter).
//
// Run on the server machine (with the server STOPPED) from the `server/` dir:
//   node src/repair-db.js
//
// Steps: backup → WAL checkpoint → REINDEX → integrity_check → VACUUM → re-check.
// Exits non-zero if any integrity check fails so it's safe to use in automation.

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

function log(step, msg) { console.log(`[repair] ${step}: ${msg}`); }

if (!fs.existsSync(DB_PATH)) {
  console.error(`[repair] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const BACKUP_PATH = `${DB_PATH}.bak.${stamp()}`;
log('backup', `copying ${path.basename(DB_PATH)} → ${path.basename(BACKUP_PATH)}`);
fs.copyFileSync(DB_PATH, BACKUP_PATH);
const sizeMB = (fs.statSync(BACKUP_PATH).size / 1024 / 1024).toFixed(1);
log('backup', `ok (${sizeMB} MB)`);

const db = new Database(DB_PATH);

log('wal', 'checkpoint(TRUNCATE)');
console.log('        ', db.pragma('wal_checkpoint(TRUNCATE)'));

log('reindex', 'rebuilding all indexes on records...');
const t1 = Date.now();
db.exec('REINDEX records');
log('reindex', `done in ${Date.now() - t1} ms`);

log('check', 'integrity_check (pre-VACUUM)');
const pre = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join('; ');
console.log('        ', pre);

log('vacuum', 'rebuilding database file...');
const t2 = Date.now();
db.exec('VACUUM');
log('vacuum', `done in ${Date.now() - t2} ms`);

log('check', 'integrity_check (post-VACUUM)');
const post = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join('; ');
console.log('        ', post);

log('verify', 'status filter smoke tests');
const p0 = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 0').get().c;
const p1 = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 1').get().c;
const total = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
console.log(`         รอส่ง=${p0}  ส่งแล้ว=${p1}  รวม=${total}`);

db.close();

if (post !== 'ok') {
  console.error('[repair] FAILED — integrity_check is not ok. Do NOT restart the server; contact dev.');
  process.exit(2);
}

const newSizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
console.log(`[repair] SUCCESS — DB is healthy (${sizeMB} → ${newSizeMB} MB). Backup: ${path.basename(BACKUP_PATH)}`);
console.log('[repair] Next: restart the server (npm start / restart service).');
