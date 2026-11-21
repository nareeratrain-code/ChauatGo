'use strict';

const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
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
const { syncMerchantInbox } = require('./merchant-inbox');
const { reviewRiderError } = require('./review-error');
const {
  notifyAdminsOfRemittance,
  shouldNotifyFinalizedRemittance
} = require('./admin-notifications');
const {
  shopGpDue,
  riderDailyDue,
  settlementChatId,
  riderRemittanceId,
  publicPayout,
  riderReviewPlan
} = require('./settlement');
const { remitLockPlan, effectiveLockPlan } = require('./remit-lock');
const { setRiderWorkRestrictionTransaction } = require('./rider-restriction-service');
const { redispatchFromRider, reportShoppingStockout, finalizeShoppingStockout } = require('./cancel-flow');

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
const bucket = getStorage().bucket();

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

function isFirebaseStorageUrlForPath(value, storagePath) {
  if (typeof value !== 'string' || !value || !storagePath) return false;
  try {
    const url = new URL(value);
    if (!['firebasestorage.googleapis.com', 'storage.googleapis.com', 'firebasestorage.app'].includes(url.hostname)) return false;
    const decodedPath = decodeURIComponent(url.pathname);
    return decodedPath.includes('/o/' + storagePath) || decodedPath.endsWith('/' + storagePath);
  } catch (_) {
    return false;
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
  shop: 'รอร้านรับออเดอร์ก่อน',
  released: 'คุณปล่อยงานนี้แล้ว'
};

function fail(err) {
  const code = err && err.message;
  throw new HttpsError('failed-precondition', REASONS[code] || code || 'ทำรายการไม่สำเร็จ');
}

// When a job ends, keep a rider-safe summary and remove the rider phone
// from the order the customer can still read. Full contact stays in
// orders/{id}/private/contacts for admins.
exports.onRiderJobHistory = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await syncRiderHistory(db, event.params.orderId, after);
  await syncMerchantInbox(db, event.params.orderId, before, after);
  // Seed the server-owned settlement queue when a rider completes a job.
  // This lets the 5-minute sweep discover riders even when their app is
  // closed and prevents the first post-21:00 job from being invisible to the
  // next Bangkok remittance window.
  if (after && (after.status === 'done' || after.status === 'delivered') && after.riderId) {
    await db.collection('settlement_queue').doc('rider_' + String(after.riderId)).set({
      kind: 'rider',
      partyId: String(after.riderId),
      amount: 0,
      status: 'clear',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
});

exports.onOrderDispatch = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await D.onOrderWritten(db, before, after, event.params.orderId);
  await finalizeShoppingStockout(db, before, after, event.params.orderId);
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
    lastGpTransferAt: FieldValue.serverTimestamp(),
    lastGpTransferStatus: 'pending'
  }, { merge: true });
  await db.collection('settlement_queue').doc('shop_' + transfer.merchantId).set({
    kind: 'shop',
    partyId: transfer.merchantId,
    status: 'slip',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
});

// Move GP balances, owner email and notes off the public shop document.
// A write that still contains those fields is copied, then deleted, so the
// follow-up write is clean and does not loop.
exports.onMerchantFinanceSplit = onDocumentWritten('merchants/{merchantId}', async (event) => {
  if (!event.data.after.exists) return;
  await migrateMerchantDoc(event.data.after.ref, event.data.after.data());
});

