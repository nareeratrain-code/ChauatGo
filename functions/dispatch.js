'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { geohashQueryBounds, distanceBetween } = require('geofire-common');

const DEFAULT_CONFIG = {
  mode: 'manual',
  radiusStepsKm: [3, 5, 8],
  offerTimeoutSec: 20,
  maxJobsPerRider: 1,
  staleLocationSec: 120,
  weights: { distance: 1, idle: 1, acceptance: 1, rating: 1 }
};

const OPEN_STATUSES = ['searching', 'pending', 'cooking', 'ready'];
const KITCHEN_STATUSES = ['cooking', 'ready'];
// picked_up still occupies a slot. The rider screen labels a transfer order
// in this status "รอลูกค้าโอนเงิน": the rider already collected the goods and
// has not pressed เริ่มส่ง. delivered and done are terminal and do not count.
const ACTIVE_STATUSES = ['accepted', 'picked_up', 'customer_paid', 'on_the_way'];
const TERMINAL = ['done', 'delivered', 'cancelled'];
const MASTER_EMAILS = [
  'adminchauatgo@gmail.com',
  'admin@chauatgo.com',
  'chauatgo@gmail.com'
];

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function finiteOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

const REASON_NO_PICKUP = 'ร้านไม่มีพิกัด';
const REASON_WAIT_SHOP = 'รอร้านรับออเดอร์';

function normalizeMode(mode) {
  const raw = String(mode || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'auto' || lower === 'automatic' || raw === 'อัตโนมัติ') return 'auto';
  return 'manual';
}

function normalizeConfig(raw) {
  const d = raw || {};
  const steps = Array.isArray(d.radiusStepsKm)
    ? d.radiusStepsKm.map(Number).filter((n) => n > 0 && n <= 50)
    : [];
  const w = d.weights || {};
  return {
    mode: normalizeMode(d.mode),
    radiusStepsKm: steps.length ? steps : DEFAULT_CONFIG.radiusStepsKm.slice(),
    offerTimeoutSec: clamp(Number(d.offerTimeoutSec) || 20, 10, 120),
    maxJobsPerRider: clamp(Math.round(Number(d.maxJobsPerRider) || 1), 1, 5),
    staleLocationSec: clamp(Number(d.staleLocationSec) || 120, 30, 600),
    weights: {
      distance: numOr(w.distance, 1),
      idle: numOr(w.idle, 1),
      acceptance: numOr(w.acceptance, 1),
      rating: numOr(w.rating, 1)
    },
    vapidKey: typeof d.vapidKey === 'string' ? d.vapidKey : ''
  };
}

function exhaustedReason(radiusKm, skips) {
  const km = Number(radiusKm);
  const base = Number.isFinite(km) && km > 0
    ? 'ไม่มีไรเดอร์ว่างในระยะ ' + km + ' กม.'
    : 'ไม่มีไรเดอร์ว่างในระยะ';
  const s = skips || {};
  if ((s.unverified || 0) > 0 || (s.badStatus || 0) > 0) {
    return base + ' — ไรเดอร์ในระยะยังไม่พร้อมรับงาน';
  }
  if ((s.stale || 0) > 0 && !(s.busy > 0)) return base + ' — พิกัดไรเดอร์เก่าเกินไป';
  if ((s.busy || 0) > 0) return base + ' — ไรเดอร์ในระยะมีงานอยู่แล้ว';
  return base;
}

function codePatch(order) {
  if (order && String(order.code || '').trim()) return {};
  return {
    code: 'OD-' + String(Math.floor(1000 + Math.random() * 9000)),
    deliveryCode: String(Math.floor(1000 + Math.random() * 9000)),
    codeCreatedAt: FieldValue.serverTimestamp()
  };
}

function needsKitchen(order) {
  if (!order) return false;
  if (order.type === 'ride' || order.type === 'express' || order.type === 'shopping') return false;
  if (order.type === 'food') return true;
  return !!order.merchantId;
}

function needsDispatch(order) {
  if (!order) return false;
  if (order.riderId) return false;
  if (TERMINAL.indexOf(order.status) !== -1) return false;
  if (order.dispatchState === 'manual' || order.dispatchState === 'assigned') return false;
  if (needsKitchen(order)) return KITCHEN_STATUSES.indexOf(order.status) !== -1;
  return OPEN_STATUSES.indexOf(order.status) !== -1;
}

