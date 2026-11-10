'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeId,
  normalizeOrderIds,
  buildPayoutId,
  calculatePayoutOrders
} = require('../payout');

test('normalizes and sorts order ids for a stable payout key', () => {
  assert.deepEqual(normalizeOrderIds(['b', 'a', 'b']), ['a', 'b']);
  assert.equal(buildPayoutId('rider-1', ['b', 'a']), buildPayoutId('rider-1', ['a', 'b', 'a']));
});

test('rejects malformed payout identifiers before any Firestore read', () => {
  for (const value of [null, 123, '', 'orders/other', 'bad\nvalue', 'x'.repeat(151)]) {
    assert.throws(() => normalizeId(value, 'รหัสออเดอร์'), /รหัสออเดอร์ไม่ถูกต้อง/);
  }
  assert.throws(
    () => normalizeOrderIds(['valid', { toString: () => 'orders/other' }]),
    /รหัสออเดอร์ไม่ถูกต้อง/
  );
});

test('calculates payout only from server-calculated gpRider', () => {
  const result = calculatePayoutOrders([
    { id: 'food-1', riderId: 'rider-1', status: 'done', gpRider: 10 },
    { id: 'food-2', riderId: 'rider-1', status: 'delivered', gpRider: 6.67 }
  ], 'rider-1');
  assert.deepEqual(result.orderIds, ['food-1', 'food-2']);
  assert.equal(result.amount, 16.67);
});

test('rejects an order already paid', () => {
  assert.throws(
    () => calculatePayoutOrders([{ id: 'paid-1', riderId: 'rider-1', status: 'done', gpRider: 20, riderPayoutPaid: true }], 'rider-1'),
    /ถูกโอนไปแล้ว/
  );
});

test('rejects missing server-calculated amount', () => {
  assert.throws(
    () => calculatePayoutOrders([{ id: 'legacy-1', riderId: 'rider-1', status: 'done', foodTotal: 1000 }], 'rider-1'),
    /ขาดยอด GP ไรเดอร์/
  );
});

test('rejects zero or negative rider GP', () => {
  for (const gpRider of [0, -0.01, Number.NaN, Infinity]) {
    assert.throws(
      () => calculatePayoutOrders([{ id: 'invalid-' + String(gpRider), riderId: 'rider-1', status: 'done', gpRider }], 'rider-1'),
      /ขาดยอด GP ไรเดอร์/
    );
  }
});

test('rejects non-terminal orders', () => {
  assert.throws(
    () => calculatePayoutOrders([{ id: 'active-1', riderId: 'rider-1', status: 'on_the_way', gpRider: 10 }], 'rider-1'),
    /ยังไม่เสร็จสมบูรณ์/
  );
});
