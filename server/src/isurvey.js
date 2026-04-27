// Routing + schema:
//   งานต้น  → send, survey_no = record.survey_no
//   งานตาม → send, survey_no = record.survey_no
//   งานรวม → send, survey_no = record.survey_no  (extension puts typed value here;
//                                                 DOM's เลขเซอร์เวย์ is in invoice_mix)
//   SESV    → send, survey_no = record.invoice_mix (the linked SEABI invoice;
//                                                   SESV-xxx itself isn't claimable
//                                                   on iSurvey). Falls back to
//                                                   record.survey_no when
//                                                   invoice_mix is empty (legacy
//                                                   rows pre-SESV-mandatory-batch).
//   else    → skip (unknown/empty work_type)

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
  const surveyNo = (row.work_type === 'SESV' && row.invoice_mix)
    ? row.invoice_mix
    : row.survey_no;
  return {
    survey_no:  surveyNo,
    claim_no:   row.claim_no,
    EMCSstatus: 'send',
    EMCSby:     row.keyer,
    EMCSdate:   formatEmcsDate(now),
    user_id:    userId,
    password,
  };
}
