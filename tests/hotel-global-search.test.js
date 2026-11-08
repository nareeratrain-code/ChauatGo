const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');

test('Hotel directory uses one province-wide search without district/tambon selectors', () => {
  assert.match(html, /ค้นหาโรงแรมและรีสอร์ตได้ทุกอำเภอทุกตำบล/);
  assert.match(html, /id="hotel-search-input"/);
  assert.doesNotMatch(html, /id="hotel-district"[^>]*onchange="setHotelDistrict/);
  assert.doesNotMatch(html, /id="hotel-tambon"[^>]*onchange="setHotelTambon/);
});

test('Hotel directory loads every province file and searches district, tambon, and address text', () => {
  const start = html.indexOf('function renderHotelDirectory()');
  const end = html.indexOf('\nfunction renderTouristDirectory()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = html.slice(start, end);
  assert.match(block, /provinceDataReady\(''\)/);
  assert.match(block, /ensurePlaceData\(function\(\)\{ renderHotelDirectory\(\); \}, ''\)/);
  assert.match(block, /filterDirectoryPlaces\(hotels, hotelSearchQuery, '', ''\)/);
  assert.match(html, /p\.tambon \|\| ''\).*p\.district.*p\.address/);
  assert.match(html, /var cap = q \? rows\.length/);
});

test('hotel place labels stay exact instead of becoming nearby labels on the map', () => {
  assert.match(html, /if \(listed && listed\.category === 'h' && listed\.name\) return String\(listed\.name\)\.trim\(\);/);
  assert.match(html, /address: seed\.address \|\| '', note: seed\.note \|\| '', placeId: seed\.placeId \|\| ''/);
});

test('choosing a hotel opens the ride destination picker and keeps the hotel pin', () => {
  const start = html.indexOf('window.setDestFromPlace = function(placeId)');
  const end = html.indexOf('\n};', start) + 3;
  const block = html.slice(start, end);
  assert.match(block, /mapPickerMode = 'ride-dest'/);
  assert.match(block, /openMapPage\(true\)/);
  assert.match(block, /setDestination\(p\.lat, p\.lng, true, p\.name, p\.id \|\| placeId\)/);
});

test('reverse geocoding preserves the exact name of a directly selected hotel', () => {
  const start = html.indexOf('function scheduleReverseGeocode(lat, lng)');
  const end = html.indexOf('\nfunction onDestMapMoveEnd()', start);
  const block = html.slice(start, end);
  assert.match(block, /var directPlace = selectedDestination && selectedDestination\.placeId/);
  assert.match(block, /String\(selectedDestination\.address \|\| reverseLabel \|\| ''\)\.trim\(\)/);
  assert.match(block, /: destinationLabelForPoint\(\{ lat: lat, lng: lng, address: reverseLabel \}, '', true\)/);
});

test('opening the map carries the selected hotel placeId through the initial move', () => {
  const start = html.indexOf("destHoldAddress = seed.address || ''");
  assert.notEqual(start, -1);
  const block = html.slice(start, start + 420);
  assert.match(block, /destHoldPlaceId = seed\.placeId \|\| ''/);
  assert.match(block, /placeId: seed\.placeId \|\| ''/);
});

test('hotel search input is large and touch-friendly', () => {
  assert.match(html, /\.hotel-search-wrap \{[^}]*padding: 4px[^}]*border-radius: 20px/);
  assert.match(html, /\.hotel-search-wrap input \{[^}]*min-height: 58px[^}]*font-size: 16px/);
  assert.match(html, /\.hotel-search-wrap input:focus \{[^}]*transform: translateY\(-1px\)/);
  assert.match(html, /\.hotel-search-icon \{[^}]*font-size: 24px/);
});
