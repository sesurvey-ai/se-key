// Survey-number format validation.
//
// Four valid shapes (digit counts confirmed against existing data 2026-05-24):
//
//   SEABI-<12 digits>           315,021 rows (99.99% of all SEABI)
//                               e.g. SEABI-110260400183
//   SETP-<8 digits>             1,365 rows (100% of all SETP)
//                               e.g. SETP-68070146
//   SESV-<8 digits>             769 rows (99.5% of all SESV)
//                               e.g. SESV-65120009
//   SEAIO-<3-char REGION>-<9 digits>   74 rows (100% of all SEAIO)
//                                       e.g. SEAIO-BKK-211102965
//                                            SEAIO-AYA-220605076
//                                            SEAIO-R14-220500001
//     ↳ REGION is exactly 3 chars: uppercase letters OR alphanumeric
//       (province codes BKK/AYA/RYG/CBI/CMI/KKN/... + variants R14/P28/P05).
//
// All formats: uppercase only, no surrounding whitespace.
//
// ~242 historical rows violate these shapes:
//   - ~30 SEABI with 10/11/13 digits (legacy 2022)
//   - 4 SESV with 9 digits or empty
//   - ~208 typos (EABI-, SEABI 12345, ไม่เบิก, Thai-keyboard prefix slips,
//     claim_no mistakenly typed into survey_no, SEAP/SEASS/SVSE rare codes)
// They are intentionally left alone; validation only fires on new writes
// and edits.

const SURVEY_NO_RE = /^(?:SEABI-\d{12}|SETP-\d{8}|SESV-\d{8}|SEAIO-[A-Z0-9]{3}-\d{9})$/;

export function isValidSurveyNo(s) {
  return typeof s === 'string' && SURVEY_NO_RE.test(s);
}

export const SURVEY_NO_FORMAT_HINT =
  'ต้องเป็น SEABI-<12 หลัก>, SETP-<8 หลัก>, SESV-<8 หลัก>, หรือ SEAIO-<region 3 ตัว>-<9 หลัก> (เช่น SEABI-110260400183, SEAIO-BKK-211102965)';
