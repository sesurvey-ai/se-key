import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { db, initSchema } from './db.js';

const CSV_PATH = process.argv[2] || path.join(os.tmpdir(), 'sheet.csv');

if (!fs.existsSync(CSV_PATH)) {
  console.error(`CSV not found: ${CSV_PATH}`);
  process.exit(1);
}

initSchema();

// Simple CSV line parser — handles quoted fields with embedded commas/quotes.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

const insert = db.prepare(`
  INSERT INTO records (created_at, claim_no, survey_no, keyer, work_type, invoice_mix, isurvey_sent)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

const rl = readline.createInterface({
  input: fs.createReadStream(CSV_PATH, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

let lineNo = 0;
let inserted = 0;
let skipped = 0;
const started = Date.now();

const runBatch = db.transaction((rows) => {
  for (const r of rows) insert.run(...r);
});

let batch = [];
const BATCH_SIZE = 5000;

// Existing pre-migration count — we want to know whether this is a first-time
// migration or not. If there are already rows, abort to avoid duplicating data.
const { count: preCount } = db.prepare('SELECT COUNT(*) AS count FROM records').get();
if (preCount > 0) {
  console.error(`refusing to migrate: records table already has ${preCount} rows.`);
  console.error('delete data.db first if you really want to re-run migration.');
  process.exit(1);
}

console.log(`migrating from ${CSV_PATH} ...`);

for await (const line of rl) {
  lineNo++;
  if (lineNo === 1) continue; // header
  if (!line.trim()) { skipped++; continue; }

  const cols = parseCsvLine(line);
  const [created_at, claim_no, survey_no, keyer, work_type, invoice_mix] = cols;

  if (!claim_no) { skipped++; continue; }

  batch.push([
    (created_at || '').trim(),
    claim_no.trim(),
    (survey_no || '').trim(),
    (keyer || '').trim(),
    (work_type || '').trim(),
    (invoice_mix || '').trim(),
  ]);

  if (batch.length >= BATCH_SIZE) {
    runBatch(batch);
    inserted += batch.length;
    batch = [];
    if (inserted % 50000 === 0) console.log(`  inserted ${inserted} ...`);
  }
}

if (batch.length) {
  runBatch(batch);
  inserted += batch.length;
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`done. inserted=${inserted} skipped=${skipped} totalLines=${lineNo} in ${elapsed}s`);

const { count } = db.prepare('SELECT COUNT(*) AS count FROM records').get();
console.log(`records table now has ${count} rows.`);
