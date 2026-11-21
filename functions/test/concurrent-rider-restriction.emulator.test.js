'use strict';

/**
 * Emulator concurrency test for rider work restrictions.
 *
 * Run with:
 *   npm run test:concurrency --prefix functions
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  setRiderWorkRestrictionTransaction
} = require('../rider-restriction-service');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'chauat-go-b9841';
const RIDER_ID = 'concurrency-test-rider';
const hasFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const testWithEmulator = hasFirestoreEmulator ? test : test.skip;
const db = hasFirestoreEmulator ? getDb() : null;

function getDb() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is required. Start the Firestore Emulator first.'
    );
  }

  const app = initializeApp(
    { projectId: PROJECT_ID },
    `concurrency-test-${process.pid}-${Date.now()}`
  );
  return getFirestore(app);
}

function makeRequestId(label) {
  return `${label}-${crypto.randomUUID()}`;
}

function serviceRequest(input) {
  return setRiderWorkRestrictionTransaction({
    db,
    ...input
  });
}

async function seedRider() {
  const oldAudits = await db.collection('rider_lock_audits')
    .where('riderId', '==', RIDER_ID)
    .get();
  if (!oldAudits.empty) {
    const cleanup = db.batch();
    oldAudits.docs.forEach((doc) => cleanup.delete(doc.ref));
    await cleanup.commit();
  }

  await db.collection('riders').doc(RIDER_ID).set({
    riderId: RIDER_ID,
    name: 'Concurrency Test Rider',
    verified: true,
    onlineLockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000),
    onlineLockReason: 'admin_manual',
    manualLockDurationHours: 12,
    manualLockBy: 'previous-admin',
    manualLockAt: new Date(),
    riskRestrictionUntil: new Date(Date.now() + 6 * 60 * 60 * 1000),
    safetySuspensionUntil: new Date(Date.now() + 8 * 60 * 60 * 1000),
    complianceRestrictionUntil: new Date(Date.now() + 10 * 60 * 60 * 1000),
    remittanceVerificationUntil: new Date(Date.now() + 12 * 60 * 60 * 1000),
    restrictionRevision: 7
  });
}

async function readState() {
  const rider = await db.collection('riders').doc(RIDER_ID).get();
  const audits = await db.collection('rider_lock_audits')
    .where('riderId', '==', RIDER_ID)
    .get();
  return { rider: rider.data(), audits: audits.docs };
}

testWithEmulator('two admins racing on the same revision: exactly one commits', async () => {
  await seedRider();

  const expectedRevision = 7;
  const requestA = {
    riderId: RIDER_ID,
    action: 'block24',
    reason: 'Admin A ตรวจสอบเคสยอดค้าง',
    expectedRevision,
    requestId: makeRequestId('admin-a'),
    changedBy: 'admin-a'
  };
  const requestB = {
    riderId: RIDER_ID,
    action: 'clear',
    reason: 'Admin B เปิดทำงานหลังตรวจสอบ',
    expectedRevision,
    requestId: makeRequestId('admin-b'),
    changedBy: 'admin-b'
  };

  const results = await Promise.allSettled([
    serviceRequest(requestA),
    serviceRequest(requestB)
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'aborted');

  const state = await readState();
  assert.equal(state.rider.restrictionRevision, 8);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].data().nextRevision, 8);
});

testWithEmulator('retrying the same requestId is idempotent and creates no second audit', async () => {
  await seedRider();

  const request = {
    riderId: RIDER_ID,
    action: 'block12',
    reason: 'ตรวจสอบซ้ำด้วย Request ID เดิม',
    expectedRevision: 7,
    requestId: makeRequestId('retry'),
    changedBy: 'admin-a'
  };

  const first = await serviceRequest(request);
  const second = await serviceRequest(request);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.auditId, first.auditId);

  const state = await readState();
  assert.equal(state.rider.restrictionRevision, 8);
  assert.equal(state.audits.length, 1);
});

testWithEmulator('reusing a requestId with a different payload is rejected', async () => {
  await seedRider();

  const requestId = makeRequestId('reuse');
  await serviceRequest({
    riderId: RIDER_ID,
    action: 'block24',
    reason: 'คำสั่งแรก',
    expectedRevision: 7,
    requestId,
    changedBy: 'admin-a'
  });

  await assert.rejects(
    serviceRequest({
      riderId: RIDER_ID,
      action: 'clear',
      reason: 'พยายามใช้ ID เดิมกับคำสั่งใหม่',
      expectedRevision: 8,
      requestId,
      changedBy: 'admin-b'
    }),
    (error) => error && error.code === 'already-exists'
  );

  const state = await readState();
  assert.equal(state.rider.restrictionRevision, 8);
  assert.equal(state.audits.length, 1);
});

testWithEmulator('clear removes only the manual lock and preserves policy restrictions', async () => {
  await seedRider();

  await serviceRequest({
    riderId: RIDER_ID,
    action: 'clear',
    reason: 'ล้างเฉพาะ Manual Lock',
    expectedRevision: 7,
    requestId: makeRequestId('clear-policy'),
    changedBy: 'admin-a'
  });

  const state = await readState();
  assert.equal(state.rider.onlineLockReason, undefined);
  assert.equal(state.rider.manualLockBy, undefined);
  assert.ok(state.rider.riskRestrictionUntil);
  assert.ok(state.rider.safetySuspensionUntil);
  assert.ok(state.rider.complianceRestrictionUntil);
  assert.ok(state.rider.remittanceVerificationUntil);
});
