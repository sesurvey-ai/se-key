import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSurveyNo } from './validate.js';

test('isValidSurveyNo: accepts SEABI/SETP/SESV/SEAIO with digits', () => {
  assert.equal(isValidSurveyNo('SEABI-1'), true);
  assert.equal(isValidSurveyNo('SEABI-12345'), true);
  assert.equal(isValidSurveyNo('SETP-12345'), true);
  assert.equal(isValidSurveyNo('SESV-12345'), true);
  assert.equal(isValidSurveyNo('SEAIO-12345'), true);
  assert.equal(isValidSurveyNo('SEABI-123456789012'), true);
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
