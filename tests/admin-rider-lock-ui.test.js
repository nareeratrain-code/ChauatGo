'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');

test('Admin rider cards expose realtime lock reason and unlock time', () => {
  assert.match(admin, /function riderLockUntil\(rider\)/);
  assert.match(admin, /onlineLockedUntil/);
  assert.match(admin, /remittanceVerificationUntil/);
  assert.match(admin, /remit_verified_cooldown/);
  assert.match(admin, /ปลดล็อก/);
  assert.match(admin, /riderLockMessage\(r\)/);
});

test('Admin blocks locked rider activation before Firestore write', () => {
  assert.match(admin, /const lockMessage = !online && riderLockMessage\(r\)/);
  assert.match(admin, /เปิดรับงานไม่ได้ — \$\{lockMessage\}/);
});

test('Admin translates Firestore permission denied into a lock-aware warning', () => {
  assert.match(admin, /function isPermissionDeniedError\(err\)/);
  assert.match(admin, /isPermissionDeniedError\(err\) && !online/);
  assert.match(admin, /บัญชีไรเดอร์ยังถูกพักรับงาน/);
  assert.match(admin, /adminFirebaseErrorText\(err, 'เปลี่ยนสถานะไรเดอร์ไม่สำเร็จ'\)/);
});