function pickupOf(order) {
  if (!order) return null;
  const lat = finiteOrNull(order.shopPlaceLat);
  const lng = finiteOrNull(order.shopPlaceLng);
  const fromLat = finiteOrNull(order.fromLat);
  const fromLng = finiteOrNull(order.fromLng);
  const useLat = lat != null ? lat : fromLat;
  const useLng = lng != null ? lng : fromLng;
  if (useLat == null || useLng == null) return null;
  if (Math.abs(useLat) > 90 || Math.abs(useLng) > 180) return null;
  if (useLat === 0 && useLng === 0) return null;
  return { lat: useLat, lng: useLng };
}

function acceptanceRate(offersAccepted, offersTotal) {
  const total = Number(offersTotal || 0);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, Number(offersAccepted || 0) / total));
}

function scoreCandidate(c, weights, radiusKm) {
  const w = weights || DEFAULT_CONFIG.weights;
  const radius = radiusKm > 0 ? radiusKm : 3;
  const distScore = Math.max(0, 1 - (Number(c.distanceKm || 0) / radius));
  const idleScore = Math.min(1, Math.max(0, Number(c.idleMs || 0)) / (60 * 60 * 1000));
  const rate = acceptanceRate(c.offersAccepted, c.offersTotal);
  const rating = Number(c.rating);
  const ratingNorm = !rating || rating <= 0 ? 0.8 : Math.max(0, Math.min(1, rating / 5));
  return (Number(w.distance) || 0) * distScore
    + (Number(w.idle) || 0) * idleScore
    + (Number(w.acceptance) || 0) * rate
    + (Number(w.rating) || 0) * ratingNorm;
}

function rankCandidates(list, weights, radiusKm) {
  return list.slice().sort((a, b) => {
    const diff = scoreCandidate(b, weights, radiusKm) - scoreCandidate(a, weights, radiusKm);
    if (Math.abs(diff) > 1e-9) return diff;
    return Number(a.distanceKm || 0) - Number(b.distanceKm || 0);
  });
}

function walkRadius(steps, startStep, hasCandidate) {
  const list = Array.isArray(steps) && steps.length ? steps : DEFAULT_CONFIG.radiusStepsKm;
  let i = Math.max(0, Number(startStep) || 0);
  while (i < list.length) {
    if (hasCandidate(list[i], i)) return { step: i, radiusKm: list[i], exhausted: false };
    i += 1;
  }
  return { step: i, radiusKm: null, exhausted: true };
}

async function loadConfig(db) {
  const snap = await db.doc('config/dispatch').get();
  if (!snap.exists) return normalizeConfig(null);
  return normalizeConfig(snap.data());
}

async function callerIsAdmin(db, auth) {
  if (!auth || !auth.uid) return false;
  const email = String((auth.token && auth.token.email) || '').toLowerCase();
  if (MASTER_EMAILS.indexOf(email) !== -1) return true;
  const adminDoc = await db.collection('admins').doc(auth.uid).get();
  if (adminDoc.exists && ['active', 'super'].indexOf(adminDoc.data().role) !== -1) return true;
  const userDoc = await db.collection('users').doc(auth.uid).get();
  if (!userDoc.exists) return false;
  const user = userDoc.data();
  return user.role === 'admin' && user.isPending !== true;
}

function stringifyData(data) {
  const out = {};
  const src = data || {};
  Object.keys(src).forEach((k) => {
    if (src[k] == null) return;
    out[k] = String(src[k]);
  });
  return out;
}

async function notifyRider(db, riderId, msg) {
  try {
    const snap = await db.collection('riders').doc(riderId).get();
    if (!snap.exists) return;
    const tokens = snap.data().fcmTokens;
    if (!Array.isArray(tokens) || !tokens.length) return;
    const res = await getMessaging().sendEachForMulticast({
      tokens: tokens.slice(0, 20),
      notification: { title: msg.title, body: msg.body },
      data: stringifyData(msg.data),
      webpush: {
        fcmOptions: { link: '/rider.html' },
        notification: { icon: '/icons/icon-512.png' }
      }
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token') {
        bad.push(tokens[i]);
      }
    });
    if (bad.length) {
      await db.collection('riders').doc(riderId).update({
        fcmTokens: FieldValue.arrayRemove.apply(FieldValue, bad)
      });
    }
  } catch (err) {
    /* Push is best-effort. Missing credentials or a closed app must not stop dispatch. */
  }
}

