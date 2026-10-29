'use strict';

const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const D = require('./dispatch');
const Orders = require('./orders');
const { recordConsentEvent } = require('./consent');
const { assertAppCheck, enforceFromEnv } = require('./app-check');

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

if (!getApps().length) initializeApp();
const db = getFirestore();

const APP_CHECK_ENFORCE = enforceFromEnv(process.env);
// invoker public + cors so the browser can call asia-southeast1. Do not set
// enforceAppCheck here: the platform rejects a missing token with a 403 that
// has no CORS headers, and Chrome reports that as "Failed to fetch".
// guardAppCheck still rejects when APP_CHECK_ENFORCE=true, and that error
// is a normal callable response the page can read.
const CALL = { invoker: 'public', cors: true, enforceAppCheck: false };
// Module load only. Firestore triggers such as onOrderDispatch print this
// and never see an App Check token. Per-call lines are [appcheck] ok|missing|invalid fn=<name>.
console.info('[appcheck] enforce=' + APP_CHECK_ENFORCE);

function guardAppCheck(req, name) {
  try {
    assertAppCheck(req, name, APP_CHECK_ENFORCE);
  } catch (err) {
    if (err && err.code === 'app-check') {
      throw new HttpsError('unauthenticated', 'แอปไม่ผ่านการตรวจสอบ');
    }
    throw err;
  }
}

const REASONS = {
  'missing-offer': 'ไม่พบข้อเสนอ',
  'missing-order': 'ไม่พบออเดอร์',
  'missing-rider': 'ไม่พบไรเดอร์',
  'not-yours': 'งานนี้ไม่ใช่ของคุณ',
  closed: 'ข้อเสนอนี้ปิดแล้ว',
  expired: 'หมดเวลา',
  taken: 'งานนี้มีคนรับแล้ว',
  stale: 'ข้อเสนอนี้ไม่ใช่รอบปัจจุบัน',
  busy: 'ยังมีงานค้างอยู่ — รับงานใหม่ไม่ได้',
  unverified: 'บัญชียังไม่ได้รับการอนุมัติ',
  auto: 'โหมดอัตโนมัติ — กดรับจากใบเสนอ',
  shop: 'รอร้านรับออเดอร์ก่อน'
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
  if (!data || data.broadcast === true || data.status !== 'pending' || !data.expiresAt) return;
  const exp = typeof data.expiresAt.toMillis === 'function' ? data.expiresAt.toMillis() : 0;
  const wait = Math.min(90000, Math.max(0, exp - Date.now() + 500));
  await new Promise((resolve) => setTimeout(resolve, wait));
  await D.expireOffer(db, event.params.orderId, event.params.offerId, 'expired');
});

exports.sweepDispatchOffers = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 120
}, async () => {
  await D.sweepTimeouts(db);
  await D.sweepExpired(db);
  await D.sweepStuck(db);
});

exports.onGpsOnline = onDocumentWritten('gps_riders/{riderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await D.onGpsWritten(db, before, after, event.params.riderId);
});

function orderFail(err) {
  if (err instanceof HttpsError) throw err;
  const code = err && err.code;
  if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'permission-denied' || code === 'not-found') {
    throw new HttpsError(code, err.message || 'ทำรายการไม่สำเร็จ');
  }
  fail(err);
}

exports.createOrder = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'createOrder');
  try {
    return await Orders.createOrder(db, req.auth.uid, req.data || {});
  } catch (err) {
    orderFail(err);
  }
});

exports.confirmPaymentReceived = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'confirmPaymentReceived');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await Orders.confirmPaymentReceived(db, req.auth.uid, data.orderId);
  } catch (err) {
    orderFail(err);
  }
});

exports.reportShopClosed = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'reportShopClosed');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await Orders.reportShopClosed(db, req.auth.uid, data.orderId);
  } catch (err) {
    orderFail(err);
  }
});

exports.completeOrder = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'completeOrder');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await Orders.completeOrder(db, req.auth.uid, data.orderId);
  } catch (err) {
    orderFail(err);
  }
});

exports.acceptDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'acceptDispatchOffer');
  const data = req.data || {};
  if (!data.orderId || !data.offerId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await D.acceptOffer(db, req.auth.uid, data.orderId, data.offerId);
  } catch (err) {
    fail(err);
  }
});

// Manual-mode list accept. Auto mode must use acceptDispatchOffer.
exports.claimOpenJob = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'claimOpenJob');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await D.claimOpenJob(db, req.auth.uid, data.orderId);
  } catch (err) {
    fail(err);
  }
});

exports.skipDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'skipDispatchOffer');
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
  guardAppCheck(req, 'expireDispatchOffer');
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
  guardAppCheck(req, 'manualAssignRider');
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

// Consent Events are written only by the trusted backend. Firestore Rules
// deny direct client writes so the client cannot forge subjectRef or timestamps.
exports.recordConsentEvent = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนบันทึก Consent');
  guardAppCheck(req, 'recordConsentEvent');
  try {
    const result = await recordConsentEvent(db, req.auth.uid, req.data || {});
    return { eventId: result.eventId, duplicate: result.duplicate };
  } catch (err) {
    if (err && err.code === 'invalid-argument') {
      throw new HttpsError('invalid-argument', err.message);
    }
    throw err;
  }
});

// Read-only, self-scoped endpoint used by the account/privacy screen and QA.
exports.listMyConsentEvents = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'listMyConsentEvents');
  const limit = Math.min(Math.max(Number(req.data && req.data.limit) || 50, 1), 100);
  const snap = await db.collection('consent_events')
    .where('subjectRef', '==', req.auth.uid)
    .orderBy('receivedAt', 'desc')
    .limit(limit)
    .get();
  return { events: snap.docs.map((doc) => ({ eventId: doc.id, ...doc.data() })) };
});
