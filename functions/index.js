'use strict';

const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const D = require('./dispatch');
const Orders = require('./orders');
const { normalizeId, normalizeOrderIds, buildPayoutId, calculatePayoutOrders } = require('./payout');
const {
  customerSlipNotification,
  customerQuoteNotification,
  expressArrivalNotification,
  expressDeliveredNotification
} = require('./notifications');
const { recordConsentEvent } = require('./consent');
const { merchantHistoryEntry } = require('./gp-history');
const { FINANCE_KEYS, mergedFinance, migrateMerchantDoc, privateProfileRef } = require('./merchant-private');
const { assertAppCheck, enforceFromEnv } = require('./app-check');
const { syncRiderHistory } = require('./rider-history');

// Gen 2 defaults to 1 vCPU. `firebase deploy --only functions` health-checks
// every new revision at once. On a small regional CPU quota that aborts some
// updates (expireDispatchOffer, manualAssignRider, listMyConsentEvents, and
// whichever other callables lose the race) while the rest succeed.
// Fractional gen1 CPU with concurrency 1 is the 256MiB footprint these
// handlers actually need, so one rollout fits.
setGlobalOptions({
  region: 'asia-southeast1',
  maxInstances: 10,
  memory: '256MiB',
  cpu: 'gcf_gen1',
  concurrency: 1
});

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

// Financial write endpoints must not fall back to the soft App Check mode.
// Authentication and role checks remain separate and are still required.
function guardRequiredAppCheck(req, name) {
  try {
    assertAppCheck(req, name, true);
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

// When a job ends, keep a rider-safe summary and remove the rider phone
// from the order the customer can still read. Full contact stays in
// orders/{id}/private/contacts for admins.
exports.onRiderJobHistory = onDocumentWritten('orders/{orderId}', async (event) => {
  const after = event.data.after.exists ? event.data.after.data() : null;
  await syncRiderHistory(db, event.params.orderId, after);
});

exports.onOrderDispatch = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await D.onOrderWritten(db, before, after, event.params.orderId);
});

// Notify the assigned rider once the customer confirms payment, or the rider
// records it. Uploading a slip alone does not send this push.
exports.onCustomerSlipUploaded = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const message = customerSlipNotification(before, after, event.params.orderId);
  if (!message) return;
  await D.notifyRider(db, after.riderId, message);
});

// Notify the customer once when the rider has uploaded the product photo and
// entered the actual product price. The notification is best-effort and is
// deduplicated by the before/after transition in customerQuoteNotification.
exports.onCustomerQuoteReady = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const message = customerQuoteNotification(before, after, event.params.orderId);
  if (!message) return;
  await D.notifyCustomer(db, after.userId, message);
});

// Notify the customer at the two explicit Express hand-off milestones. Each
// builder checks the before/after transition so Firestore retries or unrelated
// order updates do not send duplicate pushes.
exports.onExpressDeliveryNotification = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.type !== 'express' || !after.userId) return;

  const arrival = expressArrivalNotification(before, after, event.params.orderId);
  if (arrival) await D.notifyCustomer(db, after.userId, arrival);

  const delivered = expressDeliveredNotification(before, after, event.params.orderId);
  if (delivered) await D.notifyCustomer(db, after.userId, delivered);
});

// GP transfer requests are client-created, but the merchant financial
// summary/history is server-owned and cannot be forged from the browser.
exports.onGpTransferCreated = onDocumentCreated('gp_transfers/{transferId}', async (event) => {
  const transfer = event.data && event.data.data();
  if (!transfer || !transfer.merchantId) return;
  const entry = merchantHistoryEntry({
    amount: transfer.amount,
    note: transfer.note || '',
    roundLabel: transfer.roundLabel || '',
    status: 'pending',
    verified: false,
    transferId: event.params.transferId,
    createdAt: transfer.createdAt || new Date()
  });
  const merchantRef = db.collection('merchants').doc(transfer.merchantId);
  const merchantSnap = await merchantRef.get();
  if (merchantSnap.exists) await migrateMerchantDoc(merchantRef, merchantSnap.data());
  await privateProfileRef(merchantRef).set({
    gpHistory: FieldValue.arrayUnion(entry),
    lastGpTransferAt: FieldValue.serverTimestamp()
  }, { merge: true });
});

