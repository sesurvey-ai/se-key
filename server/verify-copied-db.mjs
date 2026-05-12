// Verify a copied data.db: row counts, max id/date, integrity, then checkpoint
// the WAL so the file becomes self-contained for upload to cloud.
import Database from 'better-sqlite3';
import { statSync, existsSync } from 'node:fs';

const DB = process.argv[2];
if (!DB) { console.error('usage: node verify-copied-db.mjs <path-to-data.db>'); process.exit(1); }
if (!existsSync(DB)) { console.error('not found:', DB); process.exit(1); }

function size(p) { try { return statSync(p).size; } catch { return null; } }

console.log('=== sidecar files (pre-checkpoint) ===');
console.log('  data.db     :', size(DB), 'bytes');
console.log('  data.db-shm :', size(DB + '-shm'), 'bytes');
console.log('  data.db-wal :', size(DB + '-wal'), 'bytes (if >0, WAL has unflushed data)');
console.log();

const db = new Database(DB);
// Important: open with WAL still attached so SQLite replays it transparently.
db.pragma('journal_mode = WAL');

console.log('=== integrity ===');
const integrity = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check).join('; ');
console.log('  PRAGMA integrity_check:', integrity);
console.log();

console.log('=== records ===');
const total = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
const sent  = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 1').get().c;
const pend  = db.prepare('SELECT COUNT(*) AS c FROM records WHERE isurvey_sent = 0').get().c;
const max   = db.prepare('SELECT MAX(id) AS id, MAX(created_at) AS at FROM records').get();
const min   = db.prepare('SELECT MIN(created_at) AS at FROM records').get();
console.log('  total rows:', total);
console.log('  sent=1    :', sent);
console.log('  sent=0    :', pend);
console.log('  max id    :', max.id);
console.log('  max ts    :', max.at);
console.log('  min ts    :', min.at);
console.log();

console.log('=== checkpoint (merge WAL into main file) ===');
const cp = db.pragma('wal_checkpoint(TRUNCATE)');
console.log('  result    :', JSON.stringify(cp));
console.log();

db.close();

console.log('=== sidecar files (post-checkpoint) ===');
console.log('  data.db     :', size(DB), 'bytes');
console.log('  data.db-shm :', size(DB + '-shm'), 'bytes (should be small or unchanged)');
console.log('  data.db-wal :', size(DB + '-wal'), 'bytes (should be 0 — data folded into data.db)');
console.log();
console.log('SAFE TO UPLOAD: copy ONLY data.db. Discard the -shm and -wal sidecars.');