async function syncShopSettlement(merchantId, publicData, profile) {
  const due = shopGpDue(profile, Date.now());
  const name = String((publicData && publicData.name) || '');
  await db.collection('settlement_queue').doc('shop_' + merchantId).set({
    kind: 'shop',
    partyId: merchantId,
    partyName: name,
    amount: due.amount,
    dueAt: due.dueAt ? Timestamp.fromMillis(due.dueAt) : null,
    status: due.due ? (profile.lastGpTransferStatus === 'pending' ? 'slip' : 'due') : 'clear',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  if (!due.due || profile.gpDueNotifiedAt) return false;
  await privateProfileRef(db.collection('merchants').doc(merchantId)).set({
    gpDueNotifiedAt: FieldValue.serverTimestamp(),
    gpDueAt: Timestamp.fromMillis(due.dueAt)
  }, { merge: true });
  const chatRef = db.collection('settlement_chats').doc(settlementChatId('shop', merchantId));
  await chatRef.set({
    kind: 'shop',
    partyId: merchantId,
    partyName: name,
    lastMessage: 'GP ครบกำหนดชำระ',
    lastSenderId: 'system',
    lastMessageAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await chatRef.collection('messages').add({
    senderId: 'system',
    senderRole: 'admin',
    text: 'GP ครบกำหนดชำระ ฿' + due.amount + ' กรุณาโอนตาม QR ของ ChauatGo',
    systemMessage: true,
    createdAt: FieldValue.serverTimestamp()
  });
  return true;
}

exports.onMerchantGpDue = onDocumentWritten('merchants/{merchantId}/private/profile', async (event) => {
  if (!event.data.after.exists) return;
  const merchantRef = db.collection('merchants').doc(event.params.merchantId);
  const merchantSnap = await merchantRef.get();
  const notified = await syncShopSettlement(
    event.params.merchantId,
    merchantSnap.exists ? merchantSnap.data() : {},
    event.data.after.data() || {}
  );
  if (notified) console.info(JSON.stringify({ event: 'shop_gp_due', merchantId: event.params.merchantId }));
});

exports.sweepMerchantFinance = onSchedule({
  schedule: 'every 60 minutes',
  timeoutSeconds: 120
}, async () => {
  const snap = await db.collection('merchants').limit(500).get();
  let moved = 0;
  let dueNotices = 0;
  for (const doc of snap.docs) {
    if (await migrateMerchantDoc(doc.ref, doc.data())) moved += 1;
    const fresh = await doc.ref.get();
    const priv = await privateProfileRef(doc.ref).get();
    const profile = mergedFinance(fresh.data() || {}, priv.exists ? priv.data() : {});
    if (await syncShopSettlement(doc.id, fresh.data() || {}, profile)) dueNotices += 1;
  }
  if (moved || dueNotices) console.info(JSON.stringify({ event: 'merchant_finance_moved', moved, dueNotices }));
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

exports.sweepRiderRemit = onSchedule({
  // The accept/claim guard below is the immediate enforcement path. This
  // sweep keeps rider status synchronized even when the rider is idle.
  schedule: 'every 5 minutes',
  timeoutSeconds: 120
}, async () => {
  const nowMs = Date.now();
  const unlockLabel = (ms) => new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok'
  }).format(new Date(ms));
  const sendRemitPush = async (riderRef, rider, markerField, markerValue, message) => {
    const result = await D.notifyRider(db, String(riderRef.id || ''), message);
    const sent = result && result.deliveryStatus === 'sent';
    const prefix = markerField.replace(/Date$|Until$/, '');
    const patch = sent
      ? { [markerField]: markerValue, [prefix + 'LastAttemptStatus']: 'sent' }
      : {
        [prefix + 'LastAttemptAt']: FieldValue.serverTimestamp(),
        [prefix + 'LastAttemptStatus']: String((result && (result.deliveryStatus || result.reason)) || 'failed')
      };
    await riderRef.set(patch, { merge: true });
    return sent;
  };
  const queue = await db.collection('settlement_queue').where('kind', '==', 'rider').limit(500).get();
  for (const doc of queue.docs) {
    const row = doc.data() || {};
    const riderId = String(row.partyId || '');
    if (!riderId) continue;
    // Recompute the current Bangkok remittance window instead of trusting a
    // queue amount written before midnight. This keeps the lock decision and
    // FCM date marker aligned when the calendar date changes while a rider is
    // idle or keeps the app open overnight.
    const orderSnap = await db.collection('orders')
      .where('riderId', '==', riderId)
      .where('status', 'in', ['done', 'delivered'])
      .get();
    const jobs = orderSnap.docs.map((order) => Object.assign({ id: order.id }, order.data()));
    const due = riderDailyDue(jobs, nowMs);
    const currentAmount = Number(due.amount) || 0;
    await doc.ref.set({
      amount: currentAmount,
      dateKey: due.dateKey,
      nextAmount: Number(due.nextAmount) || 0,
      nextDateKey: due.nextDateKey,
      cutoff: due.cutoff,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const riderSlips = await db.collection('rider_remittances')
      .where('riderId', '==', riderId)
      .get();
    const pendingSlip = riderSlips.docs.some((slip) => slip.data().status === 'pending');
    const riderRef = db.collection('riders').doc(riderId);
    // Manual restrictions also transactionally update this document. Keep the
    // scheduler's read, policy decision, and projection write in one
    // transaction so an Admin update between the read and write causes a retry
    // instead of allowing the scheduler to overwrite admin_manual.
    const lockState = await db.runTransaction(async (tx) => {
      const riderSnap = await tx.get(riderRef);
      if (!riderSnap.exists) return null;
      const rider = riderSnap.exists ? riderSnap.data() : {};
      const until = rider.onlineLockedUntil && rider.onlineLockedUntil.toMillis
        ? rider.onlineLockedUntil.toMillis() : 0;
      const cooldownUntil = rider.remittanceVerificationUntil && rider.remittanceVerificationUntil.toMillis
        ? rider.remittanceVerificationUntil.toMillis() : 0;
      const plan = remitLockPlan({
        nowMs: nowMs,
        amount: currentAmount,
        pendingSlip: pendingSlip,
        lockedUntilMs: until,
        cooldownUntilMs: cooldownUntil
      });
      const manualLockActive = rider.onlineLockReason === 'admin_manual' && until > nowMs;
      let createdLock = false;
      if (plan.action === 'clear' && until && !manualLockActive) {
        tx.update(riderRef, {
          onlineLockedUntil: FieldValue.delete(),
          onlineLockReason: FieldValue.delete(),
          remittanceVerificationUntil: FieldValue.delete()
        });
      } else if (plan.action === 'lock' && !manualLockActive) {
        tx.update(riderRef, {
          onlineLockedUntil: Timestamp.fromMillis(plan.untilMs),
          onlineLockReason: 'remit'
        });
        createdLock = true;
      }
      return { rider, plan, createdLock, manualLockActive };
    }, { maxAttempts: 5 });
    if (!lockState) continue;
    const rider = lockState.rider;
    const plan = lockState.plan;
    if (plan.lockWarning && rider.remitLockWarningDate !== plan.key) {
      await sendRemitPush(riderRef, rider, 'remitLockWarningDate', plan.key, {
        title: 'ใกล้เวลาพักรับงาน',
        body: 'อีก 1 ชั่วโมงจะถึง 22:00 กรุณาโอนยอดค้างเพื่อไม่ให้ระบบพักรับงานอัตโนมัติ',
        data: { kind: 'remit', phase: 'lock_warning', dateKey: plan.key }
      });
    }
    const lockNeedsPush = (lockState.createdLock || plan.phase === 'remit_lock')
      && !lockState.manualLockActive
      && rider.remitLockNoticeUntil !== plan.untilMs;
    if (lockNeedsPush) {
      await sendRemitPush(riderRef, rider, 'remitLockNoticeUntil', plan.untilMs, {
        title: 'บัญชีถูกพักรับงานอัตโนมัติ',
        body: `ยังไม่ได้โอนยอดค้าง ระบบจะปลดล็อก ${unlockLabel(plan.untilMs)} น.`,
        data: {
          kind: 'remit',
          phase: 'locked',
          unlockAt: new Date(plan.untilMs).toISOString(),
          dateKey: plan.key
        }
      });
    }
    if (plan.notify && rider.remitNoticeDate !== plan.key) {
      await sendRemitPush(riderRef, rider, 'remitNoticeDate', plan.key, {
        title: 'โอนยอดให้ ChauatGo',
        body: plan.phase === 'verification_cooldown'
          ? 'แอดมินตรวจสลิปแล้ว ระบบจะปลดล็อกหลังครบ 24 ชั่วโมง'
          : 'อีก 1 ชั่วโมงจะถึง 21:00 กรุณาโอนยอดที่ค้าง',
        data: { kind: 'remit' }
      });
    }
  }
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

exports.reportShoppingStockout = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'reportShoppingStockout');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await reportShoppingStockout(db, req.auth.uid, data.orderId, data.reason);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const code = err && err.code;
    if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'permission-denied' || code === 'not-found') {
      throw new HttpsError(code, err.message || 'ทำรายการไม่สำเร็จ');
    }
    console.error('reportShoppingStockout failed', err);
    throw new HttpsError('internal', 'ปิดงานของหมดไม่สำเร็จ');
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

async function refreshRiderRemitLock(uid, nowMs = Date.now()) {
  const riderRef = db.collection('riders').doc(uid);
  const riderSnap = await riderRef.get();
  if (!riderSnap.exists) return { blocked: false, untilMs: 0, reason: '' };
  const rider = riderSnap.data() || {};
  const [orderSnap, slipSnap] = await Promise.all([
    db.collection('orders').where('riderId', '==', uid).where('status', 'in', ['done', 'delivered']).get(),
    db.collection('rider_remittances').where('riderId', '==', uid).get()
  ]);
  const jobs = orderSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
  const due = riderDailyDue(jobs, nowMs);
  const pendingSlip = slipSnap.docs.some((doc) => (doc.data() || {}).status === 'pending');
  const lockedUntilMs = rider.onlineLockedUntil && typeof rider.onlineLockedUntil.toMillis === 'function'
    ? rider.onlineLockedUntil.toMillis() : 0;
  const cooldownUntilMs = rider.remittanceVerificationUntil && typeof rider.remittanceVerificationUntil.toMillis === 'function'
    ? rider.remittanceVerificationUntil.toMillis() : 0;
  const plan = remitLockPlan({ nowMs, amount: due.amount, pendingSlip, lockedUntilMs, cooldownUntilMs });
  let effectiveUntilMs = lockedUntilMs;
  let effectiveReason = String(rider.onlineLockReason || '');

  if (plan.action === 'lock' && plan.untilMs > lockedUntilMs) {
    await riderRef.set({
      onlineLockedUntil: Timestamp.fromMillis(plan.untilMs),
      onlineLockReason: 'remit'
    }, { merge: true });
    effectiveUntilMs = plan.untilMs;
    effectiveReason = 'remit';
  } else if (plan.action === 'clear' && (lockedUntilMs || cooldownUntilMs)) {
    await riderRef.set({
      onlineLockedUntil: FieldValue.delete(),
      onlineLockReason: FieldValue.delete(),
      remittanceVerificationUntil: FieldValue.delete()
    }, { merge: true });
    effectiveUntilMs = 0;
    effectiveReason = '';
  }

  // Reconcile independent policies after the remittance plan. This prevents a
  // zero-balance refresh from clearing a risk/safety suspension, and prevents
  // a remittance sync from treating an Admin Lock as a remittance lock.
  const effective = effectiveLockPlan({
    nowMs,
    remitLockUntilMs: ['remit', 'remit_overdue'].includes(effectiveReason) ? effectiveUntilMs : 0,
    verificationCooldownUntilMs: cooldownUntilMs,
    adminManualUntilMs: effectiveReason === 'admin_manual' ? effectiveUntilMs : 0,
    riskRestrictionUntilMs: timestampMillis(rider.riskRestrictionUntil),
    safetySuspensionUntilMs: timestampMillis(rider.safetySuspensionUntil)
  });
  const blocked = effective.locked || (plan.action === 'keep' && effectiveUntilMs > nowMs);
  return {
    blocked,
    untilMs: effective.locked ? effective.untilMs : effectiveUntilMs,
    reason: effective.reason || effectiveReason,
    dueAmount: due.amount,
    plan
  };
}

async function assertRiderCanWork(uid) {
  const state = await refreshRiderRemitLock(uid, Date.now());
  if (state.blocked) {
    const reason = state.reason === 'admin_manual'
      ? 'บัญชีถูกพักรับงานตามคำสั่งแอดมิน'
      : state.reason === 'remit_verified_cooldown'
      ? 'บัญชีอยู่ระหว่างตรวจสอบการโอน ระบบจะปลดล็อกหลังครบ 24 ชั่วโมง'
      : 'บัญชีถูกพักรับงานเพราะยังไม่โอนยอดก่อน 21:00';
    const err = new Error(reason);
    err.code = 'failed-precondition';
    throw err;
  }
}

// Admin-only manual override for exceptional lock cases. Authentication and
// authorization stay at the Callable boundary; the atomic Rider + Audit
// transaction lives in rider-restriction-service.js and is reusable in tests.
exports.setRiderWorkRestriction = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'setRiderWorkRestriction');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมินเท่านั้น');
  }

  return setRiderWorkRestrictionTransaction({
    db,
    riderId: req.data?.riderId,
    action: req.data?.action,
    reason: req.data?.reason,
    requestId: req.data?.requestId,
    expectedRevision: req.data?.expectedRevision,
    changedBy: req.auth.uid,
    changedByEmail: req.auth.token && req.auth.token.email
  });
});

exports.acceptDispatchOffer = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'acceptDispatchOffer');
  const data = req.data || {};
  if (!data.orderId || !data.offerId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    await assertRiderCanWork(req.auth.uid);
    return await D.acceptOffer(db, req.auth.uid, data.orderId, data.offerId);
  } catch (err) {
    fail(err);
  }
});

