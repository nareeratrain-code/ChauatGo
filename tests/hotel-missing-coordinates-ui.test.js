const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, 'missing start marker: ' + startMarker);
  assert.notEqual(end, -1, 'missing end marker: ' + endMarker);
  return html.slice(start, end);
}

test('hotel coordinate validation rejects missing and invalid values', () => {
  assert.match(html, /function hotelCoordinateIsValid\(value, min, max\)/);
  assert.match(html, /typeof value === 'string' && value\.trim\(\) === ''/);
  assert.match(html, /Number\.isFinite\(number\)/);
  assert.match(html, /return !!place &&[\s\S]*hotelCoordinateIsValid\(place\.lat, -90, 90\)/);
});

test('hotel card disables destination when coordinates are missing', () => {
  const card = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  assert.match(card, /var canSetDestination = hotelHasCoordinates\(p\)/);
  assert.match(card, /hotel-action destination disabled/);
  assert.match(card, /disabled aria-disabled="true"/);
  assert.match(card, /hotel-destination-missing/);
  assert.match(card, /role="status" aria-live="polite"/);
  assert.match(card, /alt="'\+esc\(p\.name\)/);
  assert.doesNotMatch(card, /hotel-action destination disabled[^>]+onclick=/);
});

test('hotel detail disables destination CTA when coordinates are missing', () => {
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(detail, /var canSetDestination = hotelHasCoordinates\(p\)/);
  assert.match(detail, /hotel-detail-missing-coordinate/);
  assert.match(detail, /role="alert" aria-live="assertive"/);
  assert.match(detail, /disabled aria-disabled="true"/);
});

test('destination handler blocks missing coordinates before creating destination state', () => {
  const handler = blockBetween('window.setDestFromPlace = function(placeId)', '\n};');
  assert.match(handler, /if \(!p\) return;/);
  assert.match(handler, /hotelHasCoordinates\(p\)/);
  assert.match(handler, /ที่พักนี้ยังไม่มีพิกัดสำหรับตั้งเป็นปลายทาง/);
  assert.ok(handler.indexOf('hotelHasCoordinates(p)') < handler.indexOf('selectedDestination ='));
  assert.doesNotMatch(handler, /p\.lat\s*\|\|\s*0|p\.lng\s*\|\|\s*0/);
});

test('missing-coordinate CSS remains accessible in light and dark themes', () => {
  assert.match(html, /hotel-action\.destination:disabled/);
  assert.match(html, /hotel-destination-missing \{/);
  assert.match(html, /\[data-theme="dark"\] \.hotel-destination-missing/);
});
