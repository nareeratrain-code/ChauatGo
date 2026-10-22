const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const haversineStart = indexHtml.indexOf('function haversine(');
const haversineEnd = indexHtml.indexOf('function fmtDistance(', haversineStart);
const feeStart = indexHtml.indexOf('function feePoint(');
const feeEnd = indexHtml.indexOf('window.openCart', feeStart);
assert.notEqual(haversineStart, -1);
assert.notEqual(feeStart, -1);
assert.notEqual(feeEnd, -1);

const context = {
  cart: [],
  cartShop: '',
  nearbyShopsCache: [],
  merchantsCache: [],
  userLocation: null,
  window: {},
  Math,
  Number,
  isFinite
};
vm.createContext(context);
vm.runInContext(indexHtml.slice(haversineStart, haversineEnd) + '\n' + indexHtml.slice(feeStart, feeEnd), context);

test('fee follows the shop to the drop-off, not the customer GPS', () => {
  context.cartShop = 'shop1';
  context.cart = [{ merchantId: 'shop1' }];
  context.window._currentMerchant = null;
  context.nearbyShopsCache = [{ id: 'shop1', lat: 7.90, lng: 99.90 }];
  context.merchantsCache = [];
  context.userLocation = { lat: 8.05, lng: 100.08 };
  const dropoff = { lat: 8.05, lng: 100.08 };
  const info = context.calculateFoodDeliveryFee(dropoff);
  const shopKm = context.haversine(7.90, 99.90, dropoff.lat, dropoff.lng) * 1.3;
  const gpsKm = context.haversine(context.userLocation.lat, context.userLocation.lng, dropoff.lat, dropoff.lng);
  assert.equal(info.estimated, true);
  assert.ok(info.fee > 20);
  assert.ok(Math.abs(info.distance - shopKm) < 0.001);
  assert.ok(gpsKm < 0.01);
});

test('missing shop coordinates fall back to the base fee', () => {
  context.cartShop = 'shop1';
  context.cart = [{ merchantId: 'shop1' }];
  context.nearbyShopsCache = [{ id: 'shop1', name: 'ไม่มีพิกัด' }];
  context.window._currentMerchant = null;
  context.userLocation = { lat: 7.96, lng: 99.99 };
  const info = context.calculateFoodDeliveryFee({ lat: 8.05, lng: 100.08 });
  assert.equal(info.fee, 20);
  assert.equal(info.distance, null);
  assert.equal(info.estimated, false);
});

test('extra kilometres are ฿8 after the first 2 km and the fee caps at ฿150', () => {
  context.cartShop = '';
  context.cart = [];
  context.nearbyShopsCache = [];
  context.merchantsCache = [];
  context.window._currentMerchant = null;
  const shop = { lat: 7.90, lng: 99.90 };
  const near = { lat: 7.925, lng: 99.90 };
  const nearInfo = context.calculateFoodDeliveryFee(near, shop);
  const nearKm = context.haversine(shop.lat, shop.lng, near.lat, near.lng) * 1.3;
  assert.ok(nearKm > 2 && nearKm < 4);
  assert.equal(nearInfo.fee, 20 + Math.ceil(nearKm - 2) * 8);
  assert.equal(nearInfo.extra, nearInfo.fee - 20);

  const far = { lat: 8.20, lng: 100.20 };
  const farInfo = context.calculateFoodDeliveryFee(far, shop);
  const farKm = context.haversine(shop.lat, shop.lng, far.lat, far.lng) * 1.3;
  assert.ok(farKm > 20);
  assert.equal(farInfo.fee, 150);
  assert.ok(farInfo.extra > 130);
});

test('food fee copy shows ฿8 per km after the first 2 km', () => {
  assert.match(indexHtml, /฿20 รวม 2 กม\.แรก จากนั้น ฿8\/กม\./);
  assert.match(indexHtml, /฿8\/กม\. หลัง 2 กม\./);
  assert.doesNotMatch(indexHtml.slice(feeStart, feeEnd), /\* 5/);
});

test('a fresh merchant document overrides a cart without coordinates', () => {
  context.cartShop = 'shop1';
  context.cart = [];
  context.nearbyShopsCache = [];
  const info = context.calculateFoodDeliveryFee(
    { lat: 7.96, lng: 99.99 },
    { lat: 7.96, lng: 99.99 }
  );
  assert.equal(info.fee, 20);
  assert.ok(info.distance < 0.01);
});
