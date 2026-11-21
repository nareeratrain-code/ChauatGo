'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
const functions = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const restrictionService = fs.readFileSync(
  path.join(__dirname, '..', 'functions', 'rider-restriction-service.js'),
  'utf8'
);
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const rider = fs.readFileSync(path.join(__dirname, '..', 'rider.js'), 'utf8');

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

test('Admin settlement exposes all rider restriction actions through the callable', () => {
  assert.match(admin, /data-rider-restriction/);
  assert.match(admin, /data-rider-action="clear"/);
  assert.match(admin, /data-rider-action="block12"/);
  assert.match(admin, /data-rider-action="block24"/);
  assert.match(admin, /setRiderWorkRestriction/);
  assert.match(admin, /\[data-reject-gp\],\[data-rider-restriction\]/);
});

test('Manual restriction is admin-only, audited, and enforced by dispatch', () => {
  assert.match(functions, /exports\.setRiderWorkRestriction = onCall/);
  assert.match(functions, /callerIsAdmin\(db, req\.auth\)/);
  assert.match(functions, /setRiderWorkRestrictionTransaction/);
  assert.match(restrictionService, /rider_lock_audits/);
  assert.match(restrictionService, /runTransaction/);
  assert.match(restrictionService, /requestFingerprint/);
  assert.match(restrictionService, /restrictionRevision/);
  assert.match(functions, /state\.reason === 'admin_manual'/);
  assert.match(functions, /adminManualUntilMs: manualLockIsActive \? timestampMillis\(data\.onlineLockedUntil\) : 0/);
  assert.match(rules, /match \/rider_lock_audits\/\{auditId\}/);
  assert.match(rules, /allow read: if isAdmin\(\);/);
  assert.match(rules, /allow create, update, delete: if false;/);
  assert.match(rules, /function adminRiderUpdateOk\(\)/);
  assert.match(rules, /unchanged\('restrictionRevision'\)/);
  assert.match(rules, /allow update: if adminRiderUpdateOk\(\)/);
});

test('Rider UI explains a manual restriction instead of showing a remittance reason', () => {
  assert.match(rider, /onlineLockReason === 'admin_manual'/);
  assert.match(rider, /พักรับงานตามคำสั่งแอดมิน/);
});

test('Manual restriction contract carries request id and optimistic revision', () => {
  assert.match(admin, /requestId: newRestrictionRequestId\(\)/);
  assert.match(admin, /expectedRevision: Number\(rider\.restrictionRevision \|\| 0\)/);
  assert.match(functions, /requestId: req\.data\?\.requestId/);
  assert.match(functions, /expectedRevision: req\.data\?\.expectedRevision/);
});
