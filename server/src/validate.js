// Survey-number format validation.
//
// Valid prefixes (confirmed against existing data — see survey_no prefix
// distribution in DB as of 2026-05-24):
//   SEABI  — 315,063 rows (~99%)
//   SETP   — 1,365
//   SESV   — 772
//   SEAIO  — 74
//
// Format: <PREFIX>-<digits>, uppercase only, no surrounding whitespace.
//
// ~40 historical rows violate this (typos like "EABI-...", "SEABI 320250",
// "ไม่เบิก", Thai-keyboard prefix slips). They are intentionally left alone;
// validation only fires on new writes and edits.

const SURVEY_NO_RE = /^(SEABI|SETP|SESV|SEAIO)-\d+$/;

export function isValidSurveyNo(s) {
  return typeof s === 'string' && SURVEY_NO_RE.test(s);
}

export const SURVEY_NO_FORMAT_HINT =
  'ต้องเป็น SEABI-/SETP-/SESV-/SEAIO- ตามด้วยตัวเลข (เช่น SEABI-12345)';
