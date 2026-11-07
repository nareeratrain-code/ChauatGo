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