// Manual-mode list accept. Auto mode must use acceptDispatchOffer.
exports.redispatchOrder = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'redispatchOrder');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    return await redispatchFromRider(db, D, req.auth.uid, String(data.orderId), data.reason);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const code = err && err.code;
    if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'permission-denied' || code === 'not-found') {
      throw new HttpsError(code, err.message || 'ทำรายการไม่สำเร็จ');
    }
    console.error('redispatchOrder failed', err);
    throw new HttpsError('internal', 'หาไรเดอร์ใหม่ไม่สำเร็จ');
  }
});

exports.claimOpenJob = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'claimOpenJob');
  const data = req.data || {};
  if (!data.orderId) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
  try {
    await assertRiderCanWork(req.auth.uid);
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
        if (financePatch.gpPending === 0) financePatch.gpDueNotifiedAt = FieldValue.delete();
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

exports.syncMySettlement = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardAppCheck(req, 'syncMySettlement');
  const uid = req.auth.uid;
  const userSnap = await db.collection('users').doc(uid).get();
  const role = userSnap.exists ? String(userSnap.data().role || '') : '';
  const payoutSnap = await db.collection('config').doc('payout').get();
  const payout = publicPayout(payoutSnap.exists ? payoutSnap.data() : {});
  if (role === 'merchant') {
    const merchantSnap = await db.collection('merchants').doc(uid).get();
    const priv = await privateProfileRef(db.collection('merchants').doc(uid)).get();
    const profile = mergedFinance(merchantSnap.data() || {}, priv.exists ? priv.data() : {});
    const due = shopGpDue(profile, Date.now());
    return { kind: 'shop', amount: due.amount, dueAt: due.dueAt, overdue: due.overdue, due: due.due, payout };
  }
  if (role === 'rider') {
    const riderSnap = await db.collection('riders').doc(uid).get();
    const orderSnap = await db.collection('orders').where('riderId', '==', uid).where('status', 'in', ['done', 'delivered']).get();
    const jobs = orderSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
    const due = riderDailyDue(jobs, Date.now());
    const remittanceSnap = await db.collection('rider_remittances').where('riderId', '==', uid).limit(20).get();
    const remittances = remittanceSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
    remittances.sort((a, b) => {
      const at = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
      return bt - at;
    });
    const latest = remittances[0] || null;
    const riderData = riderSnap.exists ? riderSnap.data() : {};
    const lockedUntilMs = riderData.onlineLockedUntil && riderData.onlineLockedUntil.toMillis
      ? riderData.onlineLockedUntil.toMillis() : 0;
    // displayAmount is the outstanding balance shown on the dashboard. It
    // must never fall back to the submitted slip amount: an overpayment or a
    // verified slip is not an outstanding balance.
    const displayAmount = due.amount > 0
      ? due.amount
      : (due.nextAmount > 0 ? due.nextAmount : 0);
    await db.collection('settlement_queue').doc('rider_' + uid).set({
      kind: 'rider',
      partyId: uid,
      partyName: String((riderSnap.exists && riderSnap.data().name) || ''),
      amount: due.amount,
      dateKey: due.dateKey,
      nextAmount: due.nextAmount,
      nextDateKey: due.nextDateKey,
      cutoff: due.cutoff,
      status: due.amount > 0 ? 'due' : (latest && latest.status === 'pending' ? 'pending' : 'clear'),
      displayAmount,
      latestRemittanceId: latest && latest.id || '',
      latestRemittanceStatus: latest && latest.status || '',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      kind: 'rider', amount: due.amount, displayAmount, dateKey: due.dateKey,
      nextAmount: due.nextAmount, nextDateKey: due.nextDateKey, cutoff: due.cutoff,
      overdue: due.overdue, jobIds: due.jobIds, nextJobIds: due.nextJobIds, payout,
      remittance: latest ? {
        id: latest.id,
        amount: Number(latest.amount || 0),
        dateKey: String(latest.dateKey || ''),
        status: String(latest.status || 'pending')
      } : null,
      lockedUntilMs,
      verificationCooldown: riderData.onlineLockReason === 'remit_verified_cooldown'
    };
  }
  throw new HttpsError('permission-denied', 'เฉพาะร้านหรือไรเดอร์');
});

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function riderLockProjection(riderData, nowMs, cooldownUntilMs) {
  const data = riderData || {};
  const legacyLockIsRemittance = String(data.onlineLockReason || '') === 'remit_overdue';
  const manualLockIsActive = String(data.onlineLockReason || '') === 'admin_manual';
  const lock = effectiveLockPlan({
    nowMs,
    remitLockUntilMs: timestampMillis(data.remitLockUntil) || (legacyLockIsRemittance ? timestampMillis(data.onlineLockedUntil) : 0),
    verificationCooldownUntilMs: cooldownUntilMs || timestampMillis(data.verificationCooldownUntil) || timestampMillis(data.remittanceVerificationUntil),
    adminManualUntilMs: manualLockIsActive ? timestampMillis(data.onlineLockedUntil) : 0,
    riskRestrictionUntilMs: timestampMillis(data.riskRestrictionUntil),
    safetySuspensionUntilMs: timestampMillis(data.safetySuspensionUntil)
  });
  return {
    onlineLockedUntil: lock.locked ? Timestamp.fromMillis(lock.untilMs) : FieldValue.delete(),
    onlineLockReason: lock.locked ? lock.reason : FieldValue.delete(),
    remittanceVerificationUntil: cooldownUntilMs > nowMs
      ? Timestamp.fromMillis(cooldownUntilMs)
      : FieldValue.delete()
  };
}

