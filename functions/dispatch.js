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
  reofferCooldownSec: 180,
  unassignedTimeoutMin: 60,
  staleAssignTimeoutMin: 60,
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
const REASON_UNASSIGNED = 'ไม่มีไรเดอร์รับภายใน 1 ชม.';
const REASON_STALE_JOB = 'ไม่จบงานภายใน 1 ชม.';
const TIMEOUT_STATUSES = OPEN_STATUSES.concat(ACTIVE_STATUSES);

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
    reofferCooldownSec: clamp(Math.round(Number(d.reofferCooldownSec) || 180), 30, 3600),
    unassignedTimeoutMin: clamp(Math.round(Number(d.unassignedTimeoutMin) || 60), 5, 1440),
    staleAssignTimeoutMin: clamp(Math.round(Number(d.staleAssignTimeoutMin) || 60), 5, 1440),
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
  if ((s.cooldown || 0) > 0) return base + ' — รอเสนอซ้ำหลังคูลดาวน์';
  if ((s.offline || 0) > 0) return base + ' — ไรเดอร์ปิดพิกัด';
  if ((s.noPoint || 0) > 0) return base + ' — ไรเดอร์ไม่มีพิกัด';
  if ((s.far || 0) > 0) return base + ' — ไรเดอร์อยู่นอกระยะ';
  return base;
}

function skipNote(notes, riderId, name, reason) {
  if (!Array.isArray(notes) || notes.length >= 12) return;
  notes.push({
    riderId: String(riderId || ''),
    name: String(name || ''),
    reason: String(reason || '')
  });
}

function ageText(ms) {
  const sec = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (sec < 90) return sec + ' วินาที';
  return Math.round(sec / 60) + ' นาที';
}

