import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initSchema } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX = path.join(__dirname, '..', '..', 'คีย์ข้อมูล.xlsx');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sheetArg = args.find((a) => a.startsWith('--sheet='));
const sheetName = sheetArg ? sheetArg.split('=')[1] : 'Sheet1';
const xlsxPath = args.find((a) => !a.startsWith('--')) || DEFAULT_XLSX;

initSchema();

// Column map — 1-based for exceljs.
// Sheet1: วันคีย์งาน | เลขเคลม | เลขเซอร์เวย์ | EMCSby (keyer) | EMCSstatus | sesv+งานรวม
// Sheet2: เลขเคลม | เลขรับแจ้ง | เลขเซอร์เวย์ | พนักงานสำรวจ | ประเภทเคลม | ... | ผู้คีย์งาน | วันที่/เวลาคีย์งาน | ...
const SHEETS = {
  Sheet1: { claim_no: 2, survey_no: 3, keyer:  4, work_type: null, invoice_mix: 6, created_at: 1 },
  Sheet2: { claim_no: 1, survey_no: 3, keyer: 11, work_type: 5,    invoice_mix: null, created_at: 12 },
};
const COL = SHEETS[sheetName];
if (!COL) { console.error(`unknown sheet: ${sheetName}`); process.exit(1); }

function normClaim(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'none') return '';
  return s;
}
function normText(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'none') return '';
  return s;
}
function normDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    if (y < 2020) return null; // Excel epoch sentinels (1899-12-30, 1970-01-01)
    const pad = (n) => String(n).padStart(2, '0');
    return `${y}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ` +
           `${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  const s = String(v).trim();
  return s || null;
}
function cell(row, idx) {
  return idx == null ? null : row.getCell(idx).value;
}

// Preload existing (claim_no, survey_no) pairs for in-memory O(1) lookup.
// Faster than per-row SELECT when the sheet is large.
console.log('loading existing keys from DB ...');
const existing = new Set();
for (const r of db.prepare('SELECT claim_no, survey_no FROM records').iterate()) {
  existing.add(`${r.claim_no}||${r.survey_no}`);
}
console.log(`existing keys: ${existing.size}`);

const insertWithDate = db.prepare(`
  INSERT INTO records (created_at, claim_no, survey_no, keyer, work_type, invoice_mix, isurvey_sent)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);
// Omit created_at so DEFAULT (datetime('now','localtime')) fires.
const insertNoDate = db.prepare(`
  INSERT INTO records (claim_no, survey_no, keyer, work_type, invoice_mix, isurvey_sent)
  VALUES (?, ?, ?, ?, ?, 1)
`);
const runBatch = db.transaction((rows) => {
  for (const r of rows) {
    const [created_at, claim_no, survey_no, keyer, work_type, invoice_mix] = r;
    if (created_at == null) insertNoDate.run(claim_no, survey_no, keyer, work_type, invoice_mix);
    else                    insertWithDate.run(created_at, claim_no, survey_no, keyer, work_type, invoice_mix);
  }
});

console.log(`reading ${xlsxPath} [${sheetName}] ...`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const ws = wb.getWorksheet(sheetName);
if (!ws) { console.error(`${sheetName} not found`); process.exit(1); }

const started = Date.now();
let scanned = 0, blankClaim = 0, blankSurvey = 0, alreadyExists = 0, toInsert = 0;
const batch = [];
const BATCH_SIZE = 2000;

ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber === 1) return; // header
  scanned++;
  const claim_no  = normClaim(cell(row, COL.claim_no));
  const survey_no = normText(cell(row, COL.survey_no));
  if (!claim_no)  { blankClaim++;  return; }
  if (!survey_no) { blankSurvey++; return; }

  const key = `${claim_no}||${survey_no}`;
  if (existing.has(key)) { alreadyExists++; return; }
  existing.add(key); // dedupe within this run too

  const keyer       = normText(cell(row, COL.keyer));
  const work_type   = normText(cell(row, COL.work_type));
  const invoice_mix = normText(cell(row, COL.invoice_mix));
  const created_at  = normDate(cell(row, COL.created_at));
  batch.push([created_at, claim_no, survey_no, keyer, work_type, invoice_mix]);
  toInsert++;
});

console.log('--- scan summary ---');
console.log(`scanned:        ${scanned}`);
console.log(`blank claim_no: ${blankClaim}`);
console.log(`blank survey_no:${blankSurvey}`);
console.log(`already exists: ${alreadyExists}`);
console.log(`to insert:      ${toInsert}`);

if (dryRun) {
  console.log('dry-run — no rows written.');
  process.exit(0);
}

console.log('inserting ...');
let inserted = 0;
let chunk = [];
for (const row of batch) {
  chunk.push(row);
  if (chunk.length >= BATCH_SIZE) {
    runBatch(chunk);
    inserted += chunk.length;
    chunk = [];
    if (inserted % 20000 === 0) console.log(`  inserted ${inserted} ...`);
  }
}
if (chunk.length) { runBatch(chunk); inserted += chunk.length; }

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`done. inserted=${inserted} in ${elapsed}s`);
const { count } = db.prepare('SELECT COUNT(*) AS count FROM records').get();
console.log(`records table now has ${count} rows.`);
