const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return html.slice(start, end);
}

test('Hotel directory has a single mobile-friendly search entry point', () => {
  const hotelTools = blockBetween('<div id="hotel-tools"', '<div id="tourist-tools"');
  assert.match(hotelTools, /ค้นหาโรงแรมและรีสอร์ตได้ทุกอำเภอทุกตำบล/);
  assert.match(hotelTools, /id="hotel-search-input" type="search"/);
  assert.doesNotMatch(hotelTools, /id="hotel-district"/);
  assert.doesNotMatch(hotelTools, /id="hotel-tambon"/);
  assert.match(html, /\.hotel-search-wrap input \{[^}]*min-height: 58px[^}]*font-size: 16px/);
});

test('Hotel cards expose clear call and set-destination actions with touch-safe buttons', () => {
  const cardRenderer = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  assert.match(cardRenderer, /class="hotel-card"/);
  assert.match(cardRenderer, /class="hotel-action call"/);
  assert.match(cardRenderer, /class="hotel-action destination"/);
  assert.ok(cardRenderer.includes('data-place-id="\'+esc(p.id)+\'"'));
  assert.match(cardRenderer, /class="hotel-action destination"[\s\S]*setDestFromPlace/);
  assert.match(cardRenderer, /type="button"/);
  assert.match(html, /\.hotel-action \{[^}]*min-height: 40px/);
});

