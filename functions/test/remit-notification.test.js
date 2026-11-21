'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('remittance scheduler sends a one-hour warning before the 22:00 lock window', () => {
  assert.match(source, /plan\.lockWarning && rider\.remitLockWarningDate !== plan\.key/);
  assert.match(source, /title: 'ใกล้เวลาพักรับงาน'/);
  assert.match(source, /อีก 1 ชั่วโมงจะถึง 22:00/);
  assert.match(source, /phase: 'lock_warning'/);
  assert.match(source, /sendRemitPush\(riderRef, rider, 'remitLockWarningDate', plan\.key/);
});

test('remittance scheduler sends a deduplicated notification immediately after creating a lock', () => {
  assert.match(source, /let createdLock = false/);
  assert.match(source, /createdLock = true/);
  assert.match(source, /const lockNeedsPush = \(lockState\.createdLock \|\| plan\.phase === 'remit_lock'\)/);
  assert.match(source, /&& !lockState\.manualLockActive/);
  assert.match(source, /rider\.remitLockNoticeUntil !== plan\.untilMs/);
  assert.match(source, /title: 'บัญชีถูกพักรับงานอัตโนมัติ'/);
  assert.match(source, /ปลดล็อก \$\{unlockLabel\(plan\.untilMs\)\}/);
  assert.match(source, /phase: 'locked'/);
  assert.match(source, /sendRemitPush\(riderRef, rider, 'remitLockNoticeUntil', plan\.untilMs/);
});

test('remittance scheduler refreshes the Bangkok date window before deciding FCM lock state', () => {
  assert.match(source, /const orderSnap = await db\.collection\('orders'\)/);
  assert.match(source, /const due = riderDailyDue\(jobs, nowMs\)/);
  assert.match(source, /amount: currentAmount/);
  assert.match(source, /dateKey: due\.dateKey/);
  assert.match(source, /nextDateKey: due\.nextDateKey/);
});

test('completed rider jobs seed a settlement queue even when the rider app is closed', () => {
  assert.match(source, /after\.status === 'done' \|\| after\.status === 'delivered'/);
  assert.match(source, /settlement_queue'\)\.doc\('rider_' \+ String\(after\.riderId\)\)/);
  assert.match(source, /partyId: String\(after\.riderId\)/);
});

test('admin remittance review refreshes current and next-cycle queue metadata', () => {
  assert.match(source, /const freshDue = riderDailyDue\(remainingJobs, now\.toMillis\(\)\)/);
  assert.match(source, /amount: plan\.status === 'verified' \? freshDue\.amount/);
  assert.match(source, /nextAmount: freshDue\.nextAmount/);
  assert.match(source, /nextDateKey: freshDue\.nextDateKey/);
});
