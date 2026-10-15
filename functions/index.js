'use strict';

const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const D = require('./dispatch');

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const CALL = { invoker: 'public', cors: true };

const REASONS = {
  'missing-offer': 'ไม่พบข้อเสนอ',
  'missing-order': 'ไม่พบออเดอร์',
  'missing-rider': 'ไม่พบไรเดอร์',
  'not-yours': 'งานนี้ไม่ใช่ของคุณ',
  closed: 'ข้อเสนอนี้ปิดแล้ว',
  expired: 'หมดเวลา',
  taken: 'งานนี้มีคนรับแล้ว',
  stale: 'ข้อเสนอนี้ไม่ใช่รอบปัจจุบัน',
  busy: 'รับงานพร้อมกันได้ไม่เกินจำนวนที่กำหนด',
  unverified: 'บัญชียังไม่ได้รับการอนุมัติ'
};

function fail(err) {
  const code = err && err.message;
  throw new HttpsError('failed-precondition', REASONS[code] || code || 'ทำรายการไม่สำเร็จ');
}

exports.onOrderDispatch = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await D.onOrderWritten(db, before, after, event.params.orderId);
});

exports.onDispatchOfferCreated = onDocumentCreated({
  document: 'orders/{orderId}/dispatchOffers/{offerId}',
  timeoutSeconds: 120
}, async (event) => {
  const data = event.data && event.data.data();
  if (!data || data.status !== 'pending' || !data.expiresAt) return;
  const exp = typeof data.expiresAt.toMillis === 'function' ? data.expiresAt.toMillis() : 0;
  const wait = Math.min(90000, Math.max(0, exp - Date.now() + 500));
  await new Promise((resolve) => setTimeout(resolve, wait));
  await D.expireOffer(db, event.params.orderId, event.params.offerId, 'expired');
});

exports.sweepDispatchOffers = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 60
}, async () => {
  await D.sweepExpired(db);
});

exports.onGpsOnline = onDocumentWritten('gps_riders/{riderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await D.onGpsWritten(db, before, after, event.params.riderId);
});

exports.acceptDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  const data = req.data || {};
  if (!data.orderId || !data.offerId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await D.acceptOffer(db, req.auth.uid, data.orderId, data.offerId);
  } catch (err) {
    fail(err);
  }
});

exports.skipDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  const data = req.data || {};
  if (!data.orderId || !data.offerId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  const offer = await db.collection('orders').doc(data.orderId)
    .collection('dispatchOffers').doc(data.offerId).get();
  if (!offer.exists || offer.data().riderId !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'งานนี้ไม่ใช่ของคุณ');
  }
  return D.expireOffer(db, data.orderId, data.offerId, 'skipped');
});

exports.expireDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  const data = req.data || {};
  if (!data.orderId || !data.offerId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  const offer = await db.collection('orders').doc(data.orderId)
    .collection('dispatchOffers').doc(data.offerId).get();
  if (!offer.exists || offer.data().riderId !== req.auth.uid) {
    throw new HttpsError('permission-denied', 'งานนี้ไม่ใช่ของคุณ');
  }
  return D.expireOffer(db, data.orderId, data.offerId, 'expired');
});

exports.manualAssignRider = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมิน');
  }
  const data = req.data || {};
  if (!data.orderId || !data.riderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await D.manualAssign(db, req.auth.uid, data.orderId, data.riderId);
  } catch (err) {
    fail(err);
  }
});