// Remittance submission is server-owned. The deterministic document id makes
// retries from two tabs/devices converge on one daily record instead of
// creating multiple pending slips for the same rider and date.
exports.submitRiderRemittance = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'submitRiderRemittance');
  const uid = req.auth.uid;
  const data = req.data || {};
  const dateKey = typeof data.dateKey === 'string' ? data.dateKey.trim() : '';
  const slipUrl = typeof data.slipUrl === 'string' ? data.slipUrl.trim() : '';
  const slipPath = typeof data.slipPath === 'string' ? data.slipPath.trim() : '';
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  const amountSubmitted = data.amountSubmitted == null || data.amountSubmitted === ''
    ? null
    : Number(data.amountSubmitted);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError('invalid-argument', 'วันที่โอนไม่ถูกต้อง');
  }
  if (!slipUrl || slipUrl.length > 2000) {
    throw new HttpsError('invalid-argument', 'ไม่พบลิงก์สลิป');
  }
  if (slipPath !== `settlement_slips/riders/${uid}/${dateKey}.jpg`) {
    throw new HttpsError('invalid-argument', 'ตำแหน่งสลิปไม่ถูกต้อง');
  }
  if (!isFirebaseStorageUrlForPath(slipUrl, slipPath)) {
    throw new HttpsError('invalid-argument', 'ลิงก์สลิปต้องเป็นไฟล์จาก Firebase Storage ของระบบ');
  }
  if (note.length > 300) throw new HttpsError('invalid-argument', 'หมายเหตุยาวเกินกำหนด');
  if (amountSubmitted != null && (!Number.isFinite(amountSubmitted) || amountSubmitted <= 0 || amountSubmitted > 100000)) {
    throw new HttpsError('invalid-argument', 'ยอดในสลิปไม่ถูกต้อง');
  }

  const riderRef = db.collection('riders').doc(uid);
  const riderSnap = await riderRef.get();
  if (!riderSnap.exists || riderSnap.data().verified !== true) {
    throw new HttpsError('permission-denied', 'บัญชียังไม่ได้รับการอนุมัติ');
  }
  const orderSnap = await db.collection('orders')
    .where('riderId', '==', uid)
    .where('status', 'in', ['done', 'delivered'])
    .get();
  const jobs = orderSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
  const due = riderDailyDue(jobs, Date.now());
  if (due.dateKey !== dateKey) {
    throw new HttpsError('failed-precondition', 'วันที่ยอดโอนเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
  }
  if (!(due.amount > 0) || due.amount > 100000) {
    throw new HttpsError('failed-precondition', 'วันนี้ไม่มียอดที่ต้องโอน');
  }

  const remittanceId = riderRemittanceId(uid, due.dateKey);
  const remittanceRef = db.collection('rider_remittances').doc(remittanceId);
  const now = Timestamp.now();
  const result = await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(remittanceRef);
    const riderTxSnap = await tx.get(riderRef);
    const orderTxSnap = await tx.get(db.collection('orders')
      .where('riderId', '==', uid)
      .where('status', 'in', ['done', 'delivered']));
    if (!riderTxSnap.exists || riderTxSnap.data().verified !== true) {
      throw new HttpsError('permission-denied', 'บัญชียังไม่ได้รับการอนุมัติ');
    }
    const txJobs = orderTxSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
    const txDue = riderDailyDue(txJobs, now.toMillis());
    if (existingSnap.exists) {
      const existing = existingSnap.data() || {};
      if (existing.status === 'pending' || existing.status === 'verified') {
        return {
          alreadySubmitted: true,
          status: existing.status,
          remittanceId,
          amount: txDue.amount,
          dateKey: txDue.dateKey
        };
      }
      if (existing.status !== 'rejected') {
        throw new HttpsError('failed-precondition', 'สถานะสลิปไม่ถูกต้อง');
      }
      if (txDue.dateKey !== dateKey || !(txDue.amount > 0) || txDue.amount > 100000) {
        throw new HttpsError('failed-precondition', 'ยอดปัจจุบันเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
      }
      tx.update(remittanceRef, {
        riderId: uid,
        riderName: String(riderTxSnap.data().name || ''),
        amount: txDue.amount,
        amountSubmitted: amountSubmitted == null ? txDue.amount : Math.round(amountSubmitted * 100) / 100,
        dateKey: txDue.dateKey,
        status: 'pending',
        slipUrl,
        slipPath,
        note,
        createdAt: now,
        rejectedAt: FieldValue.delete(),
        rejectedBy: FieldValue.delete()
      });
      return {
        alreadySubmitted: false,
        replaced: true,
        status: 'pending',
        remittanceId,
        amount: txDue.amount,
        amountSubmitted: amountSubmitted == null ? txDue.amount : Math.round(amountSubmitted * 100) / 100,
        dateKey: txDue.dateKey
      };
    }
    if (txDue.dateKey !== dateKey || !(txDue.amount > 0) || txDue.amount > 100000) {
      throw new HttpsError('failed-precondition', 'ยอดปัจจุบันเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
    }
    tx.create(remittanceRef, {
      riderId: uid,
      riderName: String(riderTxSnap.data().name || ''),
      amount: txDue.amount,
      amountSubmitted: amountSubmitted == null ? txDue.amount : Math.round(amountSubmitted * 100) / 100,
      dateKey: txDue.dateKey,
      status: 'pending',
      slipUrl,
      slipPath,
      note,
      createdAt: now
    });
    return {
      alreadySubmitted: false,
      replaced: false,
      status: 'pending',
      remittanceId,
      amount: txDue.amount,
      amountSubmitted: amountSubmitted == null ? txDue.amount : Math.round(amountSubmitted * 100) / 100,
      dateKey: txDue.dateKey
    };
  });
  await db.collection('settlement_queue').doc('rider_' + uid).set({
    kind: 'rider',
    partyId: uid,
    status: result.status === 'pending' ? 'pending' : result.status,
    amount: result.amount,
    displayAmount: result.amount,
    dateKey: result.dateKey,
    latestRemittanceId: remittanceId,
    latestRemittanceStatus: result.status,
    updatedAt: now
  }, { merge: true });
  return { ok: true, ...result };
});