function timeoutReason(minutes, base) {
  const min = Math.round(Number(minutes) || 60);
  if (min === 60) return base;
  return base.replace('1 ชม.', min + ' นาที');
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

function canBroadcast(order) {
  if (!order || order.riderId) return false;
  if (TERMINAL.indexOf(order.status) !== -1) return false;
  if (order.dispatchState === 'assigned' || order.dispatchState === 'auto_cleared' || order.dispatchState === 'expired_unassigned') {
    return false;
  }
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

async function considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips, notes, cooldownLeft) {
  if (!doc || seen.has(doc.id)) return;
  seen.add(doc.id);
  const g = doc.data() || {};
  const gpsName = g.name || '';
  if (skip.has(doc.id)) {
    skips.cooldown += 1;
    const left = cooldownLeft && cooldownLeft.get(doc.id);
    skipNote(notes, doc.id, gpsName, left
      ? 'เพิ่งถูกเสนอไปแล้ว รออีก ' + left + ' วินาที'
      : 'เพิ่งถูกเสนอไปแล้ว รอคูลดาวน์');
    return;
  }
  if (g.online !== true) {
    skips.offline += 1;
    skipNote(notes, doc.id, gpsName, 'ปิดสถานะพิกัด');
    return;
  }
  const lat = finiteOrNull(g.lat);
  const lng = finiteOrNull(g.lng);
  if (lat == null || lng == null) {
    skips.noPoint += 1;
    skipNote(notes, doc.id, gpsName, 'ไม่มี lat/lng');
    return;
  }
  const updated = tsMillis(g.updatedAt);
  const staleMs = cfg.staleLocationSec * 1000;
  if (!updated || nowMs - updated > staleMs) {
    skips.stale += 1;
    skipNote(notes, doc.id, gpsName, updated
      ? 'พิกัดเก่า ' + ageText(nowMs - updated) + ' (เกณฑ์ ' + cfg.staleLocationSec + ' วินาที)'
      : 'ไม่มีเวลาพิกัด');
    return;
  }
  const dist = distanceBetween([pickup.lat, pickup.lng], [lat, lng]);
  if (dist > radiusKm + 0.001) {
    skips.far += 1;
    skipNote(notes, doc.id, gpsName, 'อยู่นอกระยะ ' + dist.toFixed(1) + ' กม. (วง ' + radiusKm + ' กม.)');
    return;
  }
  const riderSnap = await db.collection('riders').doc(doc.id).get();
  if (!riderSnap.exists) {
    skips.badStatus += 1;
    skipNote(notes, doc.id, gpsName, 'ไม่มีโปรไฟล์ไรเดอร์');
    return;
  }
  const r = riderSnap.data() || {};
  const riderName = r.name || gpsName;
  if (r.verified !== true) {
    skips.unverified += 1;
    skipNote(notes, doc.id, riderName, 'ยังไม่ได้รับอนุมัติ');
    return;
  }
  if (r.status !== 'active' && r.status !== 'available' && r.status !== 'online') {
    skips.badStatus += 1;
    skipNote(notes, doc.id, riderName, 'สถานะไม่พร้อมรับงาน (' + (r.status || 'ว่าง') + ')');
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
    skipNote(notes, doc.id, riderName, 'มีงาน ' + jobs + '/' + cfg.maxJobsPerRider);
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

async function ridersOnCooldown(db, orderId, order, nowMs, cooldownMs) {
  const left = new Map();
  if (!cooldownMs || cooldownMs <= 0) return left;
  const at = (order && order.dispatchOfferedAt) || {};
  Object.keys(at).forEach((id) => {
    const t = tsMillis(at[id]);
    if (!id || !t || nowMs - t >= cooldownMs) return;
    left.set(id, Math.max(1, Math.ceil((cooldownMs - (nowMs - t)) / 1000)));
  });
  const snap = await db.collection('orders').doc(orderId).collection('dispatchOffers')
    .orderBy('createdAt', 'desc')
    .limit(40)
    .get();
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const id = data.riderId;
    if (!id || left.has(id)) return;
    const t = tsMillis(data.createdAt) || tsMillis(data.respondedAt);
    if (!t || nowMs - t >= cooldownMs) return;
    left.set(id, Math.max(1, Math.ceil((cooldownMs - (nowMs - t)) / 1000)));
  });
  return left;
}

async function findCandidates(db, pickup, radiusKm, offeredIds, cfg, nowMs, extraSkip, cooldownLeft) {
  const bounds = geohashQueryBounds([pickup.lat, pickup.lng], radiusKm * 1000);
  const skip = new Set(offeredIds || []);
  (extraSkip || []).forEach((id) => skip.add(id));
  const seen = new Set();
  const out = [];
  const notes = [];
  const skips = { offline: 0, stale: 0, far: 0, busy: 0, unverified: 0, badStatus: 0, cooldown: 0, noPoint: 0 };
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
      await considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips, notes, cooldownLeft);
    }
  }
  // Admin's manual list does not use geohash. A fresh online rider with a
  // missing geohash would show there and never be offered. Scan online docs too.
  const onlineSnap = await db.collection('gps_riders').where('online', '==', true).limit(80).get();
  for (const doc of onlineSnap.docs) {
    await considerGpsDoc(db, doc, pickup, radiusKm, skip, cfg, nowMs, seen, out, skips, notes, cooldownLeft);
  }
  return { list: out, skips: skips, notes: notes };
}

function riderIsReady(status) {
  return status === 'active' || status === 'available' || status === 'online';
}

async function jobCountForOffer(db, riderId, stored) {
  let jobs = Number(stored || 0);
  if (jobs > 0) return reconcileRiderJobs(db, riderId);
  const live = await countActiveJobs(db, riderId);
  if (live > 0) {
    await raiseRiderJobCount(db, riderId, live);
    return live;
  }
  return 0;
}

async function eligibleRiders(db) {
  const riderSnap = await db.collection('riders').where('verified', '==', true).limit(100).get();
  const gpsSnap = await db.collection('gps_riders').limit(100).get();
  const gps = {};
  gpsSnap.docs.forEach((doc) => { gps[doc.id] = doc.data() || {}; });
  const out = [];
  for (const doc of riderSnap.docs) {
    const r = doc.data() || {};
    if (!riderIsReady(r.status)) continue;
    const g = gps[doc.id];
    if (g && g.online !== true) continue;
    const jobs = await jobCountForOffer(db, doc.id, r.activeJobCount);
    if (jobs > 0) continue;
    out.push({
      riderId: doc.id,
      riderName: r.name || (g && g.name) || '',
      riderPhone: r.phone || '',
      lat: g ? finiteOrNull(g.lat) : null,
      lng: g ? finiteOrNull(g.lng) : null
    });
  }
  return out;
}

