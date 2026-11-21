'use strict';

const { HttpsError } = require('firebase-functions/v2/https');

const NUMERIC_CODES = {
  3: 'invalid-argument',
  4: 'deadline-exceeded',
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  8: 'resource-exhausted',
  9: 'failed-precondition',
  10: 'aborted',
  14: 'unavailable'
};

const CALLABLE_CODES = new Set([
  'aborted',
  'already-exists',
  'deadline-exceeded',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'permission-denied',
  'resource-exhausted',
  'unavailable'
]);

function reviewRiderError(err) {
  if (err instanceof HttpsError) return err;
  const rawCode = err && err.code;
  const code = NUMERIC_CODES[rawCode] || String(rawCode || '').toLowerCase();
  if (CALLABLE_CODES.has(code)) {
    return new HttpsError(code, err.message || 'ตรวจสอบสลิปไม่สำเร็จชั่วคราว');
  }
  if (/ไม่พบรายการสลิป/.test(err && err.message || '')) {
    return new HttpsError('not-found', err.message);
  }
  if (/สถานะสลิป|ยอดสลิป|ยอดที่ต้องโอน/.test(err && err.message || '')) {
    return new HttpsError('failed-precondition', err.message);
  }
  console.error('reviewRiderRemittance failed', {
    code: rawCode || '',
    message: err && err.message || '',
    stack: err && err.stack || ''
  });
  return new HttpsError('internal', 'ตรวจสอบสลิปไรเดอร์ไม่สำเร็จ');
}

module.exports = { reviewRiderError };