// Finalize is the only point at which an uploaded Storage object becomes a
// financial remittance. FCM is deliberately sent after this transaction and
// the settlement queue update, so an incomplete/orphaned upload is never
// announced to Admins.
exports.finalizeRiderRemittanceUpload = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'finalizeRiderRemittanceUpload');

  const uid = req.auth.uid;
  const remittanceId = typeof req.data?.remittanceId === 'string'
    ? req.data.remittanceId.trim()
    : '';
  const uploadId = typeof req.data?.uploadId === 'string'
    ? req.data.uploadId.trim()
    : '';

  if (!remittanceId || !uploadId || uploadId.length > 200) {
    throw new HttpsError('invalid-argument', 'ข้อมูล Upload Session ไม่ครบ');
  }

  const remittanceRef = db.collection('rider_remittances').doc(remittanceId);
  const initialSnap = await remittanceRef.get();
  if (!initialSnap.exists) throw new HttpsError('not-found', 'ไม่พบรายการ Remittance');

  const initial = initialSnap.data() || {};
  if (initial.riderId !== uid) {
    throw new HttpsError('permission-denied', 'ไม่มีสิทธิ์จัดการรายการนี้');
  }
  if (initial.status !== 'uploading') {
    if (initial.status === 'pending') {
      return { ok: true, alreadyFinalized: true, remittanceId, status: 'pending', dateKey: initial.dateKey };
    }
    throw new HttpsError('failed-precondition', 'รายการไม่อยู่ในสถานะรออัปโหลด');
  }
  if (initial.uploadId !== uploadId) {
    throw new HttpsError('permission-denied', 'Upload Session ไม่ถูกต้อง');
  }

  const slipPath = String(initial.slipPath || '');
  const expectedPrefix = `settlement_slips/riders/${uid}/`;
  if (!slipPath.startsWith(expectedPrefix) || slipPath.includes('..')) {
    throw new HttpsError('failed-precondition', 'ตำแหน่งไฟล์สลิปไม่ถูกต้อง');
  }

  const file = bucket.file(slipPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if (error.code === 404) throw new HttpsError('not-found', 'ยังไม่พบไฟล์สลิปใน Storage');
    console.error('Failed to inspect remittance upload', error);
    throw new HttpsError('internal', 'ไม่สามารถตรวจสอบไฟล์สลิปได้');
  }

  const size = Number(metadata.size || 0);
  const contentType = String(metadata.contentType || '').toLowerCase();
  const objectUploadId = String(metadata.metadata?.uploadId || '');
  if (!['image/jpeg', 'image/png'].includes(contentType)) {
    throw new HttpsError('invalid-argument', 'ประเภทไฟล์สลิปไม่ถูกต้อง');
  }
  if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'ขนาดไฟล์สลิปไม่ถูกต้องหรือใหญ่เกินกำหนด');
  }
  if (objectUploadId !== uploadId) {
    throw new HttpsError('failed-precondition', 'ไฟล์ไม่ตรงกับ Upload Session');
  }

  const now = Timestamp.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(remittanceRef);
    if (!snap.exists) throw new HttpsError('not-found', 'ไม่พบรายการ Remittance');
    const current = snap.data() || {};
    if (current.riderId !== uid || current.uploadId !== uploadId) {
      throw new HttpsError('failed-precondition', 'รายการ Upload ถูกเปลี่ยนแปลงแล้ว');
    }
    if (current.status === 'pending') {
      return { alreadyFinalized: true, remittance: current };
    }
    if (current.status !== 'uploading') {
      throw new HttpsError('failed-precondition', 'สถานะ Remittance ไม่ถูกต้อง');
    }
    tx.update(remittanceRef, {
      status: 'pending',
      contentType,
      fileSize: size,
      storageGeneration: String(metadata.generation || ''),
      submittedAt: now,
      updatedAt: now
    });
    return { alreadyFinalized: false, remittance: { ...current, status: 'pending' } };
  });

  const remittance = result.remittance;
  await db.collection('settlement_queue').doc(`rider_${uid}`).set({
    kind: 'rider',
    partyId: uid,
    status: 'pending',
    amount: remittance.amount,
    displayAmount: remittance.amount,
    dateKey: remittance.dateKey,
    latestRemittanceId: remittanceId,
    latestRemittanceStatus: 'pending',
    updatedAt: now
  }, { merge: true });

  let adminNotification;
  if (shouldNotifyFinalizedRemittance(result)) {
    adminNotification = await notifyAdminsOfRemittance(db, {
      remittanceId,
      riderId: uid,
      riderName: String(remittance.riderName || ''),
      dateKey: remittance.dateKey,
      amount: remittance.amount,
      amountSubmitted: remittance.amountSubmitted
    }).catch((error) => {
      console.error(JSON.stringify({
        event: 'remittance_admin_notification_failed',
        remittanceId,
        riderId: uid,
        errorCode: error && error.code ? String(error.code) : 'unknown',
        errorMessage: error && error.message ? String(error.message).slice(0, 300) : 'unknown'
      }));
      return { ok: false, status: 'failed', reason: 'notification_exception' };
    });
  }

  return {
    ok: true,
    alreadyFinalized: result.alreadyFinalized,
    remittanceId,
    dateKey: remittance.dateKey,
    slipPath,
    status: 'pending',
    adminNotification
  };
});