async function considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips) {
  if (!doc || seen.has(doc.id) || skip.has(doc.id)) return;
  seen.add(doc.id);
  const g = doc.data() || {};
  if (g.online !== true) {
    skips.offline += 1;
    return;
  }
  const lat = finiteOrNull(g.lat);
  const lng = finiteOrNull(g.lng);
  if (lat == null || lng == null) return;
  const updated = tsMillis(g.updatedAt);
  const staleMs = cfg.staleLocationSec * 1000;
  if (!updated || nowMs - updated > staleMs) {
    skips.stale += 1;
    return;
  }
  const dist = distanceBetween([pickup.lat, pickup.lng], [lat, lng]);
  if (dist > radiusKm + 0.001) {
    skips.far += 1;
    return;
  }
  const riderSnap = await db.collection('riders').doc(doc.id).get();
  if (!riderSnap.exists) {
    skips.badStatus += 1;
    return;
  }
  const r = riderSnap.data() || {};
  if (r.verified !== true) {
    skips.unverified += 1;
    return;
  }
  if (r.status !== 'active' && r.status !== 'available') {
    skips.badStatus += 1;
    return;
  }
  let jobs = Number(r.activeJobCount || 0);
  if (jobs >= cfg.maxJobsPerRider) {
    jobs = await reconcileRiderJobs(db, doc.id);
  } else {
    // A counter that was never raised still looks free. Count the live
    // orders (including รอลูกค้าโอนเงิน / picked_up) before offering another.
    const live = await countActiveJobs(db, doc.id);
    if (live > jobs) {
      await raiseRiderJobCount(db, doc.id, live);
      jobs = live;
    }
  }
  if (jobs >= cfg.maxJobsPerRider) {
    skips.busy += 1;
    return;
  }
  const idleSince = tsMillis(r.idleSince) || tsMillis(r.onlineSince) || updated;
  out.push({
    riderId: doc.id,
    riderName: r.name || g.name || '',
    riderPhone: r.phone || '',
    distanceKm: dist,
    idleMs: Math.max(0, nowMs - idleSince),
    offersTotal: Number(r.offersTotal || 0),
    offersAccepted: Number(r.offersAccepted || 0),
    rating: Number(r.rating || 0),
    activeJobCount: jobs
  });
}

async function findCandidates(db, pickup, radiusKm, offeredIds, cfg, nowMs, extraSkip) {
  const bounds = geohashQueryBounds([pickup.lat, pickup.lng], radiusKm * 1000);
  const skip = new Set(offeredIds || []);
  (extraSkip || []).forEach((id) => skip.add(id));
  const seen = new Set();
  const out = [];
  const skips = { offline: 0, stale: 0, far: 0, busy: 0, unverified: 0, badStatus: 0 };
  for (let i = 0; i < bounds.length; i++) {
    const start = bounds[i][0];
    const end = bounds[i][1];
    const snap = await db.collection('gps_riders')
      .orderBy('geohash')
      .startAt(start)
      .endAt(end)
      .limit(40)
      .get();
    for (const doc of snap.docs) {
      await considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips);
    }
  }
  // Admin's manual list does not use geohash. A fresh online rider with a
  // missing geohash would show there and never be offered. Scan online docs too.
  const onlineSnap = await db.collection('gps_riders').where('online', '==', true).limit(80).get();
  for (const doc of onlineSnap.docs) {
    await considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips);
  }
  return { list: out, skips: skips };
}

