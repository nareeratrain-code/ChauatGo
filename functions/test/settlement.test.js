'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopGpDue, riderDailyDue, riderReviewPlan, publicPayout, settlementChatId } = require('../settlement');

const DAY = 86400000;

test('shop GP becomes due only after the existing 60-day promo', () => {
  const now = Date.parse('2026-11-11T10:00:00+07:00');
  const start = now - 61 * DAY;
  assert.equal(shopGpDue({ gpStartDate: start, gpPending: 12.5 }, now).due, true);
  assert.equal(shopGpDue({ gpStartDate: start, gpPending: 12.5 }, now).amount, 12.5);
  assert.equal(shopGpDue({ gpStartDate: now - 59 * DAY, gpPending: 12.5 }, now).due, false);
  assert.equal(shopGpDue({ gpStartDate: null, gpPending: 12.5 }, now).due, false);
  assert.equal(shopGpDue({ gpStartDate: start, gpPending: 0 }, now).due, false);
});

test('rider remittance matches today unpaid fare times 20 percent and 21:00', () => {
  const morning = Date.parse('2026-11-11T10:00:00+07:00');
  const night = Date.parse('2026-11-11T21:05:00+07:00');
  const jobs = [
    { id: 'a', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') },
    { id: 'b', status: 'delivered', fare: 50, riderPaid: false, deliveredAt: Date.parse('2026-11-11T18:00:00+07:00') },
    { id: 'paid', status: 'done', fare: 80, riderPaid: true, doneAt: Date.parse('2026-11-11T08:00:00+07:00') },
    { id: 'old', status: 'done', fare: 200, riderPaid: false, doneAt: Date.parse('2026-11-10T12:00:00+07:00') },
    { id: 'live', status: 'on_the_way', fare: 40, riderPaid: false, createdAt: morning }
  ];
  const due = riderDailyDue(jobs, morning);
  assert.equal(due.amount, 30);
  assert.deepEqual(due.jobIds, ['a', 'b']);
  assert.equal(due.cutoff, '21:00');
  assert.equal(due.overdue, false);
  assert.equal(riderDailyDue(jobs, night).overdue, true);
});

test('admin confirm marks only a matching pending slip and reject does not', () => {
  const jobs = [
    { id: 'a', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const ok = riderReviewPlan({ status: 'pending', amount: 20, dateKey: '2026-11-11' }, jobs, 'verify');
  assert.equal(ok.status, 'verified');
  assert.deepEqual(ok.jobIds, ['a']);
  const rejected = riderReviewPlan({ status: 'pending', amount: 20, dateKey: '2026-11-11' }, jobs, 'reject');
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(rejected.jobIds, []);
  assert.throws(() => riderReviewPlan({ status: 'pending', amount: 15, dateKey: '2026-11-11' }, jobs, 'verify'), /ไม่ตรง/);
  assert.throws(() => riderReviewPlan({ status: 'verified', amount: 20, dateKey: '2026-11-11' }, jobs, 'reject'), /อนุมัติแล้ว/);
  assert.equal(riderReviewPlan({ status: 'rejected', amount: 20, dateKey: '2026-11-11' }, jobs, 'reject').already, true);
});

test('published payout instructions omit anything that is not the payment account', () => {
  assert.deepEqual(publicPayout({
    accountName: 'ChauatGo', accountNumber: '123', bankName: 'KBANK', promptPay: '081',
    qrUrl: 'https://example.test/qr.jpg', secret: 'nope', notes: 'internal'
  }), {
    accountName: 'ChauatGo', accountNumber: '123', bankName: 'KBANK', promptPay: '081',
    qrUrl: 'https://example.test/qr.jpg'
  });
  assert.equal(settlementChatId('shop', 'shop1'), 'shop_shop1');
  assert.equal(settlementChatId('rider', 'rider1'), 'rider_rider1');
});
