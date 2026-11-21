'use strict';

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  FieldValue,
  Timestamp
} = require('firebase-admin/firestore');

const ACTION_HOURS = Object.freeze({
  clear: 0,
  block12: 12,
  block24: 24
});

const MAX_REASON_LENGTH = 300;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_RIDER_ID_LENGTH = 128;

function cleanString(value, maxLength) {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : '';
}

function normalizeRequestId(value) {
  return cleanString(value, MAX_REQUEST_ID_LENGTH)
    .replace(/[^A-Za-z0-9._:-]/g, '_');
}

function makeAuditId(riderId, requestId) {
  return crypto
    .createHash('sha256')
    .update(`restriction:${riderId}:${requestId}`)
    .digest('hex');
}

function makeRequestFingerprint(input) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      riderId: input.riderId,
      action: input.action,
      reason: input.reason,
      expectedRevision: input.expectedRevision
    }))
    .digest('hex');
}

function restrictionSnapshot(data) {
  return {
    onlineLockedUntil: data.onlineLockedUntil || null,
    onlineLockReason: data.onlineLockReason || null,
    manualLockDurationHours: data.manualLockDurationHours || null,
    manualLockBy: data.manualLockBy || null,
    manualLockAt: data.manualLockAt || null,
    restrictionRevision: Number(data.restrictionRevision || 0)
  };
}

function validateInput(input) {
  const riderId = cleanString(input && input.riderId, MAX_RIDER_ID_LENGTH);
  const action = cleanString(input && input.action, 20);
  const reason = cleanString(input && input.reason, MAX_REASON_LENGTH);
  const requestId = normalizeRequestId(input && input.requestId);
  const expectedRevision = Number(input && input.expectedRevision);

  if (!riderId) {
    throw new HttpsError('invalid-argument', 'riderId ไม่ถูกต้อง');
  }
  if (!Object.prototype.hasOwnProperty.call(ACTION_HOURS, action)) {
    throw new HttpsError('invalid-argument', 'action ต้องเป็น clear, block12 หรือ block24');
  }
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'ต้องระบุ requestId');
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpsError('invalid-argument', 'expectedRevision ไม่ถูกต้อง');
  }
  if (action !== 'clear' && !reason) {
    throw new HttpsError('invalid-argument', 'กรุณาระบุเหตุผลสำหรับการบล็อก');
  }

  return { riderId, action, reason, requestId, expectedRevision };
}

/**
 * Transaction Core used by the Callable and Emulator tests.
 * It owns only Admin Manual Lock fields; Risk/Safety/Compliance and
 * Remittance policies are intentionally preserved by `clear`.
 */
async function setRiderWorkRestrictionTransaction({
  db,
  riderId,
  action,
  reason,
  requestId,
  expectedRevision,
  changedBy,
  changedByEmail = null
}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new TypeError('Firestore instance is required');
  }

  const input = validateInput({
    riderId,
    action,
    reason,
    requestId,
    expectedRevision
  });

  const riderRef = db.collection('riders').doc(input.riderId);
  const auditId = makeAuditId(input.riderId, input.requestId);
  const auditRef = db.collection('rider_lock_audits').doc(auditId);
  const now = Timestamp.now();
  const durationHours = ACTION_HOURS[input.action];
  const until = durationHours
    ? Timestamp.fromMillis(now.toMillis() + durationHours * 60 * 60 * 1000)
    : null;
  const requestFingerprint = makeRequestFingerprint(input);

  return db.runTransaction(async (tx) => {
    const riderSnap = await tx.get(riderRef);
    const auditSnap = await tx.get(auditRef);

    if (!riderSnap.exists) {
      throw new HttpsError('not-found', 'ไม่พบข้อมูลไรเดอร์');
    }

    if (auditSnap.exists) {
      const existing = auditSnap.data() || {};
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new HttpsError('already-exists', 'requestId นี้ถูกใช้กับคำสั่งอื่นแล้ว');
      }
      return {
        ok: true,
        idempotent: true,
        auditId: auditSnap.id,
        riderId: existing.riderId,
        action: existing.action,
        durationHours: Number(existing.durationHours || 0),
        until: existing.until || null,
        previousRevision: Number(existing.previousRevision || 0),
        nextRevision: Number(existing.nextRevision || 0)
      };
    }

    const rider = riderSnap.data() || {};
    const currentRevision = Number(rider.restrictionRevision || 0);
    if (currentRevision !== input.expectedRevision) {
      throw new HttpsError(
        'aborted',
        'สถานะ Rider ถูกเปลี่ยนโดย Admin คนอื่นแล้ว กรุณารีเฟรชข้อมูลก่อนลองใหม่'
      );
    }

    const nextRevision = currentRevision + 1;
    const patch = input.action === 'clear'
      ? {
          onlineLockedUntil: FieldValue.delete(),
          onlineLockReason: FieldValue.delete(),
          manualLockDurationHours: FieldValue.delete(),
          manualLockBy: FieldValue.delete(),
          manualLockAt: FieldValue.delete(),
          restrictionRevision: nextRevision,
          restrictionUpdatedAt: now,
          restrictionUpdatedBy: changedBy
        }
      : {
          onlineLockedUntil: until,
          onlineLockReason: 'admin_manual',
          manualLockDurationHours: durationHours,
          manualLockBy: changedBy,
          manualLockAt: now,
          restrictionRevision: nextRevision,
          restrictionUpdatedAt: now,
          restrictionUpdatedBy: changedBy
        };

    const next = input.action === 'clear'
      ? {
          onlineLockedUntil: null,
          onlineLockReason: null,
          manualLockDurationHours: null,
          manualLockBy: null,
          manualLockAt: null,
          restrictionRevision: nextRevision
        }
      : {
          onlineLockedUntil: until,
          onlineLockReason: 'admin_manual',
          manualLockDurationHours: durationHours,
          manualLockBy: changedBy,
          manualLockAt: now,
          restrictionRevision: nextRevision
        };

    tx.update(riderRef, patch);
    tx.create(auditRef, {
      riderId: input.riderId,
      action: input.action,
      lockReason: input.action === 'clear' ? 'admin_manual_clear' : 'admin_manual',
      durationHours,
      until,
      reason: input.reason,
      changedBy,
      changedByEmail: changedByEmail || null,
      requestId: input.requestId,
      requestFingerprint,
      previousRevision: currentRevision,
      nextRevision,
      previous: restrictionSnapshot(rider),
      next,
      createdAt: now
    });

    return {
      ok: true,
      idempotent: false,
      auditId,
      riderId: input.riderId,
      action: input.action,
      durationHours,
      until,
      previousRevision: currentRevision,
      nextRevision
    };
  }, { maxAttempts: 5 });
}

module.exports = {
  ACTION_HOURS,
  makeAuditId,
  makeRequestFingerprint,
  setRiderWorkRestrictionTransaction,
  validateInput
};