async function offerNextOnce(db, orderId, cfg, extraSkip) {
  const nowMs = Date.now();
  const ref = db.collection('orders').doc(orderId);
  const pre = await ref.get();
  if (!pre.exists) return { skipped: 'missing' };
  const preData = pre.data() || {};
  if (preData.riderId) return { skipped: 'assigned' };
  if (preData.dispatchState === 'manual' || preData.dispatchState === 'assigned') {
    return { skipped: preData.dispatchState };
  }
  if (preData.dispatchState === 'offered') {
    const live = tsMillis(preData.dispatchOfferExpiresAt);
    if (preData.dispatchOfferRiderId && live > nowMs) return { skipped: 'live' };
  }
  if (!needsDispatch(Object.assign({}, preData, {
    dispatchState: preData.dispatchState === 'offered' ? 'seeking' : preData.dispatchState
  }))) {
    return { skipped: 'not-ready' };
  }

  const pickup = pickupOf(preData);
  if (!pickup) {
    await ref.update(Object.assign({
      dispatchState: 'manual',
      dispatchManualReason: REASON_NO_PICKUP,
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    }, codePatch(preData)));
    return { skipped: 'no-pickup' };
  }

  const offered = Array.isArray(preData.dispatchOfferedIds) ? preData.dispatchOfferedIds.slice() : [];
  let step = Number(preData.dispatchRadiusStep || 0);
  if (step < 0) step = 0;
  const steps = cfg.radiusStepsKm;
  let chosen = null;
  let radiusKm = steps[0];
  let lastSkips = {};
  while (step < steps.length) {
    radiusKm = steps[step];
    const found = await findCandidates(db, pickup, radiusKm, offered, cfg, nowMs, extraSkip);
    lastSkips = found.skips || {};
    const ranked = rankCandidates(found.list || [], cfg.weights, radiusKm);
    if (ranked.length) {
      chosen = ranked[0];
      break;
    }
    step += 1;
  }
  if (!chosen) {
    const lastRadius = steps.length ? steps[steps.length - 1] : radiusKm;
    await ref.update(Object.assign({
      dispatchState: 'manual',
      dispatchRadiusStep: step,
      dispatchManualReason: exhaustedReason(lastRadius, lastSkips),
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    }, codePatch(preData)));
    return { skipped: 'exhausted', step: step };
  }

  const offerRef = ref.collection('dispatchOffers').doc();
  const expiresAt = new Date(nowMs + cfg.offerTimeoutSec * 1000);
  const score = Math.round(scoreCandidate(chosen, cfg.weights, radiusKm) * 1000) / 1000;
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false };
    const order = snap.data() || {};
    if (order.riderId) return { ok: false };
    if (order.dispatchState === 'manual' || order.dispatchState === 'assigned') return { ok: false };
    const riderRef = db.collection('riders').doc(chosen.riderId);
    const reads = [tx.get(riderRef)];
    let oldRef = null;
    if (order.dispatchOfferId) {
      oldRef = ref.collection('dispatchOffers').doc(order.dispatchOfferId);
      reads.push(tx.get(oldRef));
    }
    const got = await Promise.all(reads);
    const riderSnap = got[0];
    const oldSnap = got[1];
    if (!riderSnap.exists) return { retryRider: chosen.riderId };
    const jobs = Number((riderSnap.data() || {}).activeJobCount || 0);
    if (jobs >= cfg.maxJobsPerRider) return { retryRider: chosen.riderId };
    if (order.dispatchState === 'offered' && order.dispatchOfferRiderId) {
      const live = tsMillis(order.dispatchOfferExpiresAt);
      if (live > nowMs) return { ok: false };
    }
    let oldRiderRef = null;
    let oldRiderSnap = null;
    if (oldSnap && oldSnap.exists && oldSnap.data().status === 'pending') {
      const oldExp = tsMillis(oldSnap.data().expiresAt);
      if (oldExp && oldExp > nowMs) return { ok: false };
      const oldRiderId = oldSnap.data().riderId;
      if (oldRiderId) {
        oldRiderRef = db.collection('riders').doc(oldRiderId);
        oldRiderSnap = await tx.get(oldRiderRef);
      }
    }
    if (!needsDispatch(Object.assign({}, order, { dispatchState: 'seeking' }))) return { ok: false };

    if (oldSnap && oldSnap.exists && oldSnap.data().status === 'pending') {
      tx.update(oldRef, {
        status: 'expired',
        respondedAt: FieldValue.serverTimestamp()
      });
      if (oldRiderSnap && oldRiderSnap.exists) {
        tx.update(oldRiderRef, { offersTotal: FieldValue.increment(1) });
      }
    }

    tx.set(offerRef, {
      orderId: orderId,
      riderId: chosen.riderId,
      riderName: chosen.riderName,
      status: 'pending',
      distanceKm: Math.round(chosen.distanceKm * 1000) / 1000,
      score: score,
      radiusKm: radiusKm,
      wave: step,
      title: order.title || '',
      merchantName: order.merchantName || '',
      pickupName: order.shopPlaceName || order.fromName || order.merchantName || '',
      fare: Number(order.fare || order.total || 0),
      orderCode: order.code || order.orderCode || '',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      respondedAt: null
    });
    tx.update(ref, Object.assign({
      dispatchMode: 'auto',
      dispatchState: 'offered',
      dispatchOfferId: offerRef.id,
      dispatchOfferRiderId: chosen.riderId,
      dispatchOfferExpiresAt: Timestamp.fromDate(expiresAt),
      dispatchRadiusStep: step,
      dispatchOfferedIds: FieldValue.arrayUnion(chosen.riderId),
      dispatchManualReason: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    }, codePatch(order)));
    return { ok: true, offerId: offerRef.id, riderId: chosen.riderId };
  });

  if (created && created.retryRider) return created;
  if (!created || !created.ok) return { skipped: 'race' };
  await notifyRider(db, created.riderId, {
    title: 'มีงานใหม่',
    body: (preData.merchantName || preData.title || 'ออเดอร์') + ' • รับภายใน ' + cfg.offerTimeoutSec + ' วินาที',
    data: { type: 'dispatch_offer', orderId: orderId, offerId: created.offerId }
  });
  return { ok: true, offerId: created.offerId, riderId: created.riderId, radiusKm: radiusKm, step: step };
}

