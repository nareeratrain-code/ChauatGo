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
