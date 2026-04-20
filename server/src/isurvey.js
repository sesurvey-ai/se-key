// Routing + schema (updated 2026-04-17 — columns swapped for งานรวม/SESV):
//   งานต้น  → send, survey_no = record.survey_no
//   งานตาม → send, survey_no = record.survey_no
//   งานรวม → send, survey_no = record.survey_no  (extension puts typed value here;
//                                                 DOM's เลขเซอร์เวย์ is in invoice_mix)
//   SESV    → send, survey_no = record.survey_no  (same swap as งานรวม)
//   else    → skip (unknown/empty work_type)
//
// i.e. `record.survey_no` is now canonical for "ค่าที่ส่ง iSurvey" regardless of
// work_type. No per-type branching needed.

const FORWARDED = new Set(['งานต้น', 'งานตาม', 'งานรวม', 'SESV']);

export function shouldSendToIsurvey(row) {
  return FORWARDED.has(row.work_type);
}

function formatEmcsDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function buildIsurveyPayload(row, { userId, password, now = new Date() } = {}) {
  return {
    survey_no:  row.survey_no,
    claim_no:   row.claim_no,
    EMCSstatus: 'send',
    EMCSby:     row.keyer,
    EMCSdate:   formatEmcsDate(now),
    user_id:    userId,
    password,
  };
}