async function offerNext(db, orderId) {
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto') return { skipped: 'manual' };
  const extraSkip = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await offerNextOnce(db, orderId, cfg, extraSkip);
    if (result && result.retryRider) {
      extraSkip.push(result.retryRider);
      continue;
    }
    return result;
  }
  return { skipped: 'retry' };
}

async function expireOffer(db, orderId, offerId, reason) {
  const orderRef = db.collection('orders').doc(orderId);
  const offerRef = orderRef.collection('dispatchOffers').doc(offerId);
  const status = reason === 'skipped' ? 'skipped' : 'expired';
  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    const orderSnap = await tx.get(orderRef);
    if (!offerSnap.exists || !orderSnap.exists) return { acted: false };
    const offer = offerSnap.data() || {};
    const order = orderSnap.data() || {};
    if (offer.status !== 'pending') return { acted: false };
    if (status === 'expired') {
      const exp = tsMillis(offer.expiresAt);
      if (exp && exp > Date.now() + 1500) return { acted: false, early: true };
    }
    const riderRef = db.collection('riders').doc(offer.riderId);
    const riderSnap = offer.riderId ? await tx.get(riderRef) : null;
    tx.update(offerRef, {
      status: status,
      respondedAt: FieldValue.serverTimestamp()
    });
    if (riderSnap && riderSnap.exists) {
      tx.update(riderRef, { offersTotal: FieldValue.increment(1) });
    }
    if (order.dispatchOfferId === offerId && !order.riderId) {
      tx.update(orderRef, {
        dispatchState: 'seeking',
        dispatchOfferId: FieldValue.delete(),
        dispatchOfferRiderId: FieldValue.delete(),
        dispatchOfferExpiresAt: FieldValue.delete(),
        dispatchUpdatedAt: FieldValue.serverTimestamp()
      });
      return { acted: true, advance: true };
    }
    return { acted: true, advance: false };
  });
  if (result && result.advance) await offerNext(db, orderId);
  return result;
}

async function acceptOffer(db, uid, orderId, offerId) {
  const orderRef = db.collection('orders').doc(orderId);
  const offerRef = orderRef.collection('dispatchOffers').doc(offerId);
  const riderRef = db.collection('riders').doc(uid);
  const cfg = await loadConfig(db);
  const liveJobs = await countActiveJobs(db, uid);
  if (liveJobs >= cfg.maxJobsPerRider) {
    const riderPre = await riderRef.get();
    const stored = riderPre.exists ? Number((riderPre.data() || {}).activeJobCount || 0) : 0;
    if (liveJobs > stored) await raiseRiderJobCount(db, uid, liveJobs);
    throw new Error('busy');
  }
  await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    const orderSnap = await tx.get(orderRef);
    const riderSnap = await tx.get(riderRef);
    if (!offerSnap.exists) throw new Error('missing-offer');
    if (!orderSnap.exists) throw new Error('missing-order');
    if (!riderSnap.exists) throw new Error('missing-rider');
    const offer = offerSnap.data() || {};
    const order = orderSnap.data() || {};
    const rider = riderSnap.data() || {};
    if (offer.riderId !== uid) throw new Error('not-yours');
    if (offer.status !== 'pending') throw new Error('closed');
    const exp = tsMillis(offer.expiresAt);
    if (exp && exp < Date.now()) throw new Error('expired');
    if (order.riderId) throw new Error('taken');
    if (order.dispatchOfferId !== offerId) throw new Error('stale');
    const jobs = Number(rider.activeJobCount || 0);
    if (jobs >= cfg.maxJobsPerRider) throw new Error('busy');
    if (rider.verified !== true) throw new Error('unverified');
    tx.update(orderRef, {
      riderId: uid,
      riderName: rider.name || offer.riderName || '',
      riderPhone: rider.phone || '',
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      dispatchState: 'assigned',
      dispatchCounted: true,
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchOfferExpiresAt: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    });
    tx.update(offerRef, {
      status: 'accepted',
      respondedAt: FieldValue.serverTimestamp()
    });
    tx.update(riderRef, {
      offersAccepted: FieldValue.increment(1),
      offersTotal: FieldValue.increment(1),
      activeJobCount: FieldValue.increment(1),
      idleSince: null
    });
  });
  return { ok: true };
}

