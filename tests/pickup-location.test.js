const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const cssStart = html.indexOf('.travel-search-row');
const cssEnd = html.indexOf('.travel-body');
const css = html.slice(cssStart, cssEnd);
const helpersStart = html.indexOf('function formatAccuracyMeters(');
const helpersEnd = html.indexOf('function hasRealImage(', helpersStart);
assert.notEqual(helpersStart, -1);
assert.notEqual(helpersEnd, -1);

const context = {
  rideOrigin: null,
  userLocation: null,
  userProfile: null,
  shoppingDropoff: null,
  Math,
  Number,
  isFinite
};
vm.createContext(context);
vm.runInContext(html.slice(html.indexOf('function haversine('), html.indexOf('function fmtDistance(')) + '\n' + html.slice(helpersStart, helpersEnd), context);

test('the map button stays fully tappable beside the destination search', () => {
  assert.match(css, /\.travel-search-bar \{[^}]*min-width: 0/);
  assert.match(css, /\.travel-map-btn, \.merchant-map-btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.travel-map-btn, \.merchant-map-btn \{[^}]*flex: 0 0 auto/);
  assert.match(css, /\.travel-map-btn \{ min-width: 112px; \}/);
  assert.match(html, /class="travel-map-btn[^"]*" onclick="openMapPicker\('travel'\)"/);
  assert.match(html, /🗺️ <span>แผนที่<\/span>/);
  assert.equal(css.includes('display:none'), false);
});

test('ride, express, shopping, and food can refresh GPS or pick the point on the map', () => {
  assert.match(html, /data-refresh-gps="ride"/);
  assert.match(html, /data-pick-map="ride-origin"/);
  assert.match(html, /data-pick-map="ride-dest"/);
  assert.match(html, /data-refresh-gps="express"/);
  assert.match(html, /data-exp-map="exp-origin">🗺️ เลือกจุดรับจากแผนที่/);
  assert.match(html, /data-exp-map="exp-destination">🗺️ เลือกปลายทางจากแผนที่/);
  assert.match(html, /data-refresh-gps="shopping">📍 ใช้ตำแหน่งฉัน/);
  assert.match(html, /data-pick-map="shop-dropoff">🗺️ เลือกจากแผนที่/);
  assert.match(html, /data-refresh-gps="reference">📍 อัปเดตตำแหน่ง GPS/);
  assert.match(html, /data-pick-map="reference">🗺️ เลือกจากแผนที่/);
  assert.match(html, /id="hotel-loc-status"/);
  assert.match(html, /id="map-loc-status"/);
  assert.match(html, /if \(mode === 'reference'\)/);
  assert.match(html, /applyReferenceLocation\(point\)/);
  assert.match(css, /\.loc-action-btn, \.express-swap-btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.loc-action-btn, \.express-swap-btn \{[^}]*white-space: nowrap/);
  assert.match(css, /\.loc-action-btn, \.express-swap-btn \{[^}]*border-radius: 999px/);
  assert.match(css, /data-refresh-gps\] \{[^}]*linear-gradient\(135deg, var\(--brand\), var\(--brand-dark\)\)/);
  assert.match(html, /data-refresh-gps="food"/);
  assert.match(html, /openMapPicker\(\\?'food\\?'\)/);
  assert.match(html, /📍 อัปเดตตำแหน่ง/);
  assert.match(html, /🗺️ เลือกจากแผนที่/);
  assert.match(html, /ยังไม่ทราบตำแหน่งของคุณ/);
  assert.match(html, /FRESH_GPS_OPTIONS = \{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 \}/);
  assert.match(html, /formatAccuracyMeters\(point\.accuracy\)/);
  assert.match(html, /return quoteRide\(vehicle, ridePickupPoint\(\), dest\)/);
  assert.match(html, /mode === 'ride-origin'/);
  assert.match(html, /mode === 'shop-dropoff'/);
});

test('a chosen pickup changes the quoted fare and keeps the base when GPS is missing', () => {
  context.rideOrigin = null;
  context.userLocation = null;
  const missing = context.quoteRide({ type: 'motorcycle', price: 30 }, context.ridePickupPoint(), { lat: 8.05, lng: 100.08 });
  assert.equal(missing.total, 30);
  assert.equal(missing.distance, 0);

  context.userLocation = { lat: 7.965, lng: 99.996, accuracy: 18 };
  const gps = context.quoteRide({ type: 'motorcycle', price: 30 }, context.ridePickupPoint(), { lat: 8.05, lng: 100.08 });
  const km = context.haversine(7.965, 99.996, 8.05, 100.08) * 1.3;
  assert.equal(gps.total, Math.round(30 + km * 5));
  assert.equal(context.formatAccuracyMeters(18), 'ความแม่น ±18 ม.');
  assert.equal(context.formatAccuracyMeters(undefined), '');
  assert.equal(context.formatAccuracyMeters(null), '');

  context.rideOrigin = { lat: 8.02, lng: 100.02, address: 'จุดที่เลือก' };
  const pinned = context.quoteRide({ type: 'car', price: 60 }, context.ridePickupPoint(), { lat: 8.05, lng: 100.08 });
  const pinnedKm = context.haversine(8.02, 100.02, 8.05, 100.08) * 1.3;
  assert.equal(pinned.total, Math.round(60 + pinnedKm * 10));
  assert.notEqual(pinned.total, gps.total);

  const express = context.expressQuotedFare(context.rideOrigin, { lat: 8.05, lng: 100.08 });
  assert.equal(express.total, Math.round(30 + pinnedKm * 5));
  const shop = context.shoppingQuotedFare({ lat: 7.97, lng: 100.00 }, { lat: 8.00, lng: 100.05 });
  const shopKm = context.haversine(7.97, 100.00, 8.00, 100.05) * 1.3;
  assert.equal(shop.total, Math.round(30 + shopKm * 5));
});

test('ride submit sends the chosen pickup coordinates', () => {
  const submit = html.slice(html.indexOf('window.submitRideOrder'), html.indexOf('/* ═══ ORDER FORM'));
  assert.match(submit, /fromLat: pickup \? pickup\.lat : null/);
  assert.match(submit, /fromLng: pickup \? pickup\.lng : null/);
  assert.match(submit, /quoteRide\(selectedVehicle, pickup/);
  const express = html.slice(html.indexOf('window.submitExpressOrder'), html.indexOf('/* ═══ CATEGORY'));
  assert.match(express, /expressQuotedFare\(expOrigin, expDestination\)/);
  assert.match(express, /fromLat: expOrigin \? expOrigin\.lat : null/);
});