// Move GP balances, owner email and notes off the public shop document.
// A write that still contains those fields is copied, then deleted, so the
// follow-up write is clean and does not loop.
exports.onMerchantFinanceSplit = onDocumentWritten('merchants/{merchantId}', async (event) => {
  if (!event.data.after.exists) return;
  await migrateMerchantDoc(event.data.after.ref, event.data.after.data());
});

exports.sweepMerchantFinance = onSchedule({
  schedule: 'every 60 minutes',
  timeoutSeconds: 120
}, async () => {
  const snap = await db.collection('merchants').limit(500).get();
  let moved = 0;
  for (const doc of snap.docs) {
    if (await migrateMerchantDoc(doc.ref, doc.data())) moved += 1;
  }
  if (moved) console.info(JSON.stringify({ event: 'merchant_finance_moved', moved }));
});

// Ratings are accepted only for the customer's own completed order by Rules.
// Aggregates remain server-owned so clients cannot inflate shop scores.
exports.onRatingCreated = onDocumentCreated('ratings/{ratingId}', async (event) => {
  const rating = event.data && event.data.data();
  if (!rating || !rating.merchantId) return;
  const snap = await db.collection('ratings')
    .where('merchantId', '==', rating.merchantId).get();
  let total = 0;
  let count = 0;
  snap.forEach((doc) => {
    const value = Number(doc.data().merchantRating || 0);
    if (value > 0) { total += value; count += 1; }
  });
  await db.collection('merchants').doc(rating.merchantId).update({
    ratingAvg: count ? Number((total / count).toFixed(2)) : 0,
    ratingCount: count
  });
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
  if (!after || typeof after.lat !== 'number' || typeof after.lng !== 'number') return;
  const orders = await db.collection('orders')
    .where('riderId', '==', event.params.riderId)
    .where('status', 'in', ['accepted', 'picked_up', 'customer_paid', 'on_the_way'])
    .limit(10).get();
  const batch = db.batch();
  orders.forEach((order) => {
    batch.set(order.ref.collection('tracking').doc('current'), {
      riderId: event.params.riderId,
      lat: after.lat,
      lng: after.lng,
      accuracy: after.accuracy == null ? null : after.accuracy,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (!orders.empty) await batch.commit();
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

// Financially sensitive payout writes must happen on the trusted backend.
// The payout id is deterministic for rider + sorted order ids, and the order
// flags plus payout record are committed in one transaction. This makes a
// double tap, retry, or two open Admin tabs idempotent.
exports.createRiderPayout = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'createRiderPayout');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมินการเงิน');
  }

  const data = req.data || {};
  let riderId;
  let orderIds;
  try {
    riderId = normalizeId(data.riderId, 'รหัสไรเดอร์');
    orderIds = normalizeOrderIds(data.orderIds);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
  if (data.note != null && typeof data.note !== 'string') throw new HttpsError('invalid-argument', 'หมายเหตุต้องเป็นข้อความ');
  if (data.roundLabel != null && typeof data.roundLabel !== 'string') throw new HttpsError('invalid-argument', 'ชื่อรอบโอนต้องเป็นข้อความ');
  const note = (data.note || '').trim();
  if (note.length > 300) throw new HttpsError('invalid-argument', 'หมายเหตุยาวเกิน 300 ตัวอักษร');
  const roundLabel = (data.roundLabel || '').trim();
  if (roundLabel.length > 80) throw new HttpsError('invalid-argument', 'ชื่อรอบโอนยาวเกิน 80 ตัวอักษร');

  const payoutId = buildPayoutId(riderId, orderIds);
  const payoutRef = db.collection('rider_payouts').doc(payoutId);
  const orderRefs = orderIds.map((id) => db.collection('orders').doc(id));

  try {
    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.get(payoutRef);
      if (existing.exists) {
        const previous = existing.data();
        const previousIds = Array.isArray(previous.orderIds) ? normalizeOrderIds(previous.orderIds) : [];
        if (previous.status !== 'paid'
          || previous.riderId !== riderId
          || previous.payoutKey !== payoutId
          || previousIds.join('|') !== orderIds.join('|')) {
          throw new Error('พบเอกสาร Payout เดิมที่ข้อมูลไม่ตรงกัน');
        }
        return { ok: true, alreadyPaid: true, payoutId, ...previous };
      }

      const orderSnaps = [];
      for (const ref of orderRefs) orderSnaps.push(await tx.get(ref));
      const orders = orderSnaps.map((snap, index) => {
        if (!snap.exists) throw new Error(`ไม่พบออเดอร์ ${orderIds[index]}`);
        return { id: snap.id, ...snap.data() };
      });
      const payout = calculatePayoutOrders(orders, riderId);
      const paidAt = FieldValue.serverTimestamp();
      tx.create(payoutRef, {
        payoutId,
        riderId: payout.riderId,
        orderIds: payout.orderIds,
        amount: payout.amount,
        orderCount: payout.orderIds.length,
        note,
        roundLabel,
        status: 'paid',
        payoutKey: payoutId,
        paidAt,
        paidBy: req.auth.uid
      });
      for (const ref of orderRefs) {
        tx.update(ref, {
          riderPayoutPaid: true,
          riderPayoutPaidAt: paidAt,
          riderPayoutId: payoutId,
          riderPayoutBy: req.auth.uid
        });
      }
      return { ok: true, alreadyPaid: false, payoutId, ...payout };
    });
    console.info(JSON.stringify({ event: 'rider_payout_created', payoutId, riderId, orderCount: orderIds.length, amount: result.amount || 0, alreadyPaid: result.alreadyPaid === true }));
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err && /ถูกโอนไปแล้ว|ยังไม่เสร็จ|ขาดยอด|ไม่พบออเดอร์|ไม่ตรง|เอกสาร Payout เดิม/.test(err.message || '')) {
      throw new HttpsError('failed-precondition', err.message);
    }
    console.error('createRiderPayout failed', err);
    throw new HttpsError('internal', 'บันทึกยอดโอนไม่สำเร็จ');
  }
});