async function manualAssign(db, adminUid, orderId, riderId) {
  const orderRef = db.collection('orders').doc(orderId);
  const riderRef = db.collection('riders').doc(riderId);
  const offerRef = orderRef.collection('dispatchOffers').doc();
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const riderSnap = await tx.get(riderRef);
    if (!orderSnap.exists) throw new Error('missing-order');
    if (!riderSnap.exists) throw new Error('missing-rider');
    const order = orderSnap.data() || {};
    const rider = riderSnap.data() || {};
    if (order.riderId) throw new Error('taken');
    if (TERMINAL.indexOf(order.status) !== -1) throw new Error('closed');
    let prevRef = null;
    let prevSnap = null;
    if (order.dispatchOfferId) {
      prevRef = orderRef.collection('dispatchOffers').doc(order.dispatchOfferId);
      prevSnap = await tx.get(prevRef);
    }
    if (prevSnap && prevSnap.exists && prevSnap.data().status === 'pending') {
      tx.update(prevRef, {
        status: 'expired',
        respondedAt: FieldValue.serverTimestamp()
      });
    }
    tx.set(offerRef, {
      orderId: orderId,
      riderId: riderId,
      riderName: rider.name || '',
      status: 'accepted',
      source: 'manual',
      assignedBy: adminUid,
      title: order.title || '',
      merchantName: order.merchantName || '',
      orderCode: order.code || order.orderCode || '',
      createdAt: FieldValue.serverTimestamp(),
      respondedAt: FieldValue.serverTimestamp(),
      wave: Number(order.dispatchRadiusStep || 0)
    });
    tx.update(orderRef, Object.assign({
      riderId: riderId,
      riderName: rider.name || '',
      riderPhone: rider.phone || '',
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      dispatchState: 'assigned',
      dispatchCounted: true,
      dispatchOfferId: offerRef.id,
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchOfferExpiresAt: FieldValue.delete(),
      dispatchMode: 'manual-override',
      dispatchManualReason: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    }, codePatch(order)));
    tx.update(riderRef, {
      offersAccepted: FieldValue.increment(1),
      offersTotal: FieldValue.increment(1),
      activeJobCount: FieldValue.increment(1),
      idleSince: null
    });
  });
  await notifyRider(db, riderId, {
    title: 'แอดมินจ่ายงานให้คุณ',
    body: 'เปิดแอปเพื่อดูงาน',
    data: { type: 'manual_assign', orderId: orderId }
  });
  return { ok: true, offerId: offerRef.id };
}

async function releaseRiderJob(db, riderId) {
  if (!riderId) return;
  const ref = db.collection('riders').doc(riderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const n = Math.max(0, Number((snap.data() || {}).activeJobCount || 0) - 1);
    const patch = { activeJobCount: n };
    if (n === 0) patch.idleSince = FieldValue.serverTimestamp();
    tx.update(ref, patch);
  });
}

async function countActiveJobs(db, riderId) {
  const snap = await db.collection('orders')
    .where('riderId', '==', riderId)
    .where('status', 'in', ACTIVE_STATUSES)
    .limit(8)
    .get();
  return snap.size;
}

async function raiseRiderJobCount(db, riderId, live) {
  if (!riderId) return;
  const next = Number(live || 0);
  if (next <= 0) return;
  const ref = db.collection('riders').doc(riderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = Number((snap.data() || {}).activeJobCount || 0);
    if (current >= next) return;
    tx.update(ref, { activeJobCount: next, idleSince: null });
  });
}

