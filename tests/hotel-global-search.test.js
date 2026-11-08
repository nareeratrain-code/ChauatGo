const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function createMapRaceRuntime() {
  const scheduleStart = html.indexOf('function scheduleReverseGeocode(lat, lng)');
  const onMoveStart = html.indexOf('function onDestMapMoveEnd()', scheduleStart);
  const onMoveEnd = html.indexOf('\nfunction updateDestEstimate()', onMoveStart);
  const scheduleSource = html.slice(scheduleStart, onMoveStart);
  const onMoveSource = html.slice(onMoveStart, onMoveEnd);
  const timers = [];
  const requests = [];
  const updates = [];
  const elements = {
    'map-page': { classList: { contains: (name) => name === 'show' } },
    'map-center-pin': { classList: { remove() {} } },
    'dest-address': { dataset: {} },
    'dest-rider-note': { value: '' },
  };
  let pin = { lat: 7.9, lng: 99.9 };
  let nextTimer = 0;
  const context = {
    console,
    Math,
    isFinite,
    setTimeout(fn) {
      const timer = { id: ++nextTimer, fn, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cancelled = true;
    },
    $(id) { return elements[id] || null; },
    showDestAddress(label, point) {
      updates.push({ label, point });
      elements['dest-address'].dataset.address = label;
    },
    nominatimFetch(url) {
      return new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
    },
    shortNominatimAddress() { return 'ผล reverse ใหม่'; },
    destinationLabelForPoint() { return 'ใกล้เคียง จุดใหม่'; },
    readPinLatLng() { return pin; },
    updateConfirmBtnState() {},
    updateDestEstimate() {},
    selectedDestination: null,
    destHoldAddress: '',
    destHoldPlaceId: '',
    destGeocodeTimer: null,
    destGeocodeToken: 0,
    mapOpenToken: 1,
  };
  vm.createContext(context);
  vm.runInContext(`
    var selectedDestination = null;
    var destHoldAddress = '';
    var destHoldPlaceId = '';
    var destGeocodeTimer = null;
    var destGeocodeToken = 0;
    var mapOpenToken = 1;
    ${scheduleSource}
    ${onMoveSource}
  `, context);
  return {
    context,
    requests,
    updates,
    elements,
    setPin(next) { pin = next; },
    runTimers() {
      const due = timers.splice(0, timers.length).filter((timer) => !timer.cancelled);
      due.forEach((timer) => timer.fn());
    },
  };
}

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
  const start = html.indexOf("destHoldAddress = seed.address || ''", html.indexOf('if (seed && isFinite(seed.lat)'));
  assert.notEqual(start, -1);
  const block = html.slice(start, start + 420);
  assert.match(block, /destHoldPlaceId = seed\.placeId \|\| ''/);
  assert.match(block, /placeId: seed\.placeId \|\| ''/);
});

test('hotel placeId is staged before map initialization can emit moveend', () => {
  const start = html.indexOf('var seed = mapPickerSeed();');
  const end = html.indexOf('var token = ++mapOpenToken;', start);
  const block = html.slice(start, end);
  assert.match(block, /destHoldAddress = seed && seed\.address \|\| ''/);
  assert.match(block, /destHoldPlaceId = seed && seed\.placeId \|\| ''/);
});

test('runtime ignores reverse-geocode responses from a closed map session', async () => {
  const runtime = createMapRaceRuntime();
  runtime.context.scheduleReverseGeocode(7.9, 99.9);
  runtime.runTimers();
  assert.equal(runtime.requests.length, 1);
  const updatesBeforeClose = runtime.updates.length;
  runtime.context.mapOpenToken = 2;
  runtime.elements['map-page'].classList.contains = () => false;
  runtime.context.destGeocodeToken += 1;
  runtime.requests[0].resolve({});
  await Promise.resolve();
  assert.equal(runtime.updates.length, updatesBeforeClose);
});

test('runtime ignores a stale reverse-geocode response after a new map session opens', async () => {
  const runtime = createMapRaceRuntime();
  runtime.context.scheduleReverseGeocode(7.9, 99.9);
  runtime.runTimers();
  assert.equal(runtime.requests.length, 1);
  runtime.context.mapOpenToken = 2;
  runtime.context.selectedDestination = { lat: 8.1, lng: 100.1, address: 'โรงแรมใหม่', placeId: 'hotel-new' };
  runtime.requests[0].resolve({});
  await Promise.resolve();
  assert.equal(runtime.updates.at(-1).label, 'กำลังหาที่อยู่...');
  assert.equal(runtime.context.selectedDestination.address, 'โรงแรมใหม่');
});

test('runtime ignores moveend from a map that is no longer visible', () => {
  const runtime = createMapRaceRuntime();
  runtime.elements['map-page'].classList.contains = () => false;
  runtime.context.selectedDestination = { lat: 8.1, lng: 100.1, address: 'ปลายทางเดิม', placeId: 'hotel-old' };
  runtime.context.destHoldAddress = 'ปลายทางเก่า';
  runtime.context.destHoldPlaceId = 'hotel-old';
  runtime.setPin({ lat: 7.9, lng: 99.9 });
  runtime.context.onDestMapMoveEnd();
  assert.deepEqual(runtime.context.selectedDestination, { lat: 8.1, lng: 100.1, address: 'ปลายทางเดิม', placeId: 'hotel-old' });
});

test('hotel search input is large and touch-friendly', () => {
  assert.match(html, /\.hotel-search-wrap \{[^}]*padding: 4px[^}]*border-radius: 20px/);
  assert.match(html, /\.hotel-search-wrap input \{[^}]*min-height: 58px[^}]*font-size: 16px/);
  assert.match(html, /\.hotel-search-wrap input:focus \{[^}]*transform: translateY\(-1px\)/);
  assert.match(html, /\.hotel-search-icon \{[^}]*font-size: 24px/);
});