// Admin clients register their FCM token through a trusted callable. Tokens
// are never accepted from an unauthenticated or non-admin client write.
exports.registerAdminFcmToken = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'registerAdminFcmToken');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมินเท่านั้น');
  }

  const token = typeof req.data?.token === 'string' ? req.data.token.trim() : '';
  if (!token || token.length > 4096) {
    throw new HttpsError('invalid-argument', 'FCM Token ไม่ถูกต้อง');
  }

  const adminRef = db.collection('admins').doc(req.auth.uid);
  const adminSnap = await adminRef.get();
  const currentRole = adminSnap.exists ? String(adminSnap.data().role || '') : '';
  await adminRef.set({
    fcmTokens: FieldValue.arrayUnion(token),
    fcmTokenUpdatedAt: Timestamp.now(),
    ...(currentRole === 'active' || currentRole === 'super' ? {} : { role: 'active' })
  }, { merge: true });

  return { ok: true };
});

exports.reviewRiderRemittance = onCall(CALL, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  guardRequiredAppCheck(req, 'reviewRiderRemittance');
  if (!(await D.callerIsAdmin(db, req.auth))) {
    throw new HttpsError('permission-denied', 'เฉพาะแอดมินการเงิน');
  }
  const data = req.data || {};
  let remittanceId;
  try {
    remittanceId = normalizeId(data.remittanceId, 'รหัสสลิป');
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (!['verify', 'reject'].includes(action)) {
    throw new HttpsError('invalid-argument', 'ข้อมูลการตรวจสลิปไม่ครบ');
  }
  const ref = db.collection('rider_remittances').doc(remittanceId);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('ไม่พบรายการสลิป');
      const remittance = snap.data();
      const riderId = String(remittance.riderId || '');
      const riderRef = db.collection('riders').doc(riderId);
      const riderSnap = await tx.get(riderRef);
      const orderSnap = await tx.get(db.collection('orders')
        .where('riderId', '==', riderId)
        .where('status', 'in', ['done', 'delivered']));
      const jobs = orderSnap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
      const plan = riderReviewPlan(remittance, jobs, action);
      if (plan.already) return { ok: true, alreadyReviewed: true, status: plan.status, remittanceId };
      const now = Timestamp.now();
      const remainingJobs = plan.status === 'verified'
        ? jobs.filter((job) => !plan.jobIds.includes(job.id))
        : jobs;
      const freshDue = riderDailyDue(remainingJobs, now.toMillis());
      if (plan.status === 'rejected') {
        tx.update(ref, { status: 'rejected', rejectedAt: now, rejectedBy: req.auth.uid });
      } else {
        plan.jobIds.forEach((jobId) => {
          tx.update(db.collection('orders').doc(jobId), { riderPaid: true, riderPaidAt: now });
        });
        const submittedAmount = Number.isFinite(plan.submittedAmount)
          ? plan.submittedAmount
          : Math.round(Number(remittance.amountSubmitted != null ? remittance.amountSubmitted : remittance.amount || 0) * 100) / 100;
        const remainingDue = Math.max(0, Math.round((Number(plan.dueAmount || 0) - submittedAmount) * 100) / 100);
        const overpaidAmount = Math.max(0, Math.round((submittedAmount - Number(plan.dueAmount || 0)) * 100) / 100);
        tx.update(ref, {
          status: 'verified',
          verifiedAt: now,
          verifiedBy: req.auth.uid,
          jobIds: plan.jobIds,
          amountExpected: Number(plan.dueAmount || 0),
          amountSubmitted: submittedAmount,
          remainingDue,
          overpaidAmount
        });
        if (riderSnap.exists) {
          const unlockAt = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
          tx.update(riderRef, riderLockProjection(riderSnap.data(), now.toMillis(), unlockAt.toMillis()));
        }
      }
      tx.set(db.collection('settlement_queue').doc('rider_' + riderId), {
        kind: 'rider',
        partyId: riderId,
        status: plan.status === 'verified' ? 'clear' : 'rejected',
        amount: plan.status === 'verified' ? freshDue.amount : Number(remittance.amount || 0),
        dateKey: freshDue.dateKey,
        nextAmount: freshDue.nextAmount,
        nextDateKey: freshDue.nextDateKey,
        cutoff: freshDue.cutoff,
        displayAmount: freshDue.amount > 0 ? freshDue.amount : (freshDue.nextAmount > 0 ? freshDue.nextAmount : 0),
        latestRemittanceId: remittanceId,
        latestRemittanceStatus: plan.status,
        updatedAt: now
      }, { merge: true });
      return {
        ok: true,
        alreadyReviewed: false,
        status: plan.status,
        remittanceId,
        riderId,
        dueAmount: plan.dueAmount,
        overpaidAmount: plan.overpaidAmount || 0,
        remainingDue: plan.status === 'verified'
          ? Math.max(0, Math.round((Number(plan.dueAmount || 0) - Number(plan.submittedAmount || 0)) * 100) / 100)
          : undefined
      };
    });
    console.info(JSON.stringify({ event: 'rider_remittance_reviewed', remittanceId, status: result.status }));
    return result;
  } catch (err) {
    throw reviewRiderError(err);
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