async function reconcileRiderJobs(db, riderId) {
  if (!riderId) return 0;
  const live = await countActiveJobs(db, riderId);
  const ref = db.collection('riders').doc(riderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = Number((snap.data() || {}).activeJobCount || 0);
    if (current <= live) return;
    const patch = { activeJobCount: live };
    if (live === 0) patch.idleSince = FieldValue.serverTimestamp();
    tx.update(ref, patch);
  });
  return live;
}

async function reconcileBusyRiders(db) {
  const snap = await db.collection('riders').where('activeJobCount', '>', 0).limit(40).get();
  for (const doc of snap.docs) {
    await reconcileRiderJobs(db, doc.id);
  }
  return snap.size;
}

async function ensureAssigned(db, orderId) {
  const orderRef = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const order = snap.data() || {};
    if (!order.riderId || order.dispatchCounted === true) return;
    const riderRef = db.collection('riders').doc(order.riderId);
    const riderSnap = await tx.get(riderRef);
    let offerSnap = null;
    let offerRef = null;
    if (order.dispatchOfferId) {
      offerRef = orderRef.collection('dispatchOffers').doc(order.dispatchOfferId);
      offerSnap = await tx.get(offerRef);
    }
    const patch = {
      activeJobCount: FieldValue.increment(1),
      idleSince: null
    };
    if (offerSnap && offerSnap.exists && offerSnap.data().status === 'pending') {
      tx.update(offerRef, {
        status: 'accepted',
        respondedAt: FieldValue.serverTimestamp()
      });
      patch.offersAccepted = FieldValue.increment(1);
      patch.offersTotal = FieldValue.increment(1);
    }
    if (riderSnap.exists) tx.update(riderRef, patch);
    tx.update(orderRef, {
      dispatchState: 'assigned',
      dispatchCounted: true,
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchOfferExpiresAt: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function ensureOrderCode(db, orderId) {
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return '';
  const order = snap.data() || {};
  if (String(order.code || '').trim()) return order.code;
  if (TERMINAL.indexOf(order.status) !== -1) return '';
  const patch = codePatch(order);
  await ref.set(patch, { merge: true });
  return patch.code;
}

async function noteWaitingForShop(db, orderId, hinted) {
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  const order = snap.exists ? (snap.data() || {}) : (hinted || {});
  if (!snap.exists || order.riderId) return { skipped: 'assigned' };
  if (!needsKitchen(order)) return { skipped: 'not-kitchen' };
  if (order.status !== 'searching' && order.status !== 'pending') return { skipped: 'not-waiting' };
  if (order.dispatchState === 'manual' || order.dispatchState === 'assigned' || order.dispatchState === 'offered') {
    return { skipped: order.dispatchState };
  }
  if (order.dispatchState === 'waiting' && order.dispatchManualReason === REASON_WAIT_SHOP && String(order.code || '').trim()) {
    return { skipped: 'noted' };
  }
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto') return { skipped: 'manual' };
  await ref.set(Object.assign({
    dispatchState: 'waiting',
    dispatchManualReason: REASON_WAIT_SHOP,
    dispatchMode: 'auto',
    dispatchUpdatedAt: FieldValue.serverTimestamp()
  }, codePatch(order)), { merge: true });
  return { ok: true, waiting: true };
}

function holdsJobSlot(order) {
  return !!(order && order.riderId && ACTIVE_STATUSES.indexOf(order.status) !== -1);
}

async function onOrderWritten(db, before, after, orderId) {
  const beforeHolds = holdsJobSlot(before);
  const afterSameRider = after && before && after.riderId === before.riderId && holdsJobSlot(after);
  if (beforeHolds && !afterSameRider) {
    await releaseRiderJob(db, before.riderId);
  }
  if (after && after.riderId && (!before || !before.riderId) && after.dispatchCounted !== true) {
    await ensureAssigned(db, orderId);
  }
  if (after && after.riderId) {
    const foodFlip = after.foodReady === true && (!before || before.foodReady !== true);
    const statusFlip = after.status === 'ready' && (!before || before.status !== 'ready');
    if (foodFlip || statusFlip) {
      await notifyRider(db, after.riderId, {
        title: 'อาหารพร้อมแล้ว',
        body: (after.merchantName || 'ร้าน') + (after.code ? ' • ' + after.code : ''),
        data: { type: 'food_ready', orderId: orderId }
      });
    }
  }
  if (after && !String(after.code || '').trim() && TERMINAL.indexOf(after.status) === -1) {
    const stamped = await ensureOrderCode(db, orderId);
    if (stamped) after = Object.assign({}, after, { code: stamped });
  }
  if (!after || after.riderId) return;
  if (after.dispatchState === 'manual' || after.dispatchState === 'assigned') return;
  if (after.dispatchState === 'offered') {
    const exp = tsMillis(after.dispatchOfferExpiresAt);
    if (after.dispatchOfferRiderId && exp > Date.now()) return;
  }
  const ready = needsDispatch(Object.assign({}, after, {
    dispatchState: after.dispatchState === 'offered' ? 'seeking' : after.dispatchState
  }));
  if (!ready) {
    await noteWaitingForShop(db, orderId, after);
    return;
  }
  await offerNext(db, orderId);
}

async function onGpsWritten(db, before, after, riderId) {
  const riderRef = db.collection('riders').doc(riderId);
  if (!after || after.online !== true) {
    if (before && before.online === true) {
      await riderRef.set({ idleSince: null }, { merge: true });
    }
    return;
  }
  const becameOnline = !before || before.online !== true;
  if (!becameOnline) return;
  const snap = await riderRef.get();
  const jobs = snap.exists ? Number((snap.data() || {}).activeJobCount || 0) : 0;
  if (jobs <= 0) {
    await riderRef.set({
      idleSince: FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

async function sweepExpired(db) {
  const now = Timestamp.now();
  const snap = await db.collectionGroup('dispatchOffers')
    .where('status', '==', 'pending')
    .where('expiresAt', '<', now)
    .limit(30)
    .get();
  const results = [];
  for (const doc of snap.docs) {
    const parent = doc.ref.parent && doc.ref.parent.parent;
    const orderId = parent ? parent.id : (doc.data() || {}).orderId;
    if (!orderId) continue;
    results.push(await expireOffer(db, orderId, doc.id, 'expired'));
  }
  return { checked: snap.size, results: results };
}

function offerStillLive(order, nowMs) {
  if (!order || order.dispatchState !== 'offered') return false;
  const exp = tsMillis(order.dispatchOfferExpiresAt);
  return !!(order.dispatchOfferRiderId && exp > nowMs);
}

function canRetryManual(order) {
  const reason = order && order.dispatchManualReason;
  return typeof reason === 'string' && reason.indexOf('ไม่มีไรเดอร์ว่าง') === 0;
}

async function sweepStuck(db) {
  await reconcileBusyRiders(db);
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto') return { checked: 0, nudged: 0, mode: cfg.mode };
  const snap = await db.collection('orders')
    .where('status', 'in', OPEN_STATUSES)
    .limit(40)
    .get();
  let nudged = 0;
  const nowMs = Date.now();
  for (const doc of snap.docs) {
    const order = doc.data() || {};
    if (order.riderId) continue;
    if (order.dispatchState === 'assigned') continue;
    if (offerStillLive(order, nowMs)) continue;
    if (!String(order.code || '').trim() && TERMINAL.indexOf(order.status) === -1) {
      await ensureOrderCode(db, doc.id);
    }
    if (order.dispatchState === 'manual' && !canRetryManual(order)) continue;
    if (order.dispatchState === 'manual') {
      await doc.ref.update({
        dispatchState: 'seeking',
        dispatchRadiusStep: 0,
        dispatchManualReason: FieldValue.delete(),
        dispatchUpdatedAt: FieldValue.serverTimestamp()
      });
      order.dispatchState = 'seeking';
      order.dispatchManualReason = '';
    }
    if (needsDispatch(order)) {
      await offerNext(db, doc.id);
      nudged += 1;
      continue;
    }
    const noted = await noteWaitingForShop(db, doc.id, order);
    if (noted && noted.ok) nudged += 1;
  }
  return { checked: snap.size, nudged: nudged };
}

module.exports = {
  DEFAULT_CONFIG,
  ACTIVE_STATUSES,
  REASON_NO_PICKUP,
  REASON_WAIT_SHOP,
  normalizeConfig,
  exhaustedReason,
  needsKitchen,
  needsDispatch,
  pickupOf,
  acceptanceRate,
  scoreCandidate,
  rankCandidates,
  walkRadius,
  loadConfig,
  callerIsAdmin,
  notifyRider,
  findCandidates,
  offerNext,
  expireOffer,
  acceptOffer,
  manualAssign,
  releaseRiderJob,
  reconcileRiderJobs,
  reconcileBusyRiders,
  ensureAssigned,
  onOrderWritten,
  onGpsWritten,
  sweepExpired,
  sweepStuck,
  tsMillis
};
