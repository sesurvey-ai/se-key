// Revert isurvey_sent=1 → 0 for records that appear in the "งานสร้างใหม่" xlsx.
// Match rule (per user request): claim_no AND (survey_no OR invoice_mix)
// matches xlsx columns เลขเคลม_x + ใบแจ้งหนี้.

import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initSchema } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX = path.join(__dirname, '..', '..', 'งานสร้างใหม่.xlsx');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const xlsxPath = args.find((a) => !a.startsWith('--')) || DEFAULT_XLSX;

initSchema();

const COL = {
  claim_no: 3,   // เลขเคลม_x
  invoice:  4,   // ใบแจ้งหนี้
};

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

console.log(`reading ${xlsxPath} ...`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const ws = wb.worksheets[0];
console.log(`sheet: "${ws.name}" rows=${ws.rowCount}`);

// Find matching sent rows. Use two prepared stmts to leverage the existing
// idx_records_claim_no — matching on claim_no first narrows fast.
const findSent = db.prepare(`
  SELECT id, claim_no, survey_no, invoice_mix
  FROM records
  WHERE claim_no = @claim
    AND (survey_no = @inv OR invoice_mix = @inv)
    AND isurvey_sent = 1
`);
const findAny = db.prepare(`
  SELECT id, isurvey_sent
  FROM records
  WHERE claim_no = @claim
    AND (survey_no = @inv OR invoice_mix = @inv)
`);
const revertStmt = db.prepare(`
  UPDATE records
  SET isurvey_sent = 0,
      retry_count  = 0,
      last_retry_at = NULL,
      retry_error   = NULL
  WHERE id = ?
`);

const started = Date.now();
let scanned = 0, skippedBlank = 0, notFound = 0, alreadyPending = 0, toRevert = 0;
const revertIds = [];

ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber === 1) return; // header
  scanned++;
  const claim = normClaim(row.getCell(COL.claim_no).value);
  const inv   = normText(row.getCell(COL.invoice).value);
  if (!claim || !inv) { skippedBlank++; return; }

  const sent = findSent.all({ claim, inv });
  if (sent.length > 0) {
    for (const r of sent) revertIds.push(r.id);
    toRevert += sent.length;
    return;
  }
  // No sent match — check if any row matches (pending already, or no match at all).
  const any = findAny.all({ claim, inv });
  if (any.length === 0) notFound++;
  else alreadyPending++;
});

console.log('--- scan summary ---');
console.log(`scanned:         ${scanned}`);
console.log(`skipped (blank): ${skippedBlank}`);
console.log(`not in DB:       ${notFound}`);
console.log(`already pending: ${alreadyPending}`);
console.log(`to revert (isurvey_sent 1 → 0): ${toRevert}`);

if (dryRun) {
  console.log('dry-run — no rows updated.');
  process.exit(0);
}

if (toRevert === 0) {
  console.log('nothing to do.');
  process.exit(0);
}

const tx = db.transaction((ids) => {
  for (const id of ids) revertStmt.run(id);
});
tx(revertIds);

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`done. reverted=${revertIds.length} in ${elapsed}s`);
const { pending } = db.prepare(
  'SELECT COUNT(*) AS pending FROM records WHERE isurvey_sent = 0'
).get();
console.log(`pending rows now: ${pending}`);
