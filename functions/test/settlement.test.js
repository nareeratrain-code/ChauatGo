'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopGpDue, riderDailyDue, riderReviewPlan, publicPayout, settlementChatId, riderRemittanceId, riderRemittanceDateKey } = require('../settlement');
const { effectiveLockPlan } = require('../remit-lock');

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

test('jobs completed at or after 21:00 are due in the next Bangkok date window', () => {
  const afterNine = Date.parse('2026-11-16T21:05:00+07:00');
  const nextMorning = Date.parse('2026-11-17T10:00:00+07:00');
  const job = { id: 'late-1', status: 'done', fare: 428, riderPaid: false, doneAt: afterNine };
  assert.equal(riderRemittanceDateKey(job), '2026-11-17');
  const tonight = riderDailyDue([job], afterNine);
  assert.equal(tonight.amount, 0);
  assert.equal(tonight.nextAmount, 85.6);
  assert.equal(tonight.nextDateKey, '2026-11-17');
  assert.equal(tonight.overdue, false);
  const tomorrow = riderDailyDue([job], nextMorning);
  assert.equal(tomorrow.amount, 85.6);
  assert.deepEqual(tomorrow.jobIds, ['late-1']);
});

test('late-night remittance rolls over exactly at Bangkok midnight', () => {
  const job = {
    id: 'midnight-rollover',
    status: 'delivered',
    fare: 250,
    riderPaid: false,
    deliveredAt: Date.parse('2026-11-16T23:59:59+07:00')
  };
  const beforeMidnight = riderDailyDue([job], Date.parse('2026-11-16T23:59:59+07:00'));
  assert.equal(beforeMidnight.dateKey, '2026-11-16');
  assert.equal(beforeMidnight.amount, 0);
  assert.equal(beforeMidnight.nextDateKey, '2026-11-17');
  assert.equal(beforeMidnight.nextAmount, 50);
  const afterMidnight = riderDailyDue([job], Date.parse('2026-11-17T00:00:00+07:00'));
  assert.equal(afterMidnight.dateKey, '2026-11-17');
  assert.equal(afterMidnight.amount, 50);
  assert.deepEqual(afterMidnight.jobIds, ['midnight-rollover']);
});

