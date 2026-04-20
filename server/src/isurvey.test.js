import assert from 'node:assert/strict';
import { buildIsurveyPayload, shouldSendToIsurvey } from './isurvey.js';

const fixedNow = new Date('2026-04-17T10:53:32');
const auth = { userId: 'sesurvey', password: 'pass1234', now: fixedNow };

// After the 2026-04-17 schema swap, record.survey_no IS the value forwarded
// to iSurvey for ALL work_types — the extension stores the user-typed value
// into survey_no for งานรวม/SESV and the DOM's เลขเซอร์เวย์ into invoice_mix.

// งานต้น
{
  const p = buildIsurveyPayload({
    claim_no: '2026013126637', survey_no: 'SEABI-110260400183',
    keyer: 'นิสากร', work_type: 'งานต้น', invoice_mix: '',
  }, auth);
  assert.equal(p.survey_no, 'SEABI-110260400183');
  assert.equal(p.claim_no,  '2026013126637');
  assert.equal(p.EMCSstatus,'send');
  assert.equal(p.EMCSby,    'นิสากร');
  assert.equal(p.EMCSdate,  '2026-04-17 10:53:32');
  assert.equal(p.user_id,   'sesurvey');
  assert.equal(p.password,  'pass1234');
  console.log('✓ งานต้น uses record.survey_no');
}

// งานตาม
{
  const p = buildIsurveyPayload({
    claim_no: 'C', survey_no: 'S', keyer: 'k',
    work_type: 'งานตาม', invoice_mix: 'IGNORED',
  }, auth);
  assert.equal(p.survey_no, 'S');
  console.log('✓ งานตาม uses record.survey_no');
}

// งานรวม (new schema: typed value is in survey_no)
{
  const p = buildIsurveyPayload({
    claim_no: '2026013126637',
    survey_no:   'SEABI-310260400503',   // ← typed value (post-swap schema)
    keyer: 'นิสากร', work_type: 'งานรวม',
    invoice_mix: 'SEABI-110260400183',   // ← DOM survey_no (reference)
  }, auth);
  assert.equal(p.survey_no, 'SEABI-310260400503',
    'งานรวม must send record.survey_no (which now holds the typed invoice value)');
  console.log('✓ งานรวม sends record.survey_no (typed value after swap)');
}

// SESV (same schema as งานรวม)
{
  const p = buildIsurveyPayload({
    claim_no: 'C',
    survey_no: 'SESV-REF-001',     // typed
    keyer: 'k', work_type: 'SESV',
    invoice_mix: 'SEABI-999',      // DOM
  }, auth);
  assert.equal(p.survey_no, 'SESV-REF-001');
  console.log('✓ SESV sends record.survey_no (typed value after swap)');
}

// Routing: งานต้น/งานตาม/งานรวม/SESV all forwarded. Unknown/empty skipped.
{
  assert.equal(shouldSendToIsurvey({ work_type: 'งานต้น'  }), true);
  assert.equal(shouldSendToIsurvey({ work_type: 'งานตาม' }), true);
  assert.equal(shouldSendToIsurvey({ work_type: 'งานรวม' }), true);
  assert.equal(shouldSendToIsurvey({ work_type: 'SESV'    }), true);
  assert.equal(shouldSendToIsurvey({ work_type: ''        }), false);
  assert.equal(shouldSendToIsurvey({ work_type: 'unknown' }), false);
  console.log('✓ shouldSendToIsurvey: งานต้น/งานตาม/งานรวม/SESV forwarded; empty/unknown skipped');
}

// EMCSdate pads single-digit components
{
  const p = buildIsurveyPayload(
    { claim_no: 'C', survey_no: 'S', keyer: 'k', work_type: 'งานต้น', invoice_mix: '' },
    { ...auth, now: new Date('2026-01-02T03:04:05') },
  );
  assert.equal(p.EMCSdate, '2026-01-02 03:04:05');
  console.log('✓ EMCSdate zero-pads');
}

console.log('\nall payload tests passed.');
