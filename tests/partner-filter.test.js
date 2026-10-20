const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const start = indexHtml.indexOf('function haversine(');
const endMarker = '\nfunction restaurantType(';
const end = indexHtml.indexOf(endMarker, start);
assert.notEqual(start, -1, 'haversine/isPartnerRestaurant source not found');
assert.notEqual(end, -1, 'isPartnerRestaurant end marker not found');

const context = {
  nearbyShopsCache: [],
  Math,
  Number,
  String,
  isFinite,
};
vm.createContext(context);
vm.runInContext(indexHtml.slice(start, end), context, { filename: 'index.html#partner-filter' });

function setPartners(...shops) {
  context.nearbyShopsCache = shops;
}

function place(name, lat = 7.950000, lng = 99.995000, id = 'LOC-001') {
  return { id, name, lat, lng };
}

function partner(name, lat = 7.950000, lng = 99.995000, extra = {}) {
  return { id: 'merchant-1', name, category: 'restaurant', lat, lng, ...extra };
}

function assertPartner(label, candidate, expected) {
  const actual = context.isPartnerRestaurant(candidate);
  assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
}

test('matches the same placeId even when coordinates are far apart', () => {
  setPartners(partner('ร้านหนึ่ง', 8.100000, 100.100000, { placeId: 'LOC-001' }));
  assertPartner('same placeId', place('คนละชื่อ', 7.900000, 99.900000, 'LOC-001'), true);
});

test('does not match a non-food partner category', () => {
  setPartners({ ...partner('ร้านเดียวกัน'), category: 'hotel' });
  assertPartner('hotel category', place('ร้านเดียวกัน'), false);
});

test('does not hide a different-name restaurant within 149 metres', () => {
  // Approximately 149 m east of the partner at latitude 7.95.
  setPartners(partner('ร้านข้าวแกงป้าแดง', 7.950000, 99.996347));
  assertPartner('149 m, different name', place('ร้านกาแฟริมคลอง'), false);
});

test('does not hide a different-name restaurant at exactly 150 metres', () => {
  // Approximately 150 m east of the partner at latitude 7.95.
  setPartners(partner('ร้านข้าวแกงป้าแดง', 7.950000, 99.996356));
  assertPartner('150 m boundary', place('ร้านกาแฟริมคลอง'), false);
});

test('does not hide a different-name restaurant beyond 150 metres', () => {
  // Approximately 151 m east of the partner at latitude 7.95.
  setPartners(partner('ร้านข้าวแกงป้าแดง', 7.950000, 99.996365));
  assertPartner('151 m, different name', place('ร้านกาแฟริมคลอง'), false);
});

test('does not hide a similar but different name through substring matching', () => {
  setPartners(partner('ครัวป้าสมใจ'));
  assertPartner('ครัวป้าสมใจหน้าตลาด', place('ครัวป้าสมใจหน้าตลาด', 7.950000, 99.995000), false);
});

test('does not hide a short name contained in a longer unrelated name', () => {
  setPartners(partner('บ้านสวน'));
  assertPartner('บ้านสวนริมคลอง', place('บ้านสวนริมคลอง', 7.950000, 99.995000), false);
});

test('normalization removes labels such as ร้านอาหาร and สาขา', () => {
  setPartners(partner('ร้านอาหาร บ้านสวน'));
  assertPartner('normalized equivalent name', place('บ้านสวน', 7.950000, 99.995000), true);
});

test('does not hide exact normalized names when coordinates are unavailable', () => {
  setPartners({ id: 'merchant-1', name: 'ร้านกาแฟบ้านสวน', category: 'restaurant' });
  assertPartner('same normalized name, no coordinates', { id: 'LOC-001', name: 'ร้านกาแฟบ้านสวน' }, false);
});

test('does not hide different businesses at the same coordinates', () => {
  setPartners(partner('ร้านอาหารในตลาด', 7.950000, 99.995000));
  assertPartner('same coordinates, different name', place('ร้านกาแฟในตลาด'), false);
});

test('requires precise coordinates for exact normalized-name fallback', () => {
  setPartners(partner('ร้านกาแฟบ้านสวน', 7.950000, 99.995000));
  assertPartner('30 m or closer', place('ร้านกาแฟบ้านสวน', 7.950000, 99.995270), true);
  assertPartner('beyond 30 m', place('ร้านกาแฟบ้านสวน', 7.950000, 99.995400), false);
});

test('does not hide a same-name shop when partner category is unsupported', () => {
  setPartners({ ...partner('ร้านกาแฟบ้านสวน'), category: 'food' });
  assertPartner('unsupported food category', place('ร้านกาแฟบ้านสวน'), false);
});
