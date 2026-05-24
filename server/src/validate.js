// Survey-number format validation.
//
// Two valid shapes (confirmed against existing data as of 2026-05-24):
//
//   SEABI-<digits>     ~315k rows (~99%)   e.g. SEABI-110260400183
//   SETP-<digits>      ~1.4k                e.g. SETP-68070146
//   SESV-<digits>      ~770                 e.g. SESV-65120009
//   SEAIO-<REGION>-<digits>  74 rows        e.g. SEAIO-BKK-211102965
//                                                SEAIO-AYA-220605076
//                                                SEAIO-R14-220500001
//     ↳ REGION is 1+ uppercase letters and/or digits (3 chars in practice:
//       AYA/BKK/RYG/CBI/... or alphanumeric variants R14/P28/P05).
//
// All formats: uppercase only, no surrounding whitespace.
//
// ~212 historical rows violate these shapes (typos like "EABI-...",
// "SEABI 320250", "ไม่เบิก", "SEAIO-BKK-..." with bad casing, claim_no
// mistakenly typed into survey_no). They are intentionally left alone;
// validation only fires on new writes and edits.

const SURVEY_NO_RE = /^(?:SEABI-\d+|SETP-\d+|SESV-\d+|SEAIO-[A-Z0-9]+-\d+)$/;

export function isValidSurveyNo(s) {
  return typeof s === 'string' && SURVEY_NO_RE.test(s);
}

export const SURVEY_NO_FORMAT_HINT =
  'ต้องเป็น SEABI-/SETP-/SESV- ตามด้วยตัวเลข, หรือ SEAIO-<region>-<digits> (เช่น SEABI-12345, SEAIO-BKK-211102965)';
