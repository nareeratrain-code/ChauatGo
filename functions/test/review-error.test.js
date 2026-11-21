'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpsError } = require('firebase-functions/v2/https');
const { reviewRiderError } = require('../review-error');

test('reviewRiderError maps retryable Firestore names to the same callable codes', () => {
  for (const code of ['aborted', 'unavailable', 'deadline-exceeded']) {
    const mapped = reviewRiderError(Object.assign(new Error('temporary Firestore failure'), { code }));
    assert.ok(mapped instanceof HttpsError);
    assert.equal(mapped.code, code);
    assert.equal(mapped.message, 'temporary Firestore failure');
  }
});

test('reviewRiderError maps numeric gRPC codes from Firestore', () => {
  const cases = [
    [10, 'aborted'],
    [14, 'unavailable'],
    [4, 'deadline-exceeded'],
    [5, 'not-found'],
    [9, 'failed-precondition']
  ];
  for (const [sourceCode, expectedCode] of cases) {
    const mapped = reviewRiderError(Object.assign(new Error('Firestore error'), { code: sourceCode }));
    assert.equal(mapped.code, expectedCode);
  }
});

test('reviewRiderError maps remittance business errors without exposing them as internal', () => {
  assert.equal(reviewRiderError(new Error('ไม่พบรายการสลิป')).code, 'not-found');
  assert.equal(reviewRiderError(new Error('สถานะสลิปไม่ถูกต้อง')).code, 'failed-precondition');
  assert.equal(reviewRiderError(new Error('ยอดสลิปน้อยกว่ายอดที่ต้องโอนวันนี้')).code, 'failed-precondition');
});

test('reviewRiderError preserves an existing HttpsError instance', () => {
  const original = new HttpsError('permission-denied', 'เฉพาะแอดมินการเงิน');
  assert.strictEqual(reviewRiderError(original), original);
});

test('reviewRiderError falls back to internal for unknown errors', () => {
  const mapped = reviewRiderError(Object.assign(new Error('database driver failure'), { code: 'unknown-code' }));
  assert.ok(mapped instanceof HttpsError);
  assert.equal(mapped.code, 'internal');
  assert.equal(mapped.message, 'ตรวจสอบสลิปไรเดอร์ไม่สำเร็จ');
});
