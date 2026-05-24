import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSurveyNo } from './validate.js';

test('isValidSurveyNo: accepts SEABI with exactly 12 digits', () => {
  assert.equal(isValidSurveyNo('SEABI-110260400183'), true);
  assert.equal(isValidSurveyNo('SEABI-000000000000'), true);
  assert.equal(isValidSurveyNo('SEABI-999999999999'), true);
});

test('isValidSurveyNo: rejects SEABI with wrong digit count', () => {
  assert.equal(isValidSurveyNo('SEABI-1'),               false);
  assert.equal(isValidSurveyNo('SEABI-12345'),           false);
  assert.equal(isValidSurveyNo('SEABI-11026040018'),     false); // 11 digits
  assert.equal(isValidSurveyNo('SEABI-1102604001830'),   false); // 13 digits
  assert.equal(isValidSurveyNo('SEABI-12345678901234'),  false);
});

test('isValidSurveyNo: accepts SETP/SESV with exactly 8 digits', () => {
  assert.equal(isValidSurveyNo('SETP-68070146'), true);
  assert.equal(isValidSurveyNo('SETP-00000001'), true);
  assert.equal(isValidSurveyNo('SESV-65120009'), true);
  assert.equal(isValidSurveyNo('SESV-12345678'), true);
});

test('isValidSurveyNo: rejects SETP/SESV with wrong digit count', () => {
  assert.equal(isValidSurveyNo('SETP-1'),         false);
  assert.equal(isValidSurveyNo('SETP-1234567'),   false); // 7 digits
  assert.equal(isValidSurveyNo('SETP-123456789'), false); // 9 digits
  assert.equal(isValidSurveyNo('SESV-1'),         false);
  assert.equal(isValidSurveyNo('SESV-660800449'), false); // 9 digits (legacy 2023)
  assert.equal(isValidSurveyNo('SESV-'),          false);
});

test('isValidSurveyNo: accepts SEAIO with 3-char region + 9 digits', () => {
  // Real samples from prod DB.
  assert.equal(isValidSurveyNo('SEAIO-BKK-211102965'), true);
  assert.equal(isValidSurveyNo('SEAIO-AYA-220605076'), true);
  assert.equal(isValidSurveyNo('SEAIO-RYG-210302741'), true);
  assert.equal(isValidSurveyNo('SEAIO-CBI-210201790'), true);
  assert.equal(isValidSurveyNo('SEAIO-CMI-220500001'), true);
  // Alphanumeric region (R14/P28/P05 seen in prod).
  assert.equal(isValidSurveyNo('SEAIO-R14-220500001'), true);
  assert.equal(isValidSurveyNo('SEAIO-P28-220500001'), true);
  assert.equal(isValidSurveyNo('SEAIO-P05-220500001'), true);
});

test('isValidSurveyNo: rejects SEAIO with wrong region or digit count', () => {
  assert.equal(isValidSurveyNo('SEAIO-12345'),        false); // no region
  assert.equal(isValidSurveyNo('SEAIO--220500001'),   false); // empty region
  assert.equal(isValidSurveyNo('SEAIO-BK-220500001'), false); // 2-char region
  assert.equal(isValidSurveyNo('SEAIO-BKKX-220500001'),false); // 4-char region
  assert.equal(isValidSurveyNo('SEAIO-bkk-220500001'),false); // lowercase region
  assert.equal(isValidSurveyNo('SEAIO-BKK-12345678'), false); // 8 digits
  assert.equal(isValidSurveyNo('SEAIO-BKK-1234567890'),false); // 10 digits
  assert.equal(isValidSurveyNo('SEAIO-BKK-'),         false); // no digits
  assert.equal(isValidSurveyNo('SEAIO-BKK-12-345'),   false); // extra dash
});

test('isValidSurveyNo: rejects empty / null / non-string', () => {
  assert.equal(isValidSurveyNo(''), false);
  assert.equal(isValidSurveyNo(null), false);
  assert.equal(isValidSurveyNo(undefined), false);
  assert.equal(isValidSurveyNo(110260400183), false);
  assert.equal(isValidSurveyNo({}), false);
});

test('isValidSurveyNo: rejects wrong / partial prefix', () => {
  assert.equal(isValidSurveyNo('EABI-110260400183'),  false); // dropped S
  assert.equal(isValidSurveyNo('SEAS-110260400183'),  false);
  assert.equal(isValidSurveyNo('ABC-110260400183'),   false);
  assert.equal(isValidSurveyNo('SEABIX-110260400183'),false);
  assert.equal(isValidSurveyNo('SVSE-12345678'),      false); // not in allowed set
  assert.equal(isValidSurveyNo('SEAP-68080202'),      false);
  assert.equal(isValidSurveyNo('SEASS-12345678'),     false);
});

test('isValidSurveyNo: rejects missing dash / lowercase / spaces', () => {
  assert.equal(isValidSurveyNo('SEABI110260400183'),    false);
  assert.equal(isValidSurveyNo('SEABI 110260400183'),   false);
  assert.equal(isValidSurveyNo('seabi-110260400183'),   false);
  assert.equal(isValidSurveyNo(' SEABI-110260400183'),  false);
  assert.equal(isValidSurveyNo('SEABI-110260400183 '),  false);
  assert.equal(isValidSurveyNo('SEABI-1102604 00183'),  false);
});

test('isValidSurveyNo: rejects Thai / mixed garbage', () => {
  assert.equal(isValidSurveyNo('ไม่เบิก'),               false);
  assert.equal(isValidSurveyNo('ิSEABI-110260400183'),    false); // Thai sara
  assert.equal(isValidSurveyNo('อSEABI-110260400183'),   false);
  assert.equal(isValidSurveyNo('SEABI-110260400183xyz'),false);
});

test('isValidSurveyNo: rejects letters in digit portion', () => {
  assert.equal(isValidSurveyNo('SEABI-11026040018X'),  false);
  assert.equal(isValidSurveyNo('SETP-1234567X'),       false);
  assert.equal(isValidSurveyNo('SEAIO-BKK-21110296X'), false);
});