function offerBody(orderId, order, rider, pickup, nowMs, holdMs) {
  let distanceKm = null;
  if (pickup && rider.lat != null && rider.lng != null) {
    distanceKm = Math.round(distanceBetween([pickup.lat, pickup.lng], [rider.lat, rider.lng]) * 1000) / 1000;
  }
  const body = {
    orderId: orderId,
    riderId: rider.riderId,
    riderName: rider.riderName,
    status: 'pending',
    broadcast: true,
    title: order.title || '',
    merchantName: order.merchantName || '',
    pickupName: order.shopPlaceName || order.fromName || order.address || order.title || '',
    fare: Number(order.fare || order.total || 0),
    orderCode: order.code || order.orderCode || '',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(nowMs + holdMs),
    timeoutSec: 0,
    respondedAt: null
  };
  if (distanceKm != null) body.distanceKm = distanceKm;
  return body;
}

async function broadcastOrder(db, orderId, cfg) {
  const nowMs = Date.now();
  const ref = db.collection('orders').doc(orderId);
  const pre = await ref.get();
  if (!pre.exists) return { skipped: 'missing', riderIds: [] };
  const preData = pre.data() || {};
  if (preData.riderId) return { skipped: 'assigned', riderIds: [] };
  if (!canBroadcast(preData)) return { skipped: 'not-ready', riderIds: [] };

  const pickup = pickupOf(preData);
  const riders = await eligibleRiders(db);
  const existing = await ref.collection('dispatchOffers').limit(100).get();
  const held = {};
  existing.docs.forEach((doc) => {
    const data = doc.data() || {};
    const id = data.riderId || doc.id;
    if (!held[id] || data.status === 'pending' || data.status === 'skipped' || data.status === 'accepted') {
      held[id] = data.status || 'pending';
    }
  });
  const fresh = riders.filter((r) => {
    const status = held[r.riderId];
    return status !== 'pending' && status !== 'skipped' && status !== 'accepted';
  });
  const holdMs = Math.max(5, cfg.unassignedTimeoutMin || 60) * 60 * 1000;
  if (!fresh.length) {
    const pending = existing.docs.some((doc) => (doc.data() || {}).status === 'pending');
    if (pending) {
      if (preData.dispatchState !== 'offered') {
        await ref.update(Object.assign({
          dispatchMode: 'auto',
          dispatchState: 'offered',
          dispatchOfferRiderId: FieldValue.delete(),
          dispatchManualReason: FieldValue.delete(),
          dispatchUpdatedAt: FieldValue.serverTimestamp()
        }, codePatch(preData)));
      }
      return { skipped: 'live', riderIds: [] };
    }
    if (preData.dispatchState === 'seeking' && preData.dispatchManualReason === 'ยังไม่มีไรเดอร์ออนไลน์ที่ว่าง') {
      return { skipped: 'none', riderIds: [] };
    }
    await ref.update(Object.assign({
      dispatchMode: 'auto',
      dispatchState: 'seeking',
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchManualReason: 'ยังไม่มีไรเดอร์ออนไลน์ที่ว่าง',
      dispatchUpdatedAt: FieldValue.serverTimestamp()
    }, codePatch(preData)));
    return { skipped: 'none', riderIds: [] };
  }

  const patch = codePatch(preData);
  const orderForOffer = patch.code ? Object.assign({}, preData, { code: patch.code }) : preData;
  const batch = db.batch();
  const riderIds = [];
  fresh.forEach((rider) => {
    riderIds.push(rider.riderId);
    batch.set(
      ref.collection('dispatchOffers').doc(rider.riderId),
      offerBody(orderId, orderForOffer, rider, pickup, nowMs, holdMs)
    );
  });
  batch.update(ref, Object.assign({
    dispatchMode: 'auto',
    dispatchState: 'offered',
    dispatchOfferId: FieldValue.delete(),
    dispatchOfferRiderId: FieldValue.delete(),
    dispatchOfferExpiresAt: FieldValue.delete(),
    dispatchOfferedIds: FieldValue.arrayUnion.apply(FieldValue, riderIds),
    dispatchManualReason: FieldValue.delete(),
    dispatchUpdatedAt: FieldValue.serverTimestamp()
  }, patch));
  await batch.commit();
  const label = preData.code || preData.title || preData.merchantName || 'ออเดอร์';
  await Promise.all(riderIds.map((id) => notifyRider(db, id, {
    title: 'มีงานใหม่',
    body: label + ' • คนแรกที่กดรับได้งานนี้',
    data: { type: 'dispatch_offer', orderId: orderId, offerId: id }
  })));
  return { ok: true, riderIds: riderIds, offerIds: riderIds.slice(), riderId: riderIds[0], offerId: riderIds[0], count: riderIds.length };
}