test('Hotel cards and detail view render a safe fallback when the image is missing', () => {
  const cardRenderer = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(cardRenderer, /var hasImg = hasRealImage\(p\.image\)/);
  assert.match(cardRenderer, /: '<span>🏨<\/span>'/);
  assert.match(detail, /var hasImg = hasRealImage\(p\.image\)/);
  assert.match(detail, /: '<span>🏨<\/span>'/);
  assert.doesNotMatch(cardRenderer, /<img[^>]+src="undefined/);
  assert.doesNotMatch(detail, /<img[^>]+src="undefined/);
});

test('Hotel UI disables destination actions and shows a Thai warning when coordinates are missing', () => {
  const cardRenderer = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(cardRenderer, /var canSetDestination = hotelHasCoordinates\(p\)/);
  assert.match(cardRenderer, /class="hotel-action destination disabled" disabled aria-disabled="true"/);
  assert.match(cardRenderer, /class="hotel-destination-missing" role="status" aria-live="polite"/);
  assert.match(cardRenderer, /ที่พักนี้ยังไม่มีพิกัด จึงยังตั้งเป็นปลายทางไม่ได้/);
  assert.match(detail, /var canSetDestination = hotelHasCoordinates\(p\)/);
  assert.match(detail, /ยังตั้งเป็นปลายทางไม่ได้/);
  assert.match(detail, /class="hotel-destination-missing" role="alert"/);
  assert.match(html, /\.hotel-action\.destination:disabled, \.hotel-action\.destination\.disabled/);
  assert.match(html, /\.hotel-destination-missing \{/);
});

test('Missing-coordinate controls expose an accessible name and description', () => {
  const cardRenderer = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(cardRenderer, /<img src="'\+esc\(p\.image\)\+'" alt="'\+esc\(p\.name\)\+'/);
  assert.match(cardRenderer, /disabled aria-disabled="true" aria-describedby="hotel-missing-coordinate-'\+esc\(p\.id\)\+'/);
  assert.match(cardRenderer, /id="hotel-missing-coordinate-[\s\S]*class="hotel-destination-missing" role="status" aria-live="polite"/);
  assert.doesNotMatch(cardRenderer, /hotel-action destination disabled[^>]+onclick=/);
  assert.match(detail, /disabled aria-disabled="true" aria-describedby="hotel-detail-missing-coordinate"/);
  assert.match(detail, /id="hotel-detail-missing-coordinate" class="hotel-destination-missing" role="alert" aria-live="assertive"/);
});

test('Hotel destination actions retain visible keyboard focus styling', () => {
  assert.match(html, /button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible,[\s\S]*select:focus-visible, \[role="button"\]:focus-visible/);
  assert.match(html, /outline:\s*3px solid/);
  assert.match(html, /outline-offset:\s*3px/);
  assert.match(html, /button:disabled\s*\{[^}]*cursor:\s*not-allowed/);
});

test('Hotel detail gives the rider-destination action a prominent mobile CTA', () => {
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(detail, /class="hotel-detail-hero"/);
  assert.match(detail, /class="hotel-detail-actions"/);
  assert.match(detail, /type="button" onclick="setDestFromPlace/);
  assert.match(detail, /เพิ่มที่พักเป็นปลายทางให้ไรเดอร์/);
  assert.match(detail, /onclick="closeModal\(\)"/);
  assert.match(html, /\.hotel-detail-actions a, \.hotel-detail-actions button \{[^}]*min-height: 48px/);
});

test('Selecting a hotel hands off to the ride destination picker without changing service mode', () => {
  const handler = blockBetween('window.setDestFromPlace = function(placeId)', '\n/* ═══ EXPOSE');
  assert.match(handler, /selectedDestination = \{ lat: p\.lat, lng: p\.lng, address: p\.name, placeId: p\.id \|\| placeId \}/);
  assert.match(handler, /mapPickerMode = 'ride-dest'/);
  assert.match(handler, /closeModal\(\); openMapPage\(true\); setDestSearchMode\(false\)/);
  assert.match(handler, /setDestination\(p\.lat, p\.lng, true, p\.name, p\.id \|\| placeId\)/);
});

test('Selecting an unknown hotel ID is a safe no-op', () => {
  const handler = blockBetween('window.setDestFromPlace = function(placeId)', '\n/* ═══ EXPOSE');
  assert.match(handler, /var p = findHotelById\(placeId\);\s*if \(!p\) return;/);
  assert.ok(handler.indexOf('if (!p) return;') < handler.indexOf("mapPickerMode = 'ride-dest'"));
});

test('Missing hotel coordinates are not silently replaced with fabricated fallback coordinates', () => {
  const handler = blockBetween('window.setDestFromPlace = function(placeId)', '\n/* ═══ EXPOSE');
  const destination = blockBetween('function setDestination(lat, lng,', 'function updateConfirmBtnState');
  assert.match(html, /function hotelCoordinateIsValid\(value, min, max\)/);
  assert.match(html, /typeof value === 'string' && value\.trim\(\) === ''/);
  assert.match(html, /return !!p && hotelCoordinateIsValid\(p\.lat, -90, 90\) && hotelCoordinateIsValid\(p\.lng, -180, 180\)/);
  assert.match(handler, /selectedDestination = \{ lat: p\.lat, lng: p\.lng/);
  assert.match(handler, /setDestination\(p\.lat, p\.lng/);
  assert.doesNotMatch(handler, /p\.lat\s*\|\|\s*0/);
  assert.doesNotMatch(handler, /p\.lng\s*\|\|\s*0/);
  assert.doesNotMatch(destination, /lat\s*\|\|\s*0/);
  assert.doesNotMatch(destination, /lng\s*\|\s*0/);
  assert.match(handler, /if \(!hotelHasCoordinates\(p\)\)/);
  assert.match(handler, /showToast\('ที่พักนี้ยังไม่มีพิกัดสำหรับตั้งเป็นปลายทาง','warning'\)/);
  assert.ok(handler.indexOf('if (!hotelHasCoordinates(p))') < handler.indexOf('selectedDestination ='));
});

test('Missing coordinates do not produce a NaN distance label in Hotel UI', () => {
  const cardRenderer = blockBetween('function renderHotelCardHTML(p)', '\nfunction provinceDistrictNames');
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(cardRenderer, /userLocation && hotelHasCoordinates\(p\) \? ' • 📍 '/);
  assert.match(detail, /userLocation && hotelHasCoordinates\(p\) \? ' • 📍 '/);
});

test('Destination picker hides duplicate search UI after a place is selected', () => {
  const picker = blockBetween('function setDestSearchMode(show)', 'function renderDestSearchResults');
  assert.match(picker, /sheet\.classList\.toggle\('location-picked', !show\)/);
  assert.match(picker, /if \(!show\) hideDestSearchResults\(\)/);
  assert.match(html, /\.dest-search/);
  assert.match(html, /\.location-picked/);
});

test('Choosing a search result preserves its label and place ID before pin confirmation', () => {
  const results = blockBetween('function renderDestSearchResults(items, pending)', 'function searchNominatim');
  assert.match(results, /destHoldAddress = item\.label/);
  assert.match(results, /destHoldPlaceId = item\.placeId \|\| ''/);
  assert.match(results, /if \(\$\('dest-search-input'\)\) \$\('dest-search-input'\)\.value = item\.label/);
  assert.match(results, /setDestSearchMode\(false\)/);
  assert.match(results, /panPinTo\(item\.lat, item\.lng, 17\)/);
});

test('Hotel destination UI preserves the selected name and coordinates for the map pin', () => {
  const destination = blockBetween('function setDestination(lat, lng,', 'function updateConfirmBtnState');
  assert.match(destination, /if \(address\) destHoldAddress = address/);
  assert.match(destination, /destHoldPlaceId = placeId \|\| ''/);
  assert.match(destination, /address: address \|\| ''/);
  assert.match(destination, /placeId: placeId \|\| ''/);
  assert.match(html, /function scheduleReverseGeocode\(lat, lng\)/);
  assert.match(html, /selectedDestination\.placeId/);
});

test('Hotel destination screen does not introduce room-booking form fields', () => {
  const hotelTools = blockBetween('<div id="hotel-tools"', '<div id="tourist-tools"');
  assert.doesNotMatch(hotelTools, /check[-_ ]?in|check[-_ ]?out|room(Type|Count)|จำนวนห้อง|วันที่เข้าพัก/i);
});

test('Focused Hotel UI can close and return to the home view', () => {
  const category = blockBetween('window.showCategory = function(cat)', 'window.showAllCategories = function(cat)');
  assert.match(category, /setMenuFocus\(true\)/);
  assert.match(html, /window\.closeCategoryView = function\(\)/);
  assert.match(html, /setMenuFocus\(false\)/);
  assert.match(html, /onclick="closeCategoryView\(\)"/);
});
