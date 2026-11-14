'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expressMayLeavePickup, expressMayFinish } = require('../express-gates');
const { remitLockPlan, minutesUntil } = require('../remit-lock');

test('express cannot leave pickup or finish until photos, confirms, and payment are done', () => {
  const bare = { type: 'express', paymentMode: 'transfer', status: 'picked_up' };
  assert.equal(expressMayLeavePickup(bare), false);
  assert.equal(expressMayLeavePickup({ type: 'ride' }), true);
  const picked = Object.assign({}, bare, { foodImage: 'https://example/p.jpg', customerOrderConfirmed: true, status: 'on_the_way' });
  assert.equal(expressMayLeavePickup(picked), true);
  assert.equal(expressMayFinish(picked).ok, false);
  const proved = Object.assign({}, picked, { deliveryProofUrl: 'https://example/d.jpg' });
  assert.match(expressMayFinish(proved).reason, /ยืนยันรับของ/);
  const confirmed = Object.assign({}, proved, { expressDropoffConfirmedAt: 1 });
  assert.match(expressMayFinish(confirmed).reason, /สลิป/);
  assert.equal(expressMayFinish(Object.assign({}, confirmed, { customerPaidAt: 2 })).ok, true);
  assert.equal(expressMayFinish(Object.assign({}, confirmed, { paymentMode: 'cash', customerPaidAt: null })).ok, true);
});

test('remittance locks only after 22:00 and keeps a verified-slip cooldown', () => {
  const before = Date.parse('2026-11-11T20:00:00+07:00');
  const due = Date.parse('2026-11-11T21:10:00+07:00');
  const late = Date.parse('2026-11-11T22:05:00+07:00');
  const nextDay = Date.parse('2026-11-12T00:05:00+07:00');
  assert.equal(minutesUntil(before, 21, 0), 60);
  assert.equal(remitLockPlan({ nowMs: before, amount: 8 }).action, 'wait');
  assert.equal(remitLockPlan({ nowMs: before, amount: 8 }).notify, true);
  assert.equal(remitLockPlan({ nowMs: due, amount: 8, pendingSlip: true }).action, 'hold');
  const locked = remitLockPlan({ nowMs: late, amount: 8, pendingSlip: false });
  assert.equal(locked.action, 'lock');
  assert.equal(locked.untilMs - late, 24 * 60 * 60 * 1000);
  assert.equal(remitLockPlan({ nowMs: late, amount: 8, pendingSlip: true }).action, 'hold');
  assert.equal(remitLockPlan({ nowMs: late, amount: 0, lockedUntilMs: late - 1000 }).action, 'clear');
  assert.equal(remitLockPlan({ nowMs: late, amount: 8, lockedUntilMs: late + 1000 }).action, 'keep');
  assert.equal(remitLockPlan({ nowMs: nextDay, amount: 0, lockedUntilMs: late + 24 * 60 * 60 * 1000 }).action, 'keep');
  const cooldown = remitLockPlan({ nowMs: late, amount: 0, cooldownUntilMs: late + 24 * 60 * 60 * 1000 });
  assert.equal(cooldown.action, 'keep');
  assert.equal(cooldown.phase, 'verification_cooldown');
});
