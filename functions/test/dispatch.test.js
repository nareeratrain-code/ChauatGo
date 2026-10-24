'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { geohashForLocation, distanceBetween } = require('geofire-common');
const localGeo = require('../../geohash');
const D = require('../dispatch');

const FORBIDDEN = 'เหล่าเต๊ง';

test('browser geohash matches geofire-common', () => {
  const points = [
    [7.96, 99.99],
    [8.02, 100.15],
    [13.7563, 100.5018],
    [0, 0],
    [-33.8688, 151.2093],
    [7.9654603, 99.9943536]
  ];
  points.forEach(([lat, lng]) => {
    assert.equal(localGeo.geohashForLocation(lat, lng, 10), geohashForLocation([lat, lng], 10));
  });
});

test('food still waiting on the shop is not dispatched', () => {
  assert.equal(D.needsDispatch({ type: 'food', status: 'searching', merchantName: 'ร้านทดสอบ' }), false);
  assert.equal(D.needsDispatch({ type: 'food', status: 'cooking', merchantName: 'ร้านทดสอบ' }), true);
  assert.equal(D.needsDispatch({ type: 'food', status: 'cooking', riderId: 'r1' }), false);
  assert.equal(D.needsDispatch({ type: 'food', status: 'cooking', dispatchState: 'manual' }), false);
  assert.equal(D.needsDispatch({ type: 'ride', status: 'searching' }), true);
  assert.equal(D.needsDispatch({ type: 'shopping', status: 'searching' }), true);
  assert.equal(D.needsDispatch({ type: 'express', status: 'pending' }), true);
  assert.equal(D.needsDispatch({ type: 'food', status: 'cancelled' }), false);
});

test('pickup prefers the shop point', () => {
  const p = D.pickupOf({ shopPlaceLat: 8.02, shopPlaceLng: 100.15, fromLat: 1, fromLng: 2 });
  assert.deepEqual(p, { lat: 8.02, lng: 100.15 });
  assert.equal(D.pickupOf({ title: 'ไม่มีจุด' }), null);
  assert.equal(D.pickupOf({ shopPlaceLat: null, shopPlaceLng: null }), null);
  assert.equal(D.pickupOf({ shopPlaceLat: 0, shopPlaceLng: 0 }), null);
  const fallback = D.pickupOf({ fromLat: '8.1', fromLng: '100.2' });
  assert.equal(fallback.lat, 8.1);
});

test('score prefers a closer rider, then a longer idle rider', () => {
  const weights = { distance: 1, idle: 1, acceptance: 1, rating: 1 };
  const closer = { distanceKm: 0.2, idleMs: 0, offersTotal: 0, offersAccepted: 0, rating: 5 };
  const farther = { distanceKm: 2.5, idleMs: 0, offersTotal: 0, offersAccepted: 0, rating: 5 };
  assert.ok(D.scoreCandidate(closer, weights, 3) > D.scoreCandidate(farther, weights, 3));

  const fresh = { distanceKm: 0.4, idleMs: 0, offersTotal: 4, offersAccepted: 4, rating: 5 };
  const waiting = { distanceKm: 0.4, idleMs: 2 * 60 * 60 * 1000, offersTotal: 4, offersAccepted: 4, rating: 5 };
  const ranked = D.rankCandidates([fresh, waiting], weights, 3);
  assert.equal(ranked[0], waiting);

  assert.equal(D.acceptanceRate(0, 0), 1);
  assert.equal(D.acceptanceRate(1, 4), 0.25);
  const lowAccept = { distanceKm: 0.4, idleMs: 0, offersTotal: 10, offersAccepted: 1, rating: 5 };
  const highAccept = { distanceKm: 0.4, idleMs: 0, offersTotal: 10, offersAccepted: 9, rating: 5 };
  assert.ok(D.scoreCandidate(highAccept, weights, 3) > D.scoreCandidate(lowAccept, weights, 3));
});

test('radius walk expands then gives up', () => {
  const steps = [3, 5, 8];
  const none = D.walkRadius(steps, 0, () => false);
  assert.equal(none.exhausted, true);
  assert.equal(none.step, 3);
  const atFive = D.walkRadius(steps, 0, (km) => km >= 5);
  assert.equal(atFive.radiusKm, 5);
  assert.equal(atFive.step, 1);
});

test('missing config stays on the manual list', () => {
  const cfg = D.normalizeConfig(null);
  assert.equal(cfg.mode, 'manual');
  assert.deepEqual(cfg.radiusStepsKm, [3, 5, 8]);
  assert.equal(cfg.offerTimeoutSec, 20);
  assert.equal(cfg.maxJobsPerRider, 1);
  const custom = D.normalizeConfig({ mode: 'auto', radiusStepsKm: [2, 4], offerTimeoutSec: 15, maxJobsPerRider: 2 });
  assert.equal(custom.mode, 'auto');
  assert.deepEqual(custom.radiusStepsKm, [2, 4]);
  assert.equal(D.normalizeConfig({ mode: 'อัตโนมัติ' }).mode, 'auto');
  assert.equal(D.normalizeConfig({ mode: 'AUTO' }).mode, 'auto');
  assert.equal(D.exhaustedReason(8, {}), 'ไม่มีไรเดอร์ว่างในระยะ 8 กม.');
  assert.equal(
    D.exhaustedReason(8, { unverified: 1 }),
    'ไม่มีไรเดอร์ว่างในระยะ 8 กม. — ไรเดอร์ในระยะยังไม่พร้อมรับงาน'
  );
  assert.equal(D.exhaustedReason(8, { cooldown: 1 }), 'ไม่มีไรเดอร์ว่างในระยะ 8 กม. — รอเสนอซ้ำหลังคูลดาวน์');
  assert.equal(D.exhaustedReason(8, { far: 2 }), 'ไม่มีไรเดอร์ว่างในระยะ 8 กม. — ไรเดอร์อยู่นอกระยะ');
  assert.equal(cfg.unassignedTimeoutMin, 60);
  assert.equal(cfg.staleAssignTimeoutMin, 60);
  assert.equal(cfg.reofferCooldownSec, 180);
  assert.equal(D.normalizeConfig({ unassignedTimeoutMin: 1, staleAssignTimeoutMin: 90, reofferCooldownSec: 10 }).unassignedTimeoutMin, 5);
  assert.equal(D.normalizeConfig({ staleAssignTimeoutMin: 90 }).staleAssignTimeoutMin, 90);
  assert.equal(D.normalizeConfig({ reofferCooldownSec: 10 }).reofferCooldownSec, 30);
  assert.equal(D.REASON_NO_PICKUP, 'ร้านไม่มีพิกัด');
  assert.equal(D.REASON_WAIT_SHOP, 'รอร้านรับออเดอร์');
});

