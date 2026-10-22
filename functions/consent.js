'use strict';

const crypto = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');

const EVENT_TYPES = new Set([
  'notice_presented',
  'notice_acknowledged',
  'consent_granted',
  'consent_rejected',
  'consent_withdrawn',
  'consent_expired',
  'consent_superseded',
  'consent_reconfirmed',
  'explicit_consent_granted',
  'guardian_consent_granted',
  'consent_verification_failed',
  'permission_granted',
  'permission_denied',
  'permission_blocked',
  'permission_dismissed',
  'permission_unavailable',
  'permission_error'
]);

const SUBJECT_TYPES = new Set(['customer', 'rider', 'merchant', 'staff', 'representative']);
const SOURCES = new Set(['web_app', 'mobile_app', 'backend', 'admin']);
const CHANNELS = new Set([
  'first_launch',
  'runtime_permission_dialog',
  'settings',
  'onboarding',
  'policy_reconfirmation',
  'system'
]);

function stringField(value, name, min, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    const error = new Error(`${name} ไม่ถูกต้อง`);
    error.code = 'invalid-argument';
    throw error;
  }
  return value;
}

function validateConsentPayload(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const eventType = stringField(data.eventType, 'eventType', 1, 64, true);
  const subjectType = stringField(data.subjectType, 'subjectType', 1, 32, true);
  const purposeCode = stringField(data.purposeCode, 'purposeCode', 1, 120, true);
  const policyId = stringField(data.policyId, 'policyId', 1, 120, false);
  const policyVersion = stringField(data.policyVersion, 'policyVersion', 1, 32, false);
  const noticeId = stringField(data.noticeId, 'noticeId', 1, 120, false);
  const noticeVersion = stringField(data.noticeVersion, 'noticeVersion', 1, 32, false);
  const source = stringField(data.source || 'web_app', 'source', 1, 32, true);
  const channel = stringField(data.channel || 'system', 'channel', 1, 64, true);
  const locale = stringField(data.locale || 'th-TH', 'locale', 2, 16, true);
  const idempotencyKey = stringField(data.idempotencyKey, 'idempotencyKey', 8, 200, true);
  const roleInstanceId = stringField(data.roleInstanceId, 'roleInstanceId', 1, 128, false);
  const collectionContext = stringField(data.collectionContext, 'collectionContext', 1, 120, false);
  const policyTextHash = stringField(data.policyTextHash, 'policyTextHash', 1, 128, false);
  const noticeTextHash = stringField(data.noticeTextHash, 'noticeTextHash', 1, 128, false);

  if (!EVENT_TYPES.has(eventType)) {
    const error = new Error('eventType ไม่ได้รับอนุญาต'); error.code = 'invalid-argument'; throw error;
  }
  if (!SUBJECT_TYPES.has(subjectType)) {
    const error = new Error('subjectType ไม่ได้รับอนุญาต'); error.code = 'invalid-argument'; throw error;
  }
  if (!SOURCES.has(source)) {
    const error = new Error('source ไม่ได้รับอนุญาต'); error.code = 'invalid-argument'; throw error;
  }
  if (!CHANNELS.has(channel)) {
    const error = new Error('channel ไม่ได้รับอนุญาต'); error.code = 'invalid-argument'; throw error;
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(purposeCode)) {
    const error = new Error('purposeCode ไม่ถูกต้อง'); error.code = 'invalid-argument'; throw error;
  }
  if (data.consentValue != null && typeof data.consentValue !== 'boolean') {
    const error = new Error('consentValue ต้องเป็น boolean'); error.code = 'invalid-argument'; throw error;
  }
  if (data.noticeAcknowledged != null && typeof data.noticeAcknowledged !== 'boolean') {
    const error = new Error('noticeAcknowledged ต้องเป็น boolean'); error.code = 'invalid-argument'; throw error;
  }

  return {
    eventType,
    subjectType,
    purposeCode,
    policyId,
    policyVersion,
    noticeId,
    noticeVersion,
    source,
    channel,
    locale,
    idempotencyKey,
    roleInstanceId,
    collectionContext,
    policyTextHash,
    noticeTextHash,
    consentValue: data.consentValue == null ? null : data.consentValue,
    noticeAcknowledged: data.noticeAcknowledged == null ? null : data.noticeAcknowledged
  };
}

function idFor(uid, idempotencyKey) {
  return crypto.createHash('sha256').update(`${uid}|${idempotencyKey}`).digest('hex');
}

async function recordConsentEvent(db, uid, raw) {
  if (!uid || typeof uid !== 'string') {
    const error = new Error('ต้องเข้าสู่ระบบก่อนบันทึก Consent Event');
    error.code = 'unauthenticated';
    throw error;
  }

  const payload = validateConsentPayload(raw);
  const eventId = idFor(uid, payload.idempotencyKey);
  const ref = db.collection('consent_events').doc(eventId);
  const existing = await ref.get();
  if (existing.exists) {
    return { eventId, duplicate: true, data: existing.data() };
  }

  const event = {
    eventId,
    subjectRef: uid,
    subjectType: payload.subjectType,
    eventType: payload.eventType,
    purposeCode: payload.purposeCode,
    source: payload.source,
    channel: payload.channel,
    locale: payload.locale,
    consentValue: payload.consentValue,
    noticeAcknowledged: payload.noticeAcknowledged,
    idempotencyKeyHash: crypto.createHash('sha256').update(payload.idempotencyKey).digest('hex'),
    createdAt: FieldValue.serverTimestamp(),
    receivedAt: FieldValue.serverTimestamp(),
    createdBy: 'consent_backend'
  };

  const optional = [
    'roleInstanceId', 'collectionContext', 'policyId', 'policyVersion',
    'noticeId', 'noticeVersion', 'policyTextHash', 'noticeTextHash'
  ];
  optional.forEach((key) => {
    if (payload[key] != null) event[key] = payload[key];
  });

  await ref.create(event);
  return { eventId, duplicate: false, data: event };
}

module.exports = {
  EVENT_TYPES,
  validateConsentPayload,
  recordConsentEvent,
  idFor
};