test('remittance due excludes jobs from the wrong cycle or without an eligible completion', () => {
  const now = Date.parse('2026-11-17T10:00:00+07:00');
  const jobs = [
    { id: 'current', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-17T09:00:00+07:00') },
    { id: 'previous-day', status: 'done', fare: 500, riderPaid: false, doneAt: Date.parse('2026-11-16T20:59:59+07:00') },
    { id: 'already-paid', status: 'delivered', fare: 500, riderPaid: true, deliveredAt: Date.parse('2026-11-17T08:00:00+07:00') },
    { id: 'still-active', status: 'on_the_way', fare: 500, riderPaid: false, createdAt: Date.parse('2026-11-17T08:00:00+07:00') },
    { id: 'missing-completion', status: 'done', fare: 500, riderPaid: false },
    { id: 'invalid-fare', status: 'done', fare: 'not-a-number', riderPaid: false, doneAt: Date.parse('2026-11-17T08:30:00+07:00') }
  ];
  const due = riderDailyDue(jobs, now);

  assert.equal(due.amount, 20);
  assert.deepEqual(due.jobIds, ['current']);
  assert.deepEqual(due.nextJobIds, []);
});

test('a job completed exactly at 21:00 is not counted in the current remittance window', () => {
  const atCutoff = Date.parse('2026-11-17T21:00:00+07:00');
  const beforeCutoff = Date.parse('2026-11-17T20:59:59+07:00');
  const jobs = [
    { id: 'at-cutoff', status: 'done', fare: 100, riderPaid: false, doneAt: atCutoff },
    { id: 'before-cutoff', status: 'done', fare: 50, riderPaid: false, doneAt: beforeCutoff }
  ];

  const due = riderDailyDue(jobs, atCutoff);
  assert.equal(due.amount, 10);
  assert.deepEqual(due.jobIds, ['before-cutoff']);
  assert.equal(due.nextAmount, 20);
  assert.deepEqual(due.nextJobIds, ['at-cutoff']);
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
  assert.throws(() => riderReviewPlan({ status: 'pending', amount: 15, dateKey: '2026-11-11' }, jobs, 'verify'), /น้อยกว่ายอด/);
  assert.throws(() => riderReviewPlan({ status: 'verified', amount: 20, dateKey: '2026-11-11' }, jobs, 'reject'), /อนุมัติแล้ว/);
  assert.equal(riderReviewPlan({ status: 'rejected', amount: 20, dateKey: '2026-11-11' }, jobs, 'reject').already, true);
});

test('admin accepts an overpayment while reporting the calculated due and overage', () => {
  const jobs = [
    { id: 'a', status: 'done', fare: 30, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const plan = riderReviewPlan({ status: 'pending', amount: 10, dateKey: '2026-11-11' }, jobs, 'verify');
  assert.equal(plan.status, 'verified');
  assert.equal(plan.dueAmount, 6);
  assert.equal(plan.overpaidAmount, 4);
});

test('review uses amountSubmitted when it is separate from server-calculated due', () => {
  const jobs = [
    { id: 'a', status: 'done', fare: 30, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const plan = riderReviewPlan({ status: 'pending', amount: 6, amountSubmitted: 10, dateKey: '2026-11-11' }, jobs, 'verify');
  assert.equal(plan.dueAmount, 6);
  assert.equal(plan.overpaidAmount, 4);
});

test('underpaid amountSubmitted is rejected even when legacy amount matches the due', () => {
  const jobs = [
    { id: 'underpaid-1', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  assert.throws(
    () => riderReviewPlan({
      status: 'pending',
      amount: 20,
      amountSubmitted: 19.99,
      dateKey: '2026-11-11'
    }, jobs, 'verify'),
    (error) => error.code === 'failed-precondition' && /น้อยกว่ายอด/.test(error.message)
  );
});

test('zero, negative, and missing submitted amounts cannot verify a positive remittance', () => {
  const jobs = [
    { id: 'invalid-submitted-amount', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];

  for (const amountSubmitted of [0, -0.01, null, undefined]) {
    assert.throws(
      () => riderReviewPlan({ status: 'pending', amountSubmitted, dateKey: '2026-11-11' }, jobs, 'verify'),
      (error) => error.code === 'failed-precondition' && /น้อยกว่ายอด/.test(error.message)
    );
  }
});

test('a remittance for the wrong Bangkok date cannot verify against another cycle', () => {
  const jobs = [
    { id: 'wrong-cycle', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];

  assert.throws(
    () => riderReviewPlan({ status: 'pending', amountSubmitted: 100, dateKey: '2026-11-12' }, jobs, 'verify'),
    (error) => error.code === 'failed-precondition' && /น้อยกว่ายอด/.test(error.message)
  );
});

test('overpaid amountSubmitted is accepted and reports only the excess amount', () => {
  const jobs = [
    { id: 'overpaid-1', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const plan = riderReviewPlan({
    status: 'pending',
    amount: 20,
    amountSubmitted: 40,
    dateKey: '2026-11-11'
  }, jobs, 'verify');
  assert.equal(plan.status, 'verified');
  assert.equal(plan.dueAmount, 20);
  assert.equal(plan.overpaidAmount, 20);
  assert.deepEqual(plan.jobIds, ['overpaid-1']);
});

test('overpaid amountSubmitted is rounded to two decimals before calculating the excess', () => {
  const jobs = [
    { id: 'overpaid-rounding', status: 'done', fare: 30, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const plan = riderReviewPlan({
    status: 'pending',
    amountSubmitted: 6.005,
    dateKey: '2026-11-11'
  }, jobs, 'verify');
  assert.equal(plan.dueAmount, 6);
  assert.equal(plan.overpaidAmount, 0.01);
});

test('review rejects Infinity and NaN submitted amounts', () => {
  const jobs = [
    { id: 'invalid-amount', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  for (const amountSubmitted of [Infinity, NaN]) {
    assert.throws(
      () => riderReviewPlan({ status: 'pending', amountSubmitted, dateKey: '2026-11-11' }, jobs, 'verify'),
      (error) => error.code === 'failed-precondition'
    );
  }
});

test('negative and non-finite fares cannot reduce or create the remittance due', () => {
  const jobs = [
    { id: 'valid-fare', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') },
    { id: 'negative-fare', status: 'done', fare: -50, riderPaid: false, doneAt: Date.parse('2026-11-11T09:30:00+07:00') },
    { id: 'infinite-fare', status: 'done', fare: Infinity, riderPaid: false, doneAt: Date.parse('2026-11-11T09:45:00+07:00') }
  ];
  const due = riderDailyDue(jobs, Date.parse('2026-11-11T10:00:00+07:00'));
  assert.equal(due.amount, 20);
  assert.deepEqual(due.jobIds, ['valid-fare']);
});

test('submitted amounts with more than two decimals use one rounded canonical value', () => {
  const jobs = [
    { id: 'decimal-amount', status: 'done', fare: 100, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  const plan = riderReviewPlan({
    status: 'pending',
    amountSubmitted: 20.005,
    dateKey: '2026-11-11'
  }, jobs, 'verify');
  assert.equal(plan.submittedAmount, 20.01);
  assert.equal(plan.dueAmount, 20);
  assert.equal(plan.overpaidAmount, 0.01);
});

test('effective lock keeps a longer risk or safety restriction after remittance review', () => {
  const now = Date.parse('2026-11-11T10:00:00+07:00');
  const cooldown = now + 24 * 60 * 60 * 1000;
  const risk = now + 48 * 60 * 60 * 1000;
  const plan = effectiveLockPlan({
    nowMs: now,
    verificationCooldownUntilMs: cooldown,
    riskRestrictionUntilMs: risk
  });
  assert.equal(plan.locked, true);
  assert.equal(plan.untilMs, risk);
  assert.equal(plan.reason, 'risk_restriction');
});

test('admin still rejects a remittance below the calculated due', () => {
  const jobs = [
    { id: 'a', status: 'done', fare: 30, riderPaid: false, doneAt: Date.parse('2026-11-11T09:00:00+07:00') }
  ];
  assert.throws(
    () => riderReviewPlan({ status: 'pending', amount: 5.99, dateKey: '2026-11-11' }, jobs, 'verify'),
    /น้อยกว่ายอด/
  );
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

test('rider remittance id is deterministic per rider and Bangkok date', () => {
  assert.equal(riderRemittanceId('rider1', '2026-11-14'), 'rider_rider1_2026-11-14');
  assert.equal(riderRemittanceId('rider1', '2026-11-14'), riderRemittanceId('rider1', '2026-11-14'));
  assert.notEqual(riderRemittanceId('rider1', '2026-11-14'), riderRemittanceId('rider1', '2026-11-15'));
});
