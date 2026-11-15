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
  assert.match(source, /const lockNeedsPush = \(createdLock \|\| plan\.phase === 'remit_lock'\)/);
  assert.match(source, /rider\.remitLockNoticeUntil !== plan\.untilMs/);
  assert.match(source, /title: 'บัญชีถูกพักรับงานอัตโนมัติ'/);
  assert.match(source, /ปลดล็อก \$\{unlockLabel\(plan\.untilMs\)\}/);
  assert.match(source, /phase: 'locked'/);
  assert.match(source, /sendRemitPush\(riderRef, rider, 'remitLockNoticeUntil', plan\.untilMs/);
});