// Review a merchant GP slip and its merchant balance atomically. A retry of
// the same decision is harmless; a verified transfer can never be rejected
// or verified twice, and a rejected transfer cannot later be approved.
exports.reviewGpTransfer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'reviewGpTransfer');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมินการเงิน');
  }
  const data = req.data || {};
  let transferId;
  try {
    transferId = normalizeId(data.transferId, 'รหัสสลิป');
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (!['verify', 'reject'].includes(action)) {
    throw new HttpsError('invalid-argument', 'ข้อมูลการตรวจสลิปไม่ครบ');
  }

  const transferRef = db.collection('gp_transfers').doc(transferId);
  try {
    const result = await db.runTransaction(async (tx) => {
      const transferSnap = await tx.get(transferRef);
      if (!transferSnap.exists) throw new Error('ไม่พบรายการสลิป GP');
      const transfer = transferSnap.data();
      const currentStatus = String(transfer.status || 'pending');
      if (currentStatus === 'verified') {
        if (action === 'verify') return { ok: true, alreadyReviewed: true, status: currentStatus, transferId };
        throw new Error('สลิปนี้อนุมัติแล้ว ไม่สามารถปฏิเสธได้');
      }
      if (currentStatus === 'rejected') {
        if (action === 'reject') return { ok: true, alreadyReviewed: true, status: currentStatus, transferId };
        throw new Error('สลิปนี้ถูกปฏิเสธแล้ว ไม่สามารถอนุมัติได้');
      }
      if (currentStatus !== 'pending') throw new Error('สถานะสลิปไม่ถูกต้อง');

      const merchantId = String(transfer.merchantId || '').trim();
      const amount = Number(transfer.amount || 0);
      if (!merchantId) throw new Error('ไม่พบร้านค้าของสลิป');
      const merchantRef = db.collection('merchants').doc(merchantId);
      const privateRef = privateProfileRef(merchantRef);
      const merchantSnap = await tx.get(merchantRef);
      const privateSnap = await tx.get(privateRef);
      if (!merchantSnap.exists) throw new Error('ไม่พบข้อมูลร้านค้า');
      const merchant = mergedFinance(merchantSnap.data(), privateSnap.exists ? privateSnap.data() : {});
      const now = Timestamp.now();
      const pending = Number(merchant.gpPending || 0);
      const history = Array.isArray(merchant.gpHistory) ? merchant.gpHistory : [];
      const historyEntry = merchantHistoryEntry({
        amount: transfer.amount,
        note: transfer.note || '',
        roundLabel: transfer.roundLabel || '',
        transferId,
        createdAt: transfer.createdAt || now
      });
      let historyMatched = false;
      const reviewedHistory = history.map((entry) => {
        if (!entry || entry.transferId !== transferId) return merchantHistoryEntry(entry);
        historyMatched = true;
        return Object.assign({}, merchantHistoryEntry(entry), action === 'verify'
          ? { status: 'verified', verified: true, verifiedAt: now, verifiedBy: req.auth.uid }
          : { status: 'rejected', verified: false, rejectedAt: now, rejectedBy: req.auth.uid });
      });
      if (!historyMatched) reviewedHistory.push(Object.assign({}, historyEntry,
        action === 'verify'
          ? { status: 'verified', verified: true, verifiedAt: now, verifiedBy: req.auth.uid }
          : { status: 'rejected', verified: false, rejectedAt: now, rejectedBy: req.auth.uid }));

      const financePatch = {
        gpHistory: reviewedHistory,
        lastGpTransferId: transferId,
        lastGpTransferReviewedAt: now
      };
      if (action === 'reject') {
        financePatch.lastGpTransferStatus = 'rejected';
      } else {
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('ข้อมูลยอด GP ไม่ถูกต้อง');
        if (!Number.isFinite(pending) || pending < amount) throw new Error('ยอด GP ค้างไม่พอสำหรับสลิปนี้');
        financePatch.lastGpTransferStatus = 'verified';
        financePatch.gpPending = Math.round((pending - amount + Number.EPSILON) * 100) / 100;
        financePatch.gpPaid = Math.round((Number(merchant.gpPaid || 0) + amount + Number.EPSILON) * 100) / 100;
      }
      const publicDelete = {};
      FINANCE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(merchantSnap.data() || {}, key)) publicDelete[key] = FieldValue.delete();
      });
      if (action === 'reject') {
        tx.update(transferRef, { status: 'rejected', rejectedAt: now, rejectedBy: req.auth.uid });
      } else {
        tx.update(transferRef, { status: 'verified', verifiedAt: now, verifiedBy: req.auth.uid });
      }
      tx.set(privateRef, financePatch, { merge: true });
      if (Object.keys(publicDelete).length) tx.update(merchantRef, publicDelete);
      return {
        ok: true,
        alreadyReviewed: false,
        status: action === 'reject' ? 'rejected' : 'verified',
        transferId,
        merchantId,
        amount: action === 'verify' ? amount : undefined
      };
    });
    console.info(JSON.stringify({ event: 'gp_transfer_reviewed', transferId, status: result.status, alreadyReviewed: result.alreadyReviewed === true }));
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err && /ไม่พบ|ไม่สามารถ|สถานะ|ข้อมูลยอด|ยอด GP/.test(err.message || '')) {
      throw new HttpsError('failed-precondition', err.message);
    }
    console.error('reviewGpTransfer failed', err);
    throw new HttpsError('internal', 'ตรวจสอบสลิป GP ไม่สำเร็จ');
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