async function offerNext(db, orderId) {
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto') return { skipped: 'manual', riderIds: [] };
  return broadcastOrder(db, orderId, cfg);
}

async function offerOpenOrdersToRider(db, riderId) {
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto' || !riderId) return;
  const riderSnap = await db.collection('riders').doc(riderId).get();
  if (!riderSnap.exists) return;
  const rider = riderSnap.data() || {};
  if (rider.verified !== true || !riderIsReady(rider.status)) return;
  const jobs = await jobCountForOffer(db, riderId, rider.activeJobCount);
  if (jobs > 0) return;
  const snap = await db.collection('orders').where('status', 'in', OPEN_STATUSES).limit(40).get();
  for (const doc of snap.docs) {
    if (!canBroadcast(doc.data() || {})) continue;
    await broadcastOrder(db, doc.id, cfg);
  }
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
      // Server clock only. A phone that is ahead must not expire a live offer.
      const exp = tsMillis(offer.expiresAt);
      if (exp && exp > Date.now() + 1500) return { acted: false, early: true };
    }
    const riderRef = db.collection('riders').doc(offer.riderId);
    const riderSnap = offer.riderId ? await tx.get(riderRef) : null;
    tx.update(offerRef, {
      status: status,
      endReason: status === 'skipped' ? 'skipped' : 'timeout',
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
    if (order.dispatchOfferId && order.dispatchOfferId !== offerId && offer.broadcast !== true) {
      throw new Error('stale');
    }
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
      endReason: 'accepted',
      respondedAt: FieldValue.serverTimestamp()
    });
    tx.update(riderRef, {
      offersAccepted: FieldValue.increment(1),
      offersTotal: FieldValue.increment(1),
      activeJobCount: FieldValue.increment(1),
      idleSince: null
    });
  });
  await closeOtherOffers(db, orderRef, offerId);
  return { ok: true };
}

async function closeOtherOffers(db, orderRef, winnerOfferId) {
  const snap = await orderRef.collection('dispatchOffers').where('status', '==', 'pending').limit(40).get();
  if (snap.empty) return;
  const batch = db.batch();
  let n = 0;
  snap.docs.forEach((doc) => {
    if (doc.id === winnerOfferId) return;
    batch.update(doc.ref, {
      status: 'expired',
      endReason: 'taken',
      respondedAt: FieldValue.serverTimestamp()
    });
    n += 1;
  });
  if (n) await batch.commit();
}

