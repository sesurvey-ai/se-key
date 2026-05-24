import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSurveyNo } from './validate.js';

test('isValidSurveyNo: accepts SEABI/SETP/SESV with digits', () => {
  assert.equal(isValidSurveyNo('SEABI-1'), true);
  assert.equal(isValidSurveyNo('SEABI-12345'), true);
  assert.equal(isValidSurveyNo('SETP-12345'), true);
  assert.equal(isValidSurveyNo('SESV-12345'), true);
  assert.equal(isValidSurveyNo('SEABI-123456789012'), true);
});

test('isValidSurveyNo: accepts SEAIO with region segment', () => {
  // Real samples from prod DB.
  assert.equal(isValidSurveyNo('SEAIO-BKK-211102965'), true);
  assert.equal(isValidSurveyNo('SEAIO-AYA-220605076'), true);
  assert.equal(isValidSurveyNo('SEAIO-RYG-210302741'), true);
  assert.equal(isValidSurveyNo('SEAIO-CBI-210201790'), true);
  // Alphanumeric region variants also seen in prod (R14/P28/P05).
  assert.equal(isValidSurveyNo('SEAIO-R14-220500001'), true);
  assert.equal(isValidSurveyNo('SEAIO-P28-220500001'), true);
  // Region length isn't fixed — be permissive on length, strict on content.
  assert.equal(isValidSurveyNo('SEAIO-A-1'),    true);
  assert.equal(isValidSurveyNo('SEAIO-ABCD-1'), true);
});

test('isValidSurveyNo: rejects SEAIO without region segment', () => {
  // SEAIO-<digits> directly is NOT a real format in prod data — bare digits
  // after SEAIO must come via a region (e.g. SEAIO-BKK-12345).
  assert.equal(isValidSurveyNo('SEAIO-12345'),       false);
  assert.equal(isValidSurveyNo('SEAIO--12345'),      false); // empty region
  assert.equal(isValidSurveyNo('SEAIO-bkk-12345'),   false); // lowercase region
  assert.equal(isValidSurveyNo('SEAIO-BKK-'),        false); // no digits
  assert.equal(isValidSurveyNo('SEAIO-BKK-12-345'),  false); // extra dash
});

test('isValidSurveyNo: rejects empty / null / non-string', () => {
  assert.equal(isValidSurveyNo(''), false);
  assert.equal(isValidSurveyNo(null), false);
  assert.equal(isValidSurveyNo(undefined), false);
  assert.equal(isValidSurveyNo(12345), false);
  assert.equal(isValidSurveyNo({}), false);
});

test('isValidSurveyNo: rejects wrong / partial prefix', () => {
  assert.equal(isValidSurveyNo('EABI-123'),    false); // dropped leading S
  assert.equal(isValidSurveyNo('SEAS-123'),    false);
  assert.equal(isValidSurveyNo('ABC-123'),     false);
  assert.equal(isValidSurveyNo('SEABIX-123'),  false);
  assert.equal(isValidSurveyNo('SVSE-123'),    false); // not in allowed set
});

test('isValidSurveyNo: rejects missing dash / lowercase / spaces', () => {
  assert.equal(isValidSurveyNo('SEABI123'),     false);
  assert.equal(isValidSurveyNo('SEABI 123'),    false);
  assert.equal(isValidSurveyNo('seabi-123'),    false);
  assert.equal(isValidSurveyNo(' SEABI-123'),   false);
  assert.equal(isValidSurveyNo('SEABI-123 '),   false);
  assert.equal(isValidSurveyNo('SEABI-12 345'), false);
});

test('isValidSurveyNo: rejects Thai / mixed garbage', () => {
  assert.equal(isValidSurveyNo('ไม่เบิก'),         false);
  assert.equal(isValidSurveyNo('ิSEABI-22023'),     false); // Thai sara before prefix
  assert.equal(isValidSurveyNo('อSEABI-42022'),    false);
  assert.equal(isValidSurveyNo('SEABI-12345xyz'),  false);
});

test('isValidSurveyNo: rejects no digits after dash', () => {
  assert.equal(isValidSurveyNo('SEABI-'),   false);
  assert.equal(isValidSurveyNo('SEABI-X'),  false);
  assert.equal(isValidSurveyNo('SEABI--1'), false);
});