function assertNoProtectedShop(value) {
  assert.equal(JSON.stringify(value).includes(FORBIDDEN), false);
}

test('dispatch against the emulator', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'chauat-go-b9841' });
  const db = getFirestore();
  const pickup = { lat: 8.02, lng: 100.15 };
  const shop = 'ร้านทดสอบ';

  function hash(lat, lng) {
    return geohashForLocation([lat, lng]);
  }

  async function seedRider(id, lat, lng, extra) {
    const body = Object.assign({
      name: id,
      phone: '0800000000',
      verified: true,
      status: 'active',
      activeJobCount: 0,
      offersAccepted: 0,
      offersTotal: 0,
      rating: 5,
      idleSince: Timestamp.fromDate(new Date())
    }, extra || {});
    assertNoProtectedShop(body);
    await db.collection('riders').doc(id).set(body);
    await db.collection('gps_riders').doc(id).set({
      riderId: id,
      name: id,
      lat: lat,
      lng: lng,
      geohash: hash(lat, lng),
      online: true,
      accuracy: 10,
      updatedAt: Timestamp.fromDate(new Date())
    });
  }

  async function seedOrder(id, extra) {
    const body = Object.assign({
      type: 'food',
      status: 'cooking',
      merchantName: shop,
      merchantId: 'shop-test',
      userId: 'customer-test',
      title: 'ข้าวทดสอบ',
      shopPlaceLat: pickup.lat,
      shopPlaceLng: pickup.lng,
      shopPlaceName: shop,
      fare: 40,
      paymentMode: 'transfer',
      code: 'OD-TEST'
    }, extra || {});
    assertNoProtectedShop(body);
    await db.collection('orders').doc(id).set(body);
    return body;
  }

  await db.doc('config/dispatch').delete().catch(() => {});
  await seedOrder('ord-manual-mode');
  const manual = await D.onOrderWritten(db, null, {
    type: 'food', status: 'cooking', merchantName: shop,
    shopPlaceLat: pickup.lat, shopPlaceLng: pickup.lng
  }, 'ord-manual-mode');
  assert.equal(manual, undefined);
  const manualDoc = await db.collection('orders').doc('ord-manual-mode').get();
  assert.equal(manualDoc.data().dispatchState || '', '');

  await seedOrder('ord-manual-wait', { status: 'searching', code: '' });
  await D.onOrderWritten(db, null, {
    type: 'food', status: 'searching', merchantName: shop, code: ''
  }, 'ord-manual-wait');
  const manualWait = await db.collection('orders').doc('ord-manual-wait').get();
  assert.equal(manualWait.data().dispatchState || '', '');
  assert.match(manualWait.data().code, /^OD-\d{4}$/);

  await db.doc('config/dispatch').set({
    mode: 'auto',
    radiusStepsKm: [3, 5, 8],
    offerTimeoutSec: 20,
    maxJobsPerRider: 1,
    staleLocationSec: 120,
    weights: { distance: 1, idle: 1, acceptance: 1, rating: 1 }
  });

  const idleSince = Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
  await seedRider('test-busy', pickup.lat, pickup.lng, { activeJobCount: 1, idleSince: null });
  await seedOrder('ord-busy-hold', {
    type: 'ride', status: 'accepted', riderId: 'test-busy', merchantId: '', code: 'OD-BUSY'
  });
  await seedRider('test-idle', 8.0227, 100.15, { idleSince: idleSince, rating: 4 });
  await seedRider('test-near', 8.021, 100.15, { idleSince: Timestamp.fromDate(new Date()), rating: 5 });
  await seedRider('test-far', 8.07, 100.15, { rating: 5 });
  await seedRider('test-stale', pickup.lat, pickup.lng, {});
  await db.collection('gps_riders').doc('test-stale').update({
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))
  });

  const nearKm = distanceBetween([pickup.lat, pickup.lng], [8.021, 100.15]);
  const idleKm = distanceBetween([pickup.lat, pickup.lng], [8.0227, 100.15]);
  const farKm = distanceBetween([pickup.lat, pickup.lng], [8.07, 100.15]);
  assert.ok(nearKm < 3 && idleKm < 3);
  assert.ok(farKm > 5 && farKm < 8);

  await seedOrder('ord-chain');
  const first = await D.offerNext(db, 'ord-chain');
  assert.ok(first.riderIds.indexOf('test-idle') !== -1);
  assert.ok(first.riderIds.indexOf('test-near') !== -1);
  assert.ok(first.riderIds.indexOf('test-far') !== -1);
  assert.ok(first.riderIds.indexOf('test-stale') !== -1);
  assert.ok(first.riderIds.indexOf('test-busy') === -1);
  const chain = await db.collection('orders').doc('ord-chain').get();
  assert.equal(chain.data().dispatchState, 'offered');
  assert.equal(chain.data().dispatchOfferRiderId || '', '');

  const again = await D.offerNext(db, 'ord-chain');
  assert.equal(again.skipped, 'live');
  const offers1 = await db.collection('orders').doc('ord-chain').collection('dispatchOffers').get();
  assert.equal(offers1.size, 4);
  offers1.docs.forEach((doc) => {
    assert.equal(doc.data().broadcast, true);
    assert.equal(doc.data().status, 'pending');
  });

  await D.expireOffer(db, 'ord-chain', 'test-idle', 'skipped');
  const skippedOffer = await db.collection('orders').doc('ord-chain').collection('dispatchOffers').doc('test-idle').get();
  assert.equal(skippedOffer.data().status, 'skipped');
  assert.equal(skippedOffer.data().endReason, 'skipped');
  const stillOpen = await db.collection('orders').doc('ord-chain').collection('dispatchOffers').doc('test-far').get();
  assert.equal(stillOpen.data().status, 'pending');
  const second = await db.collection('orders').doc('ord-chain').get();
  assert.equal(second.data().dispatchState, 'offered');
  assert.ok(second.data().dispatchOfferedIds.indexOf('test-idle') !== -1);
  assert.ok(second.data().dispatchOfferedIds.indexOf('test-busy') === -1);

  await seedOrder('ord-accept');
  const offer = await D.offerNext(db, 'ord-accept');
  assert.ok(offer.riderIds.indexOf('test-idle') !== -1);
  const raced = await Promise.allSettled([
    D.acceptOffer(db, 'test-idle', 'ord-accept', 'test-idle'),
    D.acceptOffer(db, 'test-idle', 'ord-accept', 'test-idle')
  ]);
  const won = raced.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1);
  const accepted = await db.collection('orders').doc('ord-accept').get();
  assert.equal(accepted.data().riderId, 'test-idle');
  assert.equal(accepted.data().status, 'accepted');
  assert.equal(accepted.data().dispatchState, 'assigned');
  const idleDoc = await db.collection('riders').doc('test-idle').get();
  assert.equal(idleDoc.data().activeJobCount, 1);
  assert.equal(idleDoc.data().offersAccepted, 1);
  const acceptedOffer = await db.collection('orders').doc('ord-accept').collection('dispatchOffers').doc('test-idle').get();
  assert.equal(acceptedOffer.data().status, 'accepted');
  assert.equal(acceptedOffer.data().endReason, 'accepted');
  const lostOffer = await db.collection('orders').doc('ord-accept').collection('dispatchOffers').doc('test-near').get();
  assert.equal(lostOffer.data().status, 'expired');
  assert.equal(lostOffer.data().endReason, 'taken');

  await db.collection('riders').doc('test-blank').set({
    name: 'test-blank',
    phone: '0800000001',
    verified: true,
    status: 'active',
    rating: 5
  });
  await db.collection('gps_riders').doc('test-blank').set({
    riderId: 'test-blank',
    name: 'test-blank',
    lat: pickup.lat,
    lng: pickup.lng,
    geohash: hash(pickup.lat, pickup.lng),
    online: true,
    updatedAt: Timestamp.fromDate(new Date())
  });
  const blankCfg = await D.loadConfig(db);
  const blankFound = await D.findCandidates(db, pickup, 3, [], blankCfg, Date.now(), []);
  const blank = blankFound.list.find((c) => c.riderId === 'test-blank');
  assert.ok(blank);
  assert.equal(blank.activeJobCount, 0);

  await seedOrder('ord-second');
  const blocked = await D.offerNext(db, 'ord-second');
  assert.ok(blocked.riderIds.indexOf('test-idle') === -1);
  assert.ok(blocked.riderIds.indexOf('test-busy') === -1);
  assert.ok(blocked.riderIds.indexOf('test-near') !== -1);

  await D.onOrderWritten(
    db,
    { riderId: 'test-idle', status: 'accepted', dispatchCounted: true },
    { riderId: 'test-idle', status: 'done', dispatchCounted: true, merchantName: shop },
    'ord-accept'
  );
  const freed = await db.collection('riders').doc('test-idle').get();
  assert.equal(freed.data().activeJobCount, 0);
  assert.ok(freed.data().idleSince);

  await seedOrder('ord-wait', { status: 'searching', code: '' });
  await D.onOrderWritten(db, { type: 'food', status: 'pending', merchantName: shop }, {
    type: 'food', status: 'searching', merchantName: shop, paymentMode: 'transfer',
    shopPlaceLat: pickup.lat, shopPlaceLng: pickup.lng
  }, 'ord-wait');
  const waiting = await db.collection('orders').doc('ord-wait').get();
  assert.equal(waiting.data().dispatchState, 'waiting');
  assert.equal(waiting.data().dispatchManualReason, 'รอร้านรับออเดอร์');
  assert.match(waiting.data().code, /^OD-\d{4}$/);
  const waitOffers = await db.collection('orders').doc('ord-wait').collection('dispatchOffers').get();
  assert.equal(waitOffers.size, 0);

  await seedOrder('ord-nopick');
  await db.collection('orders').doc('ord-nopick').update({
    shopPlaceLat: FieldValue.delete(),
    shopPlaceLng: FieldValue.delete(),
    fromLat: FieldValue.delete(),
    fromLng: FieldValue.delete()
  });
  const noPick = await D.offerNext(db, 'ord-nopick');
  assert.ok(noPick.riderIds.indexOf('test-near') !== -1);
  const noPickDoc = await db.collection('orders').doc('ord-nopick').get();
  assert.equal(noPickDoc.data().dispatchState, 'offered');
  assert.notEqual(noPickDoc.data().dispatchManualReason || '', 'ร้านไม่มีพิกัด');
  const noPickOffers = await db.collection('orders').doc('ord-nopick').collection('dispatchOffers').get();
  assert.ok(noPickOffers.size > 0);
  await seedRider('test-late', pickup.lat, pickup.lng, { name: 'มาทีหลัง' });
  await D.onGpsWritten(db, null, { online: true }, 'test-late');
  const lateOffer = await db.collection('orders').doc('ord-nopick').collection('dispatchOffers').doc('test-late').get();
  assert.equal(lateOffer.exists, true);
  assert.equal(lateOffer.data().status, 'pending');
  assert.equal(lateOffer.data().broadcast, true);

  await db.collection('admins').doc('admin-1').set({ role: 'active' });
  const isAdmin = await D.callerIsAdmin(db, { uid: 'admin-1', token: {} });
  assert.equal(isAdmin, true);
  const notAdmin = await D.callerIsAdmin(db, { uid: 'test-near', token: { email: 'rider@example.com' } });
  assert.equal(notAdmin, false);
  await seedOrder('ord-force');
  const forced = await D.manualAssign(db, 'admin-1', 'ord-force', 'test-busy');
  assert.equal(forced.ok, true);
  const forcedDoc = await db.collection('orders').doc('ord-force').get();
  assert.equal(forcedDoc.data().riderId, 'test-busy');
  assert.equal(forcedDoc.data().dispatchMode, 'manual-override');
  await assert.rejects(
    () => D.manualAssign(db, 'admin-1', 'ord-force', 'test-near'),
    (err) => err && err.message === 'taken'
  );

  await seedOrder('ord-null-rider', { riderId: null, code: '' });
  const nullAssign = await D.manualAssign(db, 'admin-1', 'ord-null-rider', 'test-near');
  assert.equal(nullAssign.ok, true);
  const nullDoc = await db.collection('orders').doc('ord-null-rider').get();
  assert.equal(nullDoc.data().riderId, 'test-near');
  assert.equal(nullDoc.data().status, 'accepted');
  assert.match(nullDoc.data().code, /^OD-\d{4}$/);

  await seedOrder('ord-stuck-ride', { type: 'ride', status: 'searching', merchantId: '', code: '' });
  await seedOrder('ord-stuck-cook', { status: 'cooking', code: 'OD-COOK' });
  await seedOrder('ord-stuck-food', { status: 'searching', code: '' });
  const swept = await D.sweepStuck(db);
  assert.ok(swept.nudged >= 2);
  const stuckRide = await db.collection('orders').doc('ord-stuck-ride').get();
  assert.equal(stuckRide.data().dispatchState, 'offered');
  assert.match(stuckRide.data().code, /^OD-\d{4}$/);
  const stuckCook = await db.collection('orders').doc('ord-stuck-cook').get();
  assert.equal(stuckCook.data().dispatchState, 'offered');
  const stuckFood = await db.collection('orders').doc('ord-stuck-food').get();
  assert.equal(stuckFood.data().dispatchState, 'waiting');
  assert.equal(stuckFood.data().dispatchManualReason, 'รอร้านรับออเดอร์');
  assert.match(stuckFood.data().code, /^OD-\d{4}$/);
  const stuckFoodOffers = await db.collection('orders').doc('ord-stuck-food').collection('dispatchOffers').get();
  assert.equal(stuckFoodOffers.size, 0);

  await seedRider('test-full', pickup.lat + 0.002, pickup.lng, { activeJobCount: 1 });
  await D.onOrderWritten(db, {
    riderId: 'test-full', status: 'accepted', dispatchCounted: true
  }, {
    riderId: 'test-full', status: 'searching', dispatchCounted: true, type: 'shopping'
  }, 'ord-rewind-count');
  const rewound = await db.collection('riders').doc('test-full').get();
  assert.equal(rewound.data().activeJobCount, 0);

  await db.collection('riders').doc('test-full').update({ activeJobCount: 4 });
  await seedOrder('ord-shop-stuck', {
    type: 'shopping',
    status: 'searching',
    merchantId: '',
    merchantName: '',
    shopPlaceName: '7-Eleven',
    code: 'OD-8548',
    paymentMode: 'cash',
    items: '- น้ำแข็ง 1',
    dispatchState: 'manual',
    dispatchManualReason: 'ไม่มีไรเดอร์ว่างในระยะ 8 กม. — ไรเดอร์ในระยะมีงานอยู่แล้ว'
  });
  const shopSweep = await D.sweepStuck(db);
  assert.ok(shopSweep.nudged >= 1);
  const freedFull = await db.collection('riders').doc('test-full').get();
  assert.equal(freedFull.data().activeJobCount, 0);
  const shopStuck = await db.collection('orders').doc('ord-shop-stuck').get();
  assert.equal(shopStuck.data().dispatchState, 'offered');
  assert.equal(shopStuck.data().dispatchOfferRiderId || '', '');
  const shopOffers = await db.collection('orders').doc('ord-shop-stuck').collection('dispatchOffers').get();
  assert.ok(shopOffers.size > 0);
  assert.ok(shopOffers.docs.every((doc) => doc.data().broadcast === true));

  // Transfer pickup ("รอลูกค้าโอนเงิน") is still an active job. A stored
  // count of 0 must not offer this rider a second order, and must not accept one.
  await seedRider('test-hold-pay', pickup.lat + 0.001, pickup.lng, { activeJobCount: 0, idleSince: null });
  await seedOrder('ord-await-transfer', {
    type: 'food',
    status: 'picked_up',
    riderId: 'test-hold-pay',
    paymentMode: 'transfer',
    code: 'OD-6355'
  });
  await seedOrder('ord-should-skip-holder', { status: 'cooking', code: 'OD-HOLD' });
  const held = await D.offerNext(db, 'ord-should-skip-holder');
  assert.notEqual(held.riderId, 'test-hold-pay');
  const raised = await db.collection('riders').doc('test-hold-pay').get();
  assert.equal(raised.data().activeJobCount, 1);
  await db.collection('riders').doc('test-hold-pay').update({ activeJobCount: 0 });
  const holdOffer = db.collection('orders').doc('ord-should-skip-holder').collection('dispatchOffers').doc('offer-hold');
  await holdOffer.set({
    riderId: 'test-hold-pay',
    status: 'pending',
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 60000))
  });
  await db.collection('orders').doc('ord-should-skip-holder').update({
    riderId: FieldValue.delete(),
    dispatchOfferId: 'offer-hold',
    dispatchOfferRiderId: 'test-hold-pay',
    dispatchState: 'offered'
  });
  await assert.rejects(
    () => D.acceptOffer(db, 'test-hold-pay', 'ord-should-skip-holder', 'offer-hold'),
    (err) => err && err.message === 'busy'
  );
  const holdOrder = await db.collection('orders').doc('ord-should-skip-holder').get();
  assert.notEqual(holdOrder.data().riderId || '', 'test-hold-pay');
  const holdCount = await db.collection('riders').doc('test-hold-pay').get();
  assert.equal(holdCount.data().activeJobCount, 1);

  const hourAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000));
  await seedOrder('ord-old-open', {
    type: 'express',
    status: 'searching',
    merchantId: '',
    merchantName: '',
    code: 'OD-7794',
    createdAt: hourAgo,
    dispatchState: 'manual',
    dispatchManualReason: 'ไม่มีไรเดอร์ว่างในระยะ 8 กม.',
    dispatchOfferedIds: ['test-near']
  });
  await seedOrder('ord-young-open', {
    type: 'ride',
    status: 'searching',
    merchantId: '',
    merchantName: '',
    code: 'OD-NEW',
    createdAt: Timestamp.fromDate(new Date()),
    dispatchState: 'manual',
    dispatchManualReason: 'ไม่มีไรเดอร์ว่างในระยะ 8 กม.'
  });
  await seedRider('test-slow', pickup.lat, pickup.lng, { activeJobCount: 1, name: 'สมหมาย' });
  await seedOrder('ord-stale-accept', {
    type: 'shopping',
    status: 'accepted',
    riderId: 'test-slow',
    riderName: 'สมหมาย',
    merchantId: '',
    merchantName: '',
    code: 'OD-SLOW',
    acceptedAt: hourAgo,
    dispatchState: 'assigned',
    dispatchCounted: true,
    dispatchOfferId: 'live-slow'
  });
  await db.collection('orders').doc('ord-stale-accept').collection('dispatchOffers').doc('live-slow').set({
    riderId: 'test-slow',
    status: 'pending',
    orderId: 'ord-stale-accept',
    createdAt: hourAgo
  });
  const timed = await D.sweepTimeouts(db);
  assert.ok(timed.cancelled >= 1);
  assert.ok(timed.cleared >= 1);
  const oldOpen = await db.collection('orders').doc('ord-old-open').get();
  assert.equal(oldOpen.exists, true);
  assert.equal(oldOpen.data().status, 'cancelled');
  assert.equal(oldOpen.data().cancelReason, 'ไม่มีไรเดอร์รับภายใน 1 ชม.');
  assert.equal(oldOpen.data().dispatchState, 'expired_unassigned');
  assert.equal(oldOpen.data().customerNotice, 'ไม่มีไรเดอร์รับภายใน 1 ชม.');
  const youngOpen = await db.collection('orders').doc('ord-young-open').get();
  assert.equal(youngOpen.data().status, 'searching');
  const staleAccept = await db.collection('orders').doc('ord-stale-accept').get();
  assert.equal(staleAccept.exists, true);
  assert.equal(staleAccept.data().riderId, 'test-slow');
  assert.equal(staleAccept.data().status, 'cancelled');
  assert.equal(staleAccept.data().cancelReason, 'ไม่จบงานภายใน 1 ชม.');
  assert.equal(staleAccept.data().dispatchState, 'auto_cleared');
  assert.equal(staleAccept.data().adminFlag, 'auto_cleared');
  assert.equal(staleAccept.data().customerNotice, 'ไม่จบงานภายใน 1 ชม.');
  const closedOffer = await db.collection('orders').doc('ord-stale-accept').collection('dispatchOffers').doc('live-slow').get();
  assert.equal(closedOffer.data().status, 'expired');
  assert.equal(closedOffer.data().endReason, 'stale_job');
  await D.onOrderWritten(db, {
    riderId: 'test-slow', status: 'accepted', dispatchCounted: true, type: 'shopping'
  }, staleAccept.data(), 'ord-stale-accept');
  const slowDoc = await db.collection('riders').doc('test-slow').get();
  assert.equal(slowDoc.data().activeJobCount, 0);
  assert.equal(slowDoc.data().lastNotice.text, 'OD-SLOW • ไม่จบงานภายใน 1 ชม.');
  await seedOrder('ord-with-goods', {
    type: 'express',
    status: 'picked_up',
    riderId: 'test-slow',
    riderName: 'สมหมาย',
    merchantId: '',
    merchantName: '',
    code: 'OD-GOODS',
    acceptedAt: hourAgo,
    dispatchState: 'assigned',
    dispatchOfferId: 'goods-offer'
  });
  await db.collection('orders').doc('ord-with-goods').collection('dispatchOffers').doc('goods-offer').set({
    riderId: 'test-slow', status: 'pending', orderId: 'ord-with-goods'
  });
  await db.collection('riders').doc('test-slow').update({ activeJobCount: 1 });
  const clearedGoods = await D.sweepTimeouts(db);
  assert.ok(clearedGoods.cleared >= 1);
  const goods = await db.collection('orders').doc('ord-with-goods').get();
  assert.equal(goods.exists, true);
  assert.equal(goods.data().riderId, 'test-slow');
  assert.equal(goods.data().status, 'cancelled');
  assert.equal(goods.data().cancelReason, 'ไม่จบงานภายใน 1 ชม.');
  assert.equal(goods.data().adminFlag, 'auto_cleared');
  const goodsOffer = await db.collection('orders').doc('ord-with-goods').collection('dispatchOffers').doc('goods-offer').get();
  assert.equal(goodsOffer.data().status, 'expired');
  await D.onOrderWritten(db, {
    riderId: 'test-slow', status: 'picked_up', type: 'express'
  }, goods.data(), 'ord-with-goods');
  const afterGoods = await db.collection('riders').doc('test-slow').get();
  assert.equal(afterGoods.data().activeJobCount, 0);

  const coolCfg = await D.loadConfig(db);
  const cooled = await D.findCandidates(db, pickup, 8, ['test-slow'], coolCfg, Date.now(), [], new Map([['test-slow', 90]]));
  assert.equal(cooled.list.some((c) => c.riderId === 'test-slow'), false);
  assert.ok(cooled.notes.some((n) => n.riderId === 'test-slow' && n.reason.indexOf('รออีก 90') !== -1));
  const freeAgain = await D.findCandidates(db, pickup, 8, [], coolCfg, Date.now(), []);
  assert.ok(freeAgain.list.some((c) => c.riderId === 'test-slow'));

  await seedOrder('ord-reoffer', {
    type: 'express',
    status: 'searching',
    merchantId: '',
    merchantName: '',
    code: 'OD-RE',
    createdAt: Timestamp.fromDate(new Date()),
    dispatchState: 'seeking',
    dispatchOfferedIds: ['test-slow']
  });
  await db.collection('orders').doc('ord-reoffer').collection('dispatchOffers').doc('old-offer').set({
    riderId: 'test-slow',
    status: 'expired',
    endReason: 'timeout',
    createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000))
  });
  const gpsSnap = await db.collection('gps_riders').get();
  for (const g of gpsSnap.docs) {
    if (g.id !== 'test-slow') await g.ref.update({ online: false });
  }
  const reoffered = await D.offerNext(db, 'ord-reoffer');
  assert.equal(reoffered.riderId, 'test-slow');

  const allOrders = await db.collection('orders').get();
  allOrders.forEach((doc) => assertNoProtectedShop(doc.data()));
  assert.ok(allOrders.size > 0);
  void FieldValue;

  const fs = require('fs');
  const path = require('path');
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rulesEnv = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')
    }
  });
  try {
    await rulesEnv.clearFirestore();
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('users').doc('shop1').set({ role: 'merchant' });
      await root.collection('users').doc('admin1').set({ role: 'admin', isPending: false });
      await root.collection('riders').doc('rider1').set({
        verified: true, riderId: 'rider1', trustScore: 100, status: 'inactive', offersAccepted: 0
      });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านทดสอบ' });
      await root.doc('config/dispatch').set({ mode: 'manual' });
      await root.collection('orders').doc('open1').set({
        type: 'food', status: 'cooking', userId: 'cust1', merchantId: 'shop1', merchantName: 'ร้านทดสอบ'
      });
      await root.collection('orders').doc('taken1').set({
        type: 'food', status: 'accepted', userId: 'cust1', merchantId: 'shop1', riderId: 'other'
      });
      await root.collection('orders').doc('secret').set({
        type: 'ride', status: 'searching', userId: 'someone', merchantName: 'ร้านทดสอบ'
      });
      await root.collection('orders').doc('open1').collection('dispatchOffers').doc('of1').set({
        riderId: 'rider1', status: 'pending', orderId: 'open1'
      });
      await root.collection('orders').doc('near1').set({
        type: 'food', status: 'on_the_way', userId: 'cust1', merchantId: 'shop1', riderId: 'rider1'
      });
      await root.collection('orders').doc('acc1').set({
        type: 'food', status: 'accepted', userId: 'cust1', merchantId: 'shop1', riderId: 'rider1'
      });
    });

    const rider = rulesEnv.authenticatedContext('rider1');
    const cust = rulesEnv.authenticatedContext('cust1');
    const shop = rulesEnv.authenticatedContext('shop1');
    const stranger = rulesEnv.authenticatedContext('stranger');
    const adminCtx = rulesEnv.authenticatedContext('admin1');
    const rdb = rider.firestore();
    const cdb = cust.firestore();
    const sdb = shop.firestore();
    const stdb = stranger.firestore();
    const adb = adminCtx.firestore();
    const checks = [
      ['rider open list', () => assertSucceeds(rdb.collection('orders').where('status', 'in', ['searching', 'pending', 'cooking', 'ready']).limit(10).get())],
      ['rider get open', () => assertSucceeds(rdb.collection('orders').doc('open1').get())],
      ['rider deny taken', () => assertFails(rdb.collection('orders').doc('taken1').get())],
      ['rider own list', () => assertSucceeds(rdb.collection('orders').where('riderId', '==', 'rider1').where('status', 'in', ['accepted', 'picked_up']).limit(5).get())],
      ['rider deny offer write', () => assertFails(rdb.collection('orders').doc('open1').collection('dispatchOffers').doc('x').set({ riderId: 'rider1', status: 'pending' }))],
      ['rider offer list', () => assertSucceeds(rdb.collectionGroup('dispatchOffers').where('riderId', '==', 'rider1').where('status', '==', 'pending').get())],
      ['rider deny stats', () => assertFails(rdb.collection('riders').doc('rider1').update({ offersAccepted: 9 }))],
      ['rider save token', () => assertSucceeds(rdb.collection('riders').doc('rider1').update({ status: 'active', fcmTokens: ['tok'] }))],
      ['rider gps', () => assertSucceeds(rdb.collection('gps_riders').doc('rider1').set({ riderId: 'rider1', online: true, lat: 8.02, lng: 100.15, geohash: 'w000000000' }))],
      ['rider read config', () => assertSucceeds(rdb.doc('config/dispatch').get())],
      ['rider deny config', () => assertFails(rdb.doc('config/dispatch').set({ mode: 'auto' }))],
      ['customer list', () => assertSucceeds(cdb.collection('orders').where('userId', '==', 'cust1').limit(10).get())],
      ['customer deny secret', () => assertFails(cdb.collection('orders').doc('secret').get())],
      ['shop list', () => assertSucceeds(sdb.collection('orders').where('merchantId', '==', 'shop1').limit(10).get())],
      ['stranger deny one', () => assertFails(stdb.collection('orders').doc('open1').get())],
      ['stranger deny list', () => assertFails(stdb.collection('orders').limit(5).get())],
      ['admin list', () => assertSucceeds(adb.collection('orders').limit(5).get())],
      ['admin save config', () => assertSucceeds(adb.doc('config/dispatch').set({ mode: 'manual', radiusStepsKm: [3, 5, 8] }))]
    ];
    for (const [name, run] of checks) {
      try {
        await run();
      } catch (err) {
        throw new Error(name + ': ' + (err && err.message));
      }
    }

    const claim = {
      riderId: 'rider1', riderName: 'ทดสอบ', riderPhone: '0800000000', status: 'accepted', acceptedAt: 1
    };
    await assertFails(rdb.collection('orders').doc('open1').update(claim));

    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.doc('config/dispatch').set({ mode: 'auto' });
      await root.collection('orders').doc('open2').set({
        type: 'food', status: 'cooking', userId: 'cust1', merchantId: 'shop1', merchantName: 'ร้านทดสอบ'
      });
      await root.collection('orders').doc('open2').update({ dispatchOfferRiderId: 'rider1' });
      await root.collection('orders').doc('open-broadcast').set({
        type: 'ride', status: 'searching', userId: 'cust1', merchantId: '', merchantName: ''
      });
      await root.collection('orders').doc('open-broadcast').collection('dispatchOffers').doc('rider1').set({
        riderId: 'rider1', status: 'pending', broadcast: true, orderId: 'open-broadcast'
      });
      await root.collection('orders').doc('open-other').set({
        type: 'ride', status: 'searching', userId: 'cust1', merchantId: '', merchantName: ''
      });
      await root.collection('orders').doc('open-other').collection('dispatchOffers').doc('someone').set({
        riderId: 'someone', status: 'pending', broadcast: true, orderId: 'open-other'
      });
      await root.collection('orders').doc('shop-offer').set({
        type: 'shopping',
        status: 'searching',
        userId: 'cust1',
        merchantId: '',
        merchantName: '',
        shopPlaceName: '7-Eleven',
        code: 'OD-8548',
        dispatchOfferId: 'shop-of',
        dispatchOfferRiderId: 'rider1'
      });
      await root.collection('orders').doc('shop-offer').collection('dispatchOffers').doc('shop-of').set({
        riderId: 'rider1', status: 'pending', orderId: 'shop-offer'
      });
      await root.collection('rider_locks').doc('rider1').set({ riderId: 'rider1', orderId: '' });
    });
    await assertFails(rdb.collection('orders').doc('open2').update(claim));
    await assertFails(rdb.collection('orders').doc('open-broadcast').update(claim));
    await assertFails(rdb.collection('orders').doc('open-other').update(claim));
    await assertFails(rdb.collection('orders').doc('shop-offer').update(claim));
    await assertFails(rdb.collection('orders').doc('shop-offer').collection('dispatchOffers').doc('shop-of').update({
      status: 'accepted'
    }));
    await assertFails(rdb.collection('rider_locks').doc('rider1').set({ orderId: 'open1' }));

    let serverTimestamp = null;
    try {
      const firebase = require('firebase/compat/app');
      require('firebase/compat/firestore');
      serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();
    } catch (err) {
      const { serverTimestamp: modularStamp } = require('firebase/firestore');
      serverTimestamp = modularStamp;
    }
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.collection('orders').doc('chat1').set({
        type: 'express', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1',
        userName: 'ลูกค้า', riderName: 'สมหญิง', code: 'OD-CHAT'
      });
      await root.collection('chats').doc('chat1').set({ orderId: 'chat1' });
      await root.collection('orders').doc('chat2').set({
        type: 'ride', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '',
        code: 'OD-CHAT2'
      });
      await root.collection('chats').doc('chat-listed').set({
        orderId: 'chat-listed', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
    });
    const msg = (senderId, senderRole, text, extra) => Object.assign({
      senderId, senderRole, senderName: 'ทดสอบ', text, createdAt: serverTimestamp()
    }, extra || {});
    const chatChecks = [
      ['customer reads missing chat', () => assertSucceeds(cdb.collection('chats').doc('chat2').get())],
      ['stranger reads missing chat', () => assertSucceeds(stdb.collection('chats').doc('chat-missing').get())],
      ['stranger cannot read legacy chat', () => assertFails(stdb.collection('chats').doc('chat1').get())],
      ['customer creates chat from order', () => assertSucceeds(cdb.collection('chats').doc('chat2').set({
        orderId: 'chat2', userId: 'cust1', riderId: 'rider1', merchantId: '',
        userName: 'ลูกค้า', riderName: 'สมหญิง', merchantName: '',
        lastMessage: '', lastSenderId: '',
        lastMessageAt: serverTimestamp(), createdAt: serverTimestamp()
      }))],
      ['customer message on legacy chat', () => assertSucceeds(cdb.collection('chats').doc('chat1').collection('messages').add(msg('cust1', 'user', 'ถึงไหนแล้ว')))],
      ['rider message on legacy chat', () => assertSucceeds(rdb.collection('chats').doc('chat1').collection('messages').add(msg('rider1', 'rider', 'กำลังไป')))],
      ['shop system message', () => assertSucceeds(sdb.collection('chats').doc('chat1').collection('messages').add(Object.assign(msg('shop1', 'merchant', 'ยกเลิก'), { systemMessage: true })))],
      ['rider automated status note', () => assertSucceeds(rdb.collection('chats').doc('chat1').collection('messages').add(Object.assign(msg('rider1', 'rider', 'ใกล้ถึงแล้ว'), {
        systemMessage: true, automated: true, automationKey: 'near_customer'
      })))],
      ['long automation key denied', () => assertFails(rdb.collection('chats').doc('chat1').collection('messages').add(Object.assign(msg('rider1', 'rider', 'ยาวไป'), {
        automated: true, automationKey: 'x'.repeat(41)
      })))],
      ['rider stamps near and arrival', () => assertSucceeds(rdb.collection('orders').doc('near1').update({
        riderNearCustomerAt: serverTimestamp(),
        riderNearCustomerChatAt: serverTimestamp(),
        riderArrivedCustomerChatAt: serverTimestamp()
      }))],
      ['customer cannot stamp arrival', () => assertFails(cdb.collection('orders').doc('near1').update({
        riderArrivedCustomerChatAt: serverTimestamp()
      }))],
      ['rider cannot stamp arrival before on_the_way', () => assertFails(rdb.collection('orders').doc('acc1').update({
        riderNearCustomerAt: serverTimestamp()
      }))],
      ['customer image message', () => assertSucceeds(cdb.collection('chats').doc('chat1').collection('messages').add({
        senderId: 'cust1', senderRole: 'user', senderName: 'ลูกค้า', text: '', imageUrl: 'https://example.com/a.jpg', createdAt: serverTimestamp()
      }))],
      ['stranger message denied', () => assertFails(stdb.collection('chats').doc('chat1').collection('messages').add(msg('stranger', 'user', 'แอบ')))],
      ['wrong sender id denied', () => assertFails(cdb.collection('chats').doc('chat1').collection('messages').add(msg('rider1', 'user', 'ปลอม')))],
      ['customer cannot send as rider', () => assertFails(cdb.collection('chats').doc('chat1').collection('messages').add(msg('cust1', 'rider', 'ปลอมบท')))],
      ['phone field denied', () => assertFails(cdb.collection('chats').doc('chat1').collection('messages').add(msg('cust1', 'user', 'เบอร์', { senderPhone: '0800000000' })))],
      ['customer repairs chat preview', () => assertSucceeds(cdb.collection('chats').doc('chat1').update({
        userId: 'cust1', riderId: 'rider1', merchantId: 'shop1',
        lastMessage: 'ถึงไหนแล้ว', lastSenderId: 'cust1', lastMessageAt: serverTimestamp()
      }))],
      ['customer chat list', () => assertSucceeds(cdb.collection('chats').where('userId', '==', 'cust1').get())],
      ['stranger chat list denied', () => assertFails(stdb.collection('chats').limit(5).get())],
      ['admin chat list', () => assertSucceeds(adb.collection('chats').limit(5).get())],
      ['admin message', () => assertSucceeds(adb.collection('chats').doc('chat1').collection('messages').add(msg('admin1', 'admin', 'ตรวจ')))],
      ['admin message without sender denied', () => assertFails(adb.collection('chats').doc('chat1').collection('messages').add({
        senderRole: 'admin', senderName: 'Admin', text: 'ไม่มีผู้ส่ง', createdAt: serverTimestamp()
      }))]
    ];
    for (const [name, run] of chatChecks) {
      try {
        await run();
      } catch (err) {
        throw new Error(name + ': ' + (err && err.message));
      }
    }
  } finally {
    await rulesEnv.cleanup();
  }
});