async function manualAssign(db, adminUid, orderId, riderId) {
  const orderRef = db.collection('orders').doc(orderId);
  const riderRef = db.collection('riders').doc(riderId);
  const offerRef = orderRef.collection('dispatchOffers').doc();
  const pendingSnap = await orderRef.collection('dispatchOffers').where('status', '==', 'pending').limit(40).get();
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const riderSnap = await tx.get(riderRef);
    if (!orderSnap.exists) throw new Error('missing-order');
    if (!riderSnap.exists) throw new Error('missing-rider');
    const order = orderSnap.data() || {};
    const rider = riderSnap.data() || {};
    if (order.riderId) throw new Error('taken');
    if (TERMINAL.indexOf(order.status) !== -1) throw new Error('closed');
    const pendingReads = [];
    for (let i = 0; i < pendingSnap.docs.length; i++) pendingReads.push(tx.get(pendingSnap.docs[i].ref));
    let prevSnap = null;
    let prevRef = null;
    if (order.dispatchOfferId) {
      prevRef = orderRef.collection('dispatchOffers').doc(order.dispatchOfferId);
      prevSnap = await tx.get(prevRef);
    }
    const pendingDocs = await Promise.all(pendingReads);
    pendingDocs.forEach((offerSnap) => {
      if (!offerSnap.exists || offerSnap.data().status !== 'pending') return;
      tx.update(offerSnap.ref, {
        status: 'expired',
        endReason: 'manual',
        respondedAt: FieldValue.serverTimestamp()
      });
    });
    if (prevSnap && prevSnap.exists && prevSnap.data().status === 'pending'
      && !pendingDocs.some((d) => d.ref.path === prevSnap.ref.path)) {
      tx.update(prevRef, {
        status: 'expired',
        endReason: 'manual',
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
      endReason: 'accepted',
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
  const pre = await orderRef.get();
  if (!pre.exists) return;
  const preOrder = pre.data() || {};
  if (!preOrder.riderId || preOrder.dispatchCounted === true) return;
  const pendingSnap = await orderRef.collection('dispatchOffers').where('status', '==', 'pending').limit(40).get();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const order = snap.data() || {};
    if (!order.riderId || order.dispatchCounted === true) return;
    const riderRef = db.collection('riders').doc(order.riderId);
    const refs = [];
    const seen = {};
    function addRef(ref) {
      if (!ref || seen[ref.path]) return;
      seen[ref.path] = true;
      refs.push(ref);
    }
    pendingSnap.docs.forEach((doc) => addRef(doc.ref));
    addRef(orderRef.collection('dispatchOffers').doc(order.riderId));
    if (order.dispatchOfferId) addRef(orderRef.collection('dispatchOffers').doc(order.dispatchOfferId));
    const reads = [tx.get(riderRef)];
    for (let i = 0; i < refs.length; i++) reads.push(tx.get(refs[i]));
    const got = await Promise.all(reads);
    const riderSnap = got[0];
    const offerSnaps = got.slice(1);
    const patch = {
      activeJobCount: FieldValue.increment(1),
      idleSince: null
    };
    let countedWin = false;
    offerSnaps.forEach((offerSnap) => {
      if (!offerSnap.exists || offerSnap.data().status !== 'pending') return;
      const mine = offerSnap.id === order.riderId || offerSnap.data().riderId === order.riderId;
      if (mine && !countedWin) {
        tx.update(offerSnap.ref, {
          status: 'accepted',
          endReason: 'accepted',
          respondedAt: FieldValue.serverTimestamp()
        });
        patch.offersAccepted = FieldValue.increment(1);
        patch.offersTotal = FieldValue.increment(1);
        countedWin = true;
        return;
      }
      tx.update(offerSnap.ref, {
        status: 'expired',
        endReason: 'taken',
        respondedAt: FieldValue.serverTimestamp()
      });
    });
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
  if (after.dispatchState === 'assigned' || after.dispatchState === 'auto_cleared' || after.dispatchState === 'expired_unassigned') return;
  if (!canBroadcast(after)) {
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
  await offerOpenOrdersToRider(db, riderId);
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
  return !!(order && order.dispatchState === 'manual');
}

function createdMs(order) {
  return tsMillis(order && order.createdAt) || tsMillis(order && order.codeCreatedAt) || 0;
}

async function writeRiderNotice(db, riderId, text) {
  if (!riderId || !text) return;
  try {
    await db.collection('riders').doc(riderId).set({
      lastNotice: { text: text, at: FieldValue.serverTimestamp() }
    }, { merge: true });
  } catch (err) {
    /* The order update is the record. A missing rider profile must not abort the sweep. */
  }
  await notifyRider(db, riderId, {
    title: 'แจ้งจากระบบจ่ายงาน',
    body: text,
    data: { type: 'dispatch_notice' }
  });
}

async function cancelUnassigned(db, ref, reason) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const order = snap.data() || {};
    if (order.riderId) return false;
    if (TERMINAL.indexOf(order.status) !== -1) return false;
    if (OPEN_STATUSES.indexOf(order.status) === -1) return false;
    let offerRef = null;
    let offerSnap = null;
    if (order.dispatchOfferId) {
      offerRef = ref.collection('dispatchOffers').doc(order.dispatchOfferId);
      offerSnap = await tx.get(offerRef);
    }
    if (offerSnap && offerSnap.exists && offerSnap.data().status === 'pending') {
      tx.update(offerRef, {
        status: 'expired',
        endReason: 'unassigned_timeout',
        respondedAt: FieldValue.serverTimestamp()
      });
    }
    tx.update(ref, {
      status: 'cancelled',
      cancelReason: reason,
      cancelledBy: 'system',
      cancelledAt: FieldValue.serverTimestamp(),
      dispatchState: 'expired_unassigned',
      dispatchManualReason: reason,
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchOfferExpiresAt: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp(),
      adminFlag: 'expired_unassigned',
      adminFlagReason: reason,
      adminFlagAt: FieldValue.serverTimestamp(),
      customerNotice: reason
    });
    return true;
  });
}

async function cancelStaleJob(db, ref, reason) {
  const pending = await ref.collection('dispatchOffers').where('status', '==', 'pending').limit(20).get();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return '';
    const order = snap.data() || {};
    if (!order.riderId || ACTIVE_STATUSES.indexOf(order.status) === -1) return '';
    const offerSnaps = [];
    for (let i = 0; i < pending.docs.length; i++) {
      offerSnaps.push(await tx.get(pending.docs[i].ref));
    }
    offerSnaps.forEach((offerSnap) => {
      if (!offerSnap.exists || offerSnap.data().status !== 'pending') return;
      tx.update(offerSnap.ref, {
        status: 'expired',
        endReason: 'stale_job',
        respondedAt: FieldValue.serverTimestamp()
      });
    });
    tx.update(ref, {
      status: 'cancelled',
      cancelReason: reason,
      cancelledBy: 'system',
      cancelledAt: FieldValue.serverTimestamp(),
      dispatchState: 'auto_cleared',
      dispatchManualReason: reason,
      dispatchOfferRiderId: FieldValue.delete(),
      dispatchOfferExpiresAt: FieldValue.delete(),
      dispatchUpdatedAt: FieldValue.serverTimestamp(),
      adminFlag: 'auto_cleared',
      adminFlagReason: reason + (order.code ? ' • ' + order.code : '') + (order.riderName ? ' • ' + order.riderName : ''),
      adminFlagAt: FieldValue.serverTimestamp(),
      customerNotice: reason,
      autoClearedRiderId: order.riderId,
      autoClearedRiderName: order.riderName || ''
    });
    return order.riderId;
  });
}

