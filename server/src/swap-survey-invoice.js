import { db } from './db.js';

// User asked 2026-04-17: swap survey_no <-> invoice_mix for งานรวม/SESV rows,
// so that survey_no always represents the value forwarded to iSurvey.
// Option A: swap ONLY rows where both columns have values (no data loss).

const TARGET_TYPES = ['งานรวม', 'SESV'];
const placeholders = TARGET_TYPES.map(() => '?').join(',');

const candidate = db.prepare(`
  SELECT COUNT(*) AS c FROM records
  WHERE work_type IN (${placeholders})
    AND survey_no  != ''
    AND invoice_mix != ''
`).get(...TARGET_TYPES).c;

console.log(`candidates to swap (work_type in งานรวม/SESV AND both columns non-empty): ${candidate}`);

// Per work_type breakdown before
console.log('\nbefore:');
for (const wt of TARGET_TYPES) {
  const total       = db.prepare('SELECT COUNT(*) AS c FROM records WHERE work_type=?').get(wt).c;
  const both        = db.prepare("SELECT COUNT(*) AS c FROM records WHERE work_type=? AND survey_no!='' AND invoice_mix!=''").get(wt).c;
  const emptyMix    = db.prepare("SELECT COUNT(*) AS c FROM records WHERE work_type=? AND invoice_mix=''").get(wt).c;
  console.log(`  ${wt}: total=${total} both-filled=${both} mix-empty=${emptyMix} (skipped)`);
}

console.log('\nsample 3 rows BEFORE:');
for (const r of db.prepare(`
  SELECT id, work_type, survey_no, invoice_mix FROM records
  WHERE work_type IN (${placeholders}) AND survey_no!='' AND invoice_mix!=''
  ORDER BY id DESC LIMIT 3
`).all(...TARGET_TYPES)) console.log(' ', r);

const result = db.transaction(() => {
  // SQLite evaluates RHS from the ORIGINAL row before applying SET,
  // so this one-shot UPDATE correctly swaps both columns.
  const r = db.prepare(`
    UPDATE records
       SET survey_no  = invoice_mix,
           invoice_mix = survey_no
     WHERE work_type IN (${placeholders})
       AND survey_no  != ''
       AND invoice_mix != ''
  `).run(...TARGET_TYPES);
  return r.changes;
})();

console.log(`\nswapped ${result} rows.`);

console.log('\nsample same ids AFTER:');
for (const r of db.prepare(`
  SELECT id, work_type, survey_no, invoice_mix FROM records
  WHERE work_type IN (${placeholders}) AND survey_no!='' AND invoice_mix!=''
  ORDER BY id DESC LIMIT 3
`).all(...TARGET_TYPES)) console.log(' ', r);
