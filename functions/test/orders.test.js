'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../orders');

test('food fee is ฿20, then ฿8 per km after 2 km, capped at ฿150', () => {
  assert.equal(O.foodDeliveryFee(null, { lat: 8, lng: 100 }).fee, 20);
  const shop = { lat: 7.90, lng: 99.90 };
  const near = { lat: 7.925, lng: 99.90 };
  const nearFee = O.foodDeliveryFee(shop, near);
  assert.ok(nearFee.distanceKm > 2 && nearFee.distanceKm < 4);
  assert.equal(nearFee.fee, 20 + Math.ceil(nearFee.distanceKm - 2) * 8);
  const far = O.foodDeliveryFee(shop, { lat: 8.20, lng: 100.20 });
  assert.ok(far.distanceKm > 20);
  assert.equal(far.fee, 150);
});

test('ride, express, and shopping keep their own rates', () => {
  const from = { lat: 8, lng: 100 };
  const to = { lat: 8.01, lng: 100 };
  const ride = O.rideFare('motorcycle', from, to);
  assert.ok(ride.fare >= 30);
  assert.equal(O.rideFare('', from, to).fare, 50);
  const express = O.expressFare(from, to);
  assert.equal(express.fare, Math.round(30 + express.distanceKm * 5));
  const shop = O.shoppingFare(from, to);
  assert.equal(shop.fare, Math.round(30 + (shop.distanceKm / 1.3) * 1.3 * 5));
  assert.equal(O.shoppingFare(null, to).fare, 30);
});

test('shop closed charges the delivery fee only', () => {
  const transfer = O.shopClosedText({ fare: 20, paymentMode: 'transfer', foodTotal: 210 });
  assert.match(transfer, /ไม่มีส่วนเกี่ยวข้อง/);
  assert.match(transfer, /ค่าส่ง ฿20/);
  assert.equal(transfer.includes('฿210'), false);
  const cash = O.shopClosedText({ fare: 20, paymentMode: 'cash', cashTip: 5 });
  assert.match(cash, /ค่าส่ง ฿20 \+ ค่าบริการเงินสด ฿5 = รวม ฿25/);
  assert.match(cash, /เงินสด/);
});

test('GP is 3 percent after the promo, split 2 and 1', () => {
  assert.deepEqual(O.calcGp(200, {}), { total: 0, rider: 0, platform: 0, promo: true });
  const old = { gpStartDate: { seconds: Math.floor((Date.now() - 100 * 86400000) / 1000) } };
  assert.equal(O.promoActive(old), false);
  assert.deepEqual(O.calcGp(200, old), { total: 6, rider: 4, platform: 2, promo: false });
  assert.equal(JSON.stringify(O.calcGp(10, old)).includes('เหล่าเต๊ง'), false);
});
