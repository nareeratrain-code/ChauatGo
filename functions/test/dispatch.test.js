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
  assert.equal(first.riderId, 'test-idle');
  const chain = await db.collection('orders').doc('ord-chain').get();
  assert.equal(chain.data().dispatchState, 'offered');
  assert.equal(chain.data().dispatchOfferRiderId, 'test-idle');

  const again = await D.offerNext(db, 'ord-chain');
  assert.equal(again.skipped, 'live');
  const offers1 = await db.collection('orders').doc('ord-chain').collection('dispatchOffers').get();
  assert.equal(offers1.size, 1);

  await D.expireOffer(db, 'ord-chain', first.offerId, 'skipped');
  const second = await db.collection('orders').doc('ord-chain').get();
  assert.equal(second.data().dispatchOfferRiderId, 'test-near');
  assert.ok(second.data().dispatchOfferedIds.indexOf('test-idle') !== -1);
  assert.ok(second.data().dispatchOfferedIds.indexOf('test-busy') === -1);

  await D.expireOffer(db, 'ord-chain', second.data().dispatchOfferId, 'skipped');
  const third = await db.collection('orders').doc('ord-chain').get();
  assert.equal(third.data().dispatchOfferRiderId, 'test-far');
  assert.equal(third.data().dispatchRadiusStep, 2);

  await D.expireOffer(db, 'ord-chain', third.data().dispatchOfferId, 'skipped');
  const done = await db.collection('orders').doc('ord-chain').get();
  assert.equal(done.data().dispatchState, 'manual');
  assert.equal(done.data().dispatchManualReason, 'ไม่มีไรเดอร์ว่างในระยะ 8 กม. — ไรเดอร์ในระยะมีงานอยู่แล้ว');

  await seedOrder('ord-accept');
  const offer = await D.offerNext(db, 'ord-accept');
  assert.equal(offer.riderId, 'test-idle');
  const raced = await Promise.allSettled([
    D.acceptOffer(db, 'test-idle', 'ord-accept', offer.offerId),
    D.acceptOffer(db, 'test-idle', 'ord-accept', offer.offerId)
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

  await seedOrder('ord-second');
  const blocked = await D.offerNext(db, 'ord-second');
  assert.notEqual(blocked.riderId, 'test-idle');
  assert.notEqual(blocked.riderId, 'test-busy');

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
  assert.equal(noPick.skipped, 'no-pickup');
  const noPickDoc = await db.collection('orders').doc('ord-nopick').get();
  assert.equal(noPickDoc.data().dispatchManualReason, 'ร้านไม่มีพิกัด');

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
    try {
      await assertSucceeds(rdb.collection('orders').doc('open1').update(claim));
    } catch (err) {
      throw new Error('manual claim: ' + (err && err.message));
    }

    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.doc('config/dispatch').set({ mode: 'auto' });
      await root.collection('orders').doc('open2').set({
        type: 'food', status: 'cooking', userId: 'cust1', merchantId: 'shop1', merchantName: 'ร้านทดสอบ'
      });
    });
    await assertFails(rdb.collection('orders').doc('open2').update(claim));
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('orders').doc('open2').update({ dispatchOfferRiderId: 'rider1' });
    });
    try {
      await assertSucceeds(rdb.collection('orders').doc('open2').update(claim));
    } catch (err) {
      throw new Error('offered claim: ' + (err && err.message));
    }
  } finally {
    await rulesEnv.cleanup();
  }
});
