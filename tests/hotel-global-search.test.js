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

test('choosing a hotel destination opens ride booking with that place, not the hotel GPS panel', () => {
  const start = html.indexOf('window.setDestFromPlace = function(placeId)');
  const end = html.indexOf('\n};', start) + 3;
  const block = html.slice(start, end);
  assert.match(block, /selectedDestination = \{ lat: Number\(p\.lat\), lng: Number\(p\.lng\), address: p\.name, placeId: p\.id \|\| placeId \}/);
  assert.match(block, /to: p\.name \|\| ''/);
  assert.match(block, /selectedVehicle = null/);
  assert.match(block, /openRideOrderForm\(\{ missing: true \}\)/);
  assert.match(block, /classList\.remove\('hotel-place-selected'\)/);
  assert.equal(block.includes('openMapPage'), false);
  assert.equal(block.includes("classList.add('hotel-place-selected')"), false);
  const cardStart = html.indexOf('function renderHotelCardHTML');
  const card = html.slice(cardStart, html.indexOf('function provinceDistrictNames', cardStart));
  assert.match(card, /class="hotel-action destination"/);
  assert.match(card, /ค้นหา Agoda/);
  assert.equal(card.includes('callHotelById'), false);
  assert.equal(card.includes('>📞 โทร<'), false);
  assert.match(html, /\.hotel-card-actions \{[^}]*grid-template-columns: 1fr 1\.15fr/);
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

test('hotel search is first and the GPS panel stays off the hotel screen', () => {
  const toolsStart = html.indexOf('<div id="hotel-tools"');
  const toolsEnd = html.indexOf('</div>\n    <div id="tourist-tools"', toolsStart);
  const tools = html.slice(toolsStart, toolsEnd);
  assert.ok(tools.indexOf('id="hotel-search-input"') < tools.indexOf('class="reference-loc-bar hotel-location-tools"'));
  assert.match(html, /#hotel-tools \.hotel-location-tools \{ display: none; \}/);
  assert.match(html, /classList\.remove\('hotel-place-selected'\)/);
  assert.equal(html.includes("classList.add('hotel-place-selected')"), false);
});