async function sweepTimeouts(db) {
  const cfg = await loadConfig(db);
  if (cfg.mode !== 'auto') return { cancelled: 0, cleared: 0, mode: cfg.mode };
  const nowMs = Date.now();
  const unassignedMs = cfg.unassignedTimeoutMin * 60 * 1000;
  const staleMs = cfg.staleAssignTimeoutMin * 60 * 1000;
  const unassignedReason = timeoutReason(cfg.unassignedTimeoutMin, REASON_UNASSIGNED);
  const staleReason = timeoutReason(cfg.staleAssignTimeoutMin, REASON_STALE_JOB);
  const snap = await db.collection('orders').where('status', 'in', TIMEOUT_STATUSES).limit(200).get();
  let cancelled = 0;
  let cleared = 0;
  for (const doc of snap.docs) {
    const order = doc.data() || {};
    if (!order.riderId && OPEN_STATUSES.indexOf(order.status) !== -1) {
      const born = createdMs(order);
      if (!born || nowMs - born < unassignedMs) continue;
      if (await cancelUnassigned(db, doc.ref, unassignedReason)) cancelled += 1;
      continue;
    }
    if (!order.riderId || ACTIVE_STATUSES.indexOf(order.status) === -1) continue;
    const since = tsMillis(order.acceptedAt);
    if (!since || nowMs - since < staleMs) continue;
    const riderId = await cancelStaleJob(db, doc.ref, staleReason);
    if (!riderId) continue;
    cleared += 1;
    const code = order.code ? order.code + ' • ' : '';
    await writeRiderNotice(db, riderId, code + staleReason);
  }
  return { cancelled: cancelled, cleared: cleared };
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
  REASON_UNASSIGNED,
  REASON_STALE_JOB,
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
  sweepTimeouts,
  tsMillis
};
