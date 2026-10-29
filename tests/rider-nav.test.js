const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const css = fs.readFileSync('rider.css', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

function slice(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

const orderContext = {
  PLACES: [],
  Math,
  Number,
  isFinite,
  String,
  exactCatalogPlace: () => null
};
vm.createContext(orderContext);
vm.runInContext(
  slice(html, 'function haversine(', 'function fmtDistance(') + '\n' +
  slice(html, 'function foldPlaceName(', 'function foldSearchQuery(') + '\n' +
  slice(html, 'function pointMatchesText(', 'function exactCatalogPlace('),
  orderContext
);

const riderContext = { Math, Number, String, encodeURIComponent, isFinite, esc: (value) => String(value ?? '') };
vm.createContext(riderContext);
vm.runInContext(slice(rider, 'function riderCoord(', 'function renderJobs('), riderContext);

test('a map pin is kept when the landmark name is not an exact catalog match', () => {
  orderContext.exactCatalogPlace = () => null;
  const pin = { lat: 7.96123, lng: 99.99876, address: 'พิกัด 7.96123, 99.99876' };
  const kept = orderContext.resolveOrderPoint(pin, 'วัดทดสอบ');
  assert.equal(kept.lat, 7.96123);
  assert.equal(kept.lng, 99.99876);
  assert.equal(orderContext.resolveOrderPoint(null, 'วัดทดสอบ'), null);
});

test('typing a different catalog place replaces the previous pin', () => {
  orderContext.exactCatalogPlace = (text) => (
    text === 'ตลาดทดสอบ'
      ? { lat: 8.11, lng: 100.22, label: 'ตลาดทดสอบ', placeId: 'market-test' }
      : null
  );
  const swapped = orderContext.resolveOrderPoint(
    { lat: 7.96123, lng: 99.99876, address: 'พิกัด 7.96123, 99.99876' },
    'ตลาดทดสอบ'
  );
  assert.equal(swapped.lat, 8.11);
  assert.equal(swapped.lng, 100.22);
  assert.equal(swapped.placeId, 'market-test');
});

test('a directory place id restores that place when the label still matches', () => {
  orderContext.exactCatalogPlace = () => null;
  orderContext.PLACES = [{ id: 'place-test', name: 'วัดทดสอบ', lat: 7.55, lng: 99.55 }];
  const fromDirectory = orderContext.resolveOrderPoint(
    { lat: 7.5502, lng: 99.5502, address: 'ถนนเพชรเกษม', placeId: 'place-test' },
    'วัดทดสอบ'
  );
  assert.equal(fromDirectory.lat, 7.55);
  assert.equal(fromDirectory.lng, 99.55);
  const moved = orderContext.resolveOrderPoint(
    { lat: 8.4, lng: 100.4, address: 'ถนนเพชรเกษม', placeId: 'place-test' },
    'วัดทดสอบ'
  );
  assert.equal(moved.lat, 8.4);
  assert.equal(moved.lng, 100.4);
});

test('every order form keeps the chosen pickup and drop-off coordinates', () => {
  const ride = slice(html, 'window.submitRideOrder', '/* ═══ ORDER FORM');
  assert.match(ride, /resolveOrderPoint\(ridePickupPoint\(\), from\)/);
  assert.match(ride, /resolveOrderPoint\(selectedDestination, to\)/);
  assert.match(ride, /fromLat: pickup \? pickup\.lat : null/);
  assert.match(ride, /lat:destLat, lng:destLng/);
  const express = slice(html, 'window.submitExpressOrder', '/* ═══ CATEGORY');
  assert.match(express, /resolveOrderPoint\(expOrigin, fromAddr\)/);
  assert.match(express, /resolveOrderPoint\(expDestination, toAddr\)/);
  assert.match(express, /fromLat: expOrigin \? expOrigin\.lat : null/);
  assert.match(express, /lat: expDestination \? expDestination\.lat : null/);
  const shop = slice(html, 'window.submitShopOrder', '/* ═══ MODAL');
  assert.match(shop, /resolveOrderPoint\(shoppingCustomerPoint\(\), dropText\)/);
  assert.match(shop, /shopPlaceLat: p\.lat, shopPlaceLng: p\.lng/);
  const food = slice(html, 'window.confirmCheckout', '/* ════════════════════════════════');
  assert.match(food, /resolveOrderPoint\(dropSeed, dropText\)/);
  assert.match(food, /shopPlaceLat: shopPoint \? shopPoint\.lat : null/);
  const generic = slice(html, 'window.submitOrder', '/* ═══ EXPRESS');
  assert.match(generic, /lat: destPoint \? destPoint\.lat : null/);
  assert.match(html, /setDestination\(p\.lat, p\.lng, true, p\.name, p\.id \|\| placeId\)/);
});

test('rider navigation uses the stored pin for the current stage', () => {
  const ride = riderContext.riderNavModel({
    type: 'ride', status: 'accepted',
    from: 'จุดรับทดสอบ', fromLat: 7.96, fromLng: 99.99,
    to: 'จุดส่งทดสอบ', lat: 8.01, lng: 100.02,
    note: 'บ้านสีฟ้า'
  });
  assert.equal(ride.stage, 'pickup');
  assert.equal(ride.primary.point.lat, 7.96);
  assert.equal(ride.pickupUrl.href, 'https://www.google.com/maps/dir/?api=1&destination=7.96,99.99&travelmode=driving');
  assert.equal(ride.pickupUrl.geo, 'geo:7.96,99.99?q=7.96,99.99');
  assert.equal(ride.dropoffUrl.missing, false);

  const after = riderContext.riderNavModel({
    type: 'express', status: 'on_the_way',
    from: 'ต้นทาง', fromLat: 7.9, fromLng: 99.9,
    to: 'ปลายทาง', lat: 8.2, lng: 100.2
  });
  assert.equal(after.stage, 'dropoff');
  assert.equal(after.primary.point.lat, 8.2);
  assert.match(after.dropoffUrl.href, /travelmode=driving/);

  const food = riderContext.riderNavModel({
    type: 'food', status: 'ready',
    shopPlaceName: 'ร้านทดสอบ', shopPlaceLat: 7.97, shopPlaceLng: 99.98,
    address: 'บ้านลูกค้า', lat: 8.0, lng: 100.0
  });
  assert.equal(food.pickup.kind, 'shop');
  assert.equal(food.pickup.point.lat, 7.97);
  assert.equal(food.dropoff.label, 'บ้านลูกค้า');

  const shopping = riderContext.riderNavModel({
    type: 'shopping', status: 'picked_up',
    shopPlaceName: 'ร้านของใช้ทดสอบ', shopPlaceLat: 7.98, shopPlaceLng: 99.97,
    address: 'จุดส่งของใช้', lat: 8.05, lng: 100.05
  });
  assert.equal(shopping.stage, 'dropoff');
  assert.equal(shopping.pickup.label, 'ร้านของใช้ทดสอบ');
  assert.equal(shopping.dropoff.point.lng, 100.05);

  const legacy = riderContext.riderNavModel({
    type: 'ride', status: 'accepted',
    from: 'วัดทดสอบ', to: 'บ้านทดสอบ'
  });
  assert.equal(legacy.pickup.point, null);
  assert.equal(legacy.pickupUrl.missing, true);
  assert.equal(legacy.pickupUrl.href, 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('วัดทดสอบ'));
  assert.equal(legacy.pickupUrl.geo, '');
});

test('rider cards expose both navigation buttons, the note, and a map preview', () => {
  assert.match(rider, /🧭 นำทางไปจุดรับ/);
  assert.match(rider, /🧭 นำทางไปจุดส่ง/);
  assert.match(rider, /travelmode=driving/);
  assert.match(rider, /geo:' \+ lat \+ ',' \+ lng \+ '\?q='/);
  assert.match(rider, /ไม่มีพิกัดที่ลูกค้าปักไว้/);
  assert.match(rider, /data-geo/);
  assert.match(rider, /\/Android\/i\.test\(navigator\.userAgent/);
  assert.match(rider, /jc-note/);
  assert.match(rider, /data-card-map/);
  assert.match(css, /\.jc-nav-btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.jc-nav-btn \{[^}]*border-radius: 999px/);
  assert.match(css, /\.jc-nav-btn\.primary \{[^}]*linear-gradient\(135deg, var\(--green\), var\(--green-dark\)\)/);
  assert.match(css, /\[data-theme="dark"\] \.jc-nav-btn\.secondary/);
  assert.match(css, /\[data-theme="dark"\] \.jc-nav-warn/);
  const readRule = rules.slice(rules.indexOf('function canReadOrder()'), rules.indexOf('function noDispatchControl'));
  assert.match(readRule, /resource\.data\.get\('riderId', ''\) == myUid\(\)/);
});
