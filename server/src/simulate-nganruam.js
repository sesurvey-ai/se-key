// Dry-run simulation of a "งานรวม" save with 3 invoice numbers.
// Shows exactly what would be inserted into the DB and what would be POSTed
// to iSurvey — WITHOUT touching either the real DB or the real iSurvey.
//
// Schema (2026-04-17 swap):
//   survey_no   = user-typed value (ส่งไป iSurvey)
//   invoice_mix = เลขเซอร์เวย์จาก DOM #txtBill_No (reference)

import { buildIsurveyPayload } from './isurvey.js';

// ---- 1) สิ่งที่ extension อ่านจาก eClaim3 DOM ----
const fromDOM = {
  claim_no:  '2026013127000',           // #lblRef_Claim_No
  survey_no: 'SEABI-110260400999',      // #txtBill_No  ← จะไปอยู่ในคอลัมน์ invoice_mix
  keyer:     'นิสากร เปรมปรีดิ์',       // #wuHeadUser1_lblUser_Name
};

// ---- 2) ค่าที่ user กรอกในช่อง "เลข invoice (งานรวม)" ----
const typedInvoices = [
  'SEABI-310260400503',
  'SEABI-310260400626',
  'SEABI-310260400765',
];

let nextId = 319303;
const createdAt = '2026-04-17 15:10:00';
const auth = { userId: 'sesurvey', password: 'pass1234' };

console.log('═══════════════════════════════════════════════════════════════');
console.log('  จำลอง: งานรวม — ' + typedInvoices.length + ' เลข invoice');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('DOM values (อ่านจาก eClaim3):');
console.log('  claim_no  =', fromDOM.claim_no);
console.log('  survey_no =', fromDOM.survey_no, '← เก็บใน DB column "invoice_mix"');
console.log('  keyer     =', fromDOM.keyer);
console.log('  work_type = งานรวม\n');

console.log('user กรอกในช่อง invoice (งานรวม):');
typedInvoices.forEach((v, i) => console.log(`  [${i + 1}] ${v}  ← เก็บใน DB column "survey_no"`));
console.log('');

console.log('───────────────────────────────────────────────────────────────');
console.log('  กดปุ่ม "บันทึกข้อมูล" → วนทีละเลข');
console.log('───────────────────────────────────────────────────────────────\n');

for (let i = 0; i < typedInvoices.length; i++) {
  const typed = typedInvoices[i];
  const id = nextId++;
  const now = new Date(`2026-04-17T15:10:0${1 + i * 2}`);

  // (a) Extension ส่งไป POST /api/records — SWAP applied:
  //     survey_no  = typed value
  //     invoice_mix = DOM survey_no
  const postBody = {
    claim_no:    fromDOM.claim_no,
    survey_no:   typed,
    keyer:       fromDOM.keyer,
    work_type:   'งานรวม',
    invoice_mix: fromDOM.survey_no,
  };

  // (b) Server เขียนเข้า records table
  const dbRow = {
    id,
    created_at:   createdAt,
    ...postBody,
    isurvey_sent: 0,
  };

  // (c) iSurvey payload — always row.survey_no (ไม่มี per-type branching แล้ว)
  const isurveyPayload = buildIsurveyPayload(dbRow, { ...auth, now });

  // (d) หลังสำเร็จ
  const dbRowAfter = { ...dbRow, isurvey_sent: 1 };

  console.log(`► รอบที่ ${i + 1}/${typedInvoices.length}  —  typed = ${typed}`);
  console.log('');
  console.log('  (a) Extension → POST /api/records — body:');
  console.log('      ' + JSON.stringify(postBody, null, 6).replace(/\n/g, '\n      '));
  console.log('');
  console.log('  (b) Server → INSERT INTO records:');
  console.log('      ' + JSON.stringify(dbRow, null, 6).replace(/\n/g, '\n      '));
  console.log('');
  console.log('  (c) Server → POST iSurvey — body:');
  console.log('      ' + JSON.stringify(isurveyPayload, null, 6).replace(/\n/g, '\n      '));
  console.log('');
  console.log('  (d) Server → UPDATE records SET isurvey_sent=1 WHERE id=' + id);
  console.log('');
  console.log('───────────────────────────────────────────────────────────────\n');
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  สรุป: DB 3 แถว, iSurvey 3 requests');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('ตาราง records หลังทำงาน:');
console.log('id       claim_no         survey_no                invoice_mix           work_type  sent');
console.log('------  ---------------  ----------------------  --------------------  --------  ----');
for (let i = 0; i < typedInvoices.length; i++) {
  const id = 319303 + i;
  console.log(`${id}   ${fromDOM.claim_no}   ${typedInvoices[i]}    ${fromDOM.survey_no}  งานรวม     1`);
}
console.log('                             ↑                        ↑');
console.log('                          typed value            DOM survey_no');

console.log('\niSurvey ได้รับ 3 requests (survey_no = record.survey_no = typed value):');
for (const v of typedInvoices) console.log(`  survey_no=${v}  claim_no=${fromDOM.claim_no}`);
