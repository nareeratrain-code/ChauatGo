const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const lib = require('../scripts/osm-places-lib');

function el(tags, extra) {
  return Object.assign({ type: 'node', id: extra && extra.id || 1, lat: 8.4, lon: 99.96, tags: tags }, extra || {});
}

test('prefers Thai name and maps landmark categories', () => {
  const temple = lib.compactPlace(el({
    'name:en': 'Wat Phra Mahathat',
    'name:th': 'วัดพระมหาธาตุวรมหาวิหาร',
    amenity: 'place_of_worship',
    religion: 'buddhist'
  }, { id: 10 }), 'เมืองนครศรีธรรมราช');
  assert.equal(temple.n, 'วัดพระมหาธาตุวรมหาวิหาร');
  assert.equal(temple.c, 'w');
  assert.equal(temple.d, 'เมืองนครศรีธรรมราช');

  const beach = lib.compactPlace(el({ name: 'หาดขนอม', natural: 'beach' }, { id: 11 }), 'ขนอม');
  assert.equal(beach.c, 't');
  const view = lib.compactPlace(el({ name: 'จุดชมวิวเขาหลวง', tourism: 'viewpoint' }, { id: 12 }), 'ลานสกา');
  assert.equal(view.c, 'v');
  const hotel = lib.compactPlace(el({
    'name:th': 'โฮมสเตย์บ้านสวน',
    tourism: 'guest_house',
    phone: '0812345678',
    website: 'https://example.test'
  }, { id: 13 }), 'สิชล');
  assert.equal(hotel.c, 'h');
  assert.equal(hotel.ph, '0812345678');
  assert.equal(hotel.web, 'https://example.test');
  const hospital = lib.compactPlace(el({ name: 'โรงพยาบาลมหาราชนครศรีธรรมราช', amenity: 'hospital' }, { id: 14 }), 'เมืองนครศรีธรรมราช');
  assert.equal(hospital.c, 'l');
});

test('drops unnamed, private, and residential rows', () => {
  assert.equal(lib.compactPlace(el({ amenity: 'restaurant', phone: '081', website: 'https://a.test', cuisine: 'thai' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'นายธีระวัช เมืองทองอ่อน', tourism: 'hotel' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'ขวัญฤทัย ยอดราช', building: 'house' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'บ้าน / ที่อยู่อาศัย', building: 'residential' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'บ้านบุริมนาถ ศรีสุขใส', building: 'house' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'บ้านสวน', building: 'house' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'บ้านส่วนตัว', access: 'private' }), 'ชะอวด'), null);
  assert.equal(lib.compactPlace(el({ name: 'บ้านพักโรงพยาบาล', amenity: 'hospital' }), 'ร่อนพิบูลย์'), null);
  const stay = lib.compactPlace(el({ name: 'บ้านสวนรีสอร์ท', tourism: 'hotel' }), 'ขนอม');
  assert.equal(stay && stay.c, 'h');
});

test('keeps notable restaurants and caps them per district', () => {
  const tiny = lib.compactPlace(el({ name: 'ร้านก๋วยเตี๋ยว', amenity: 'restaurant' }, { id: 20 }), 'สิชล');
  assert.equal(tiny.c, 'r');
  assert.ok(tiny.score < lib.FOOD_SCORE_MIN);
  assert.equal(lib.compactPlace(el({ name: 'Food stalls', amenity: 'fast_food' }, { id: 22 }), 'สิชล'), null);
  const known = lib.compactPlace(el({
    name: 'ร้านอาหารเขาหลวง',
    amenity: 'restaurant',
    wikidata: 'Q1',
    website: 'https://example.test',
    cuisine: 'thai'
  }, { id: 21 }), 'ลานสกา');
  assert.equal(known.c, 'r');
  assert.ok(lib.foodScore({ wikidata: 'Q1', website: 'https://example.test', cuisine: 'thai', amenity: 'restaurant', name: 'x' }) >= 3);

  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({
      n: 'ร้าน ' + i,
      c: 'r',
      lat: 8.4,
      lng: 99.9 + i * 0.01,
      i: 'n' + (1000 + i),
      d: 'สิชล',
      score: 3 + (i % 5),
      ph: '0800000000'
    });
  }
  many.push({
    n: 'ร้านมีวิกิ',
    c: 'r',
    lat: 9.1,
    lng: 99.8,
    i: 'n9',
    d: 'สิชล',
    score: 9
  });
  const limited = lib.limitFood(many);
  const sichon = limited.filter((p) => p.d === 'สิชล' && p.c === 'r');
  assert.equal(sichon.length, lib.FOOD_CAP.r);
  assert.ok(sichon.some((p) => p.n === 'ร้านมีวิกิ'));
  const sparse = lib.limitFood([
    { n: 'ร้านเล็ก', c: 'r', lat: 8.1, lng: 99.2, i: 'n1', d: 'ฉวาง', score: 0 },
    { n: 'คาเฟ่เล็ก', c: 'f', lat: 8.2, lng: 99.2, i: 'n2', d: 'ฉวาง', score: 1 }
  ]);
  assert.equal(sparse.length, 2);
});

test('dedupes the same place mapped twice', () => {
  const places = lib.dedupePlaces([
    { n: 'วัดพระมหาธาตุ', c: 'w', lat: 8.4108, lng: 99.9662, i: 'n1', d: 'เมืองนครศรีธรรมราช', score: 4 },
    { n: 'วัดพระมหาธาตุ', c: 'w', lat: 8.411, lng: 99.9664, i: 'w2', d: 'เมืองนครศรีธรรมราช', score: 9 },
    { n: 'วัดพระมหาธาตุ', c: 'w', lat: 8.9, lng: 99.9, i: 'n3', d: 'ท่าศาลา', score: 4 }
  ]);
  assert.equal(places.length, 2);
  assert.equal(places[0].i, 'w2');
});

test('point in polygon assigns the smaller district', () => {
  const big = {
    type: 'relation',
    id: 1,
    tags: { name: 'อำเภอใหญ่' },
    members: [{
      type: 'way',
      role: 'outer',
      geometry: [
        { lon: 99, lat: 8 }, { lon: 100, lat: 8 }, { lon: 100, lat: 9 }, { lon: 99, lat: 9 }, { lon: 99, lat: 8 }
      ]
    }]
  };
  const small = {
    type: 'relation',
    id: 2,
    tags: { name: 'อำเภอชะอวด' },
    members: [{
      type: 'way',
      role: 'outer',
      geometry: [
        { lon: 99.9, lat: 7.9 }, { lon: 100.1, lat: 7.9 }, { lon: 100.1, lat: 8.1 }, { lon: 99.9, lat: 8.1 }, { lon: 99.9, lat: 7.9 }
      ]
    }]
  };
  const districts = [lib.prepareDistrict(big), lib.prepareDistrict(small)];
  assert.equal(lib.assignDistrict(8.0, 100.0, districts), 'ชะอวด');
  assert.equal(lib.assignDistrict(8.5, 99.5, districts), 'ใหญ่');
  assert.equal(lib.assignDistrict(10, 99.5, districts), '');
});

test('committed province file matches the app catalog shape', () => {
  const file = path.join(__dirname, '..', 'data', 'nst-places.json');
  assert.equal(fs.existsSync(file), true, 'run node scripts/fetch-osm-places.js');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.license, 'ODbL-1.0');
  assert.equal(doc.attribution, '© OpenStreetMap contributors');
  assert.equal(doc.area, 'จังหวัดนครศรีธรรมราช');
  assert.equal(doc.provinceRelation, 1908792);
  assert.ok(doc.districts.length >= 23);
  assert.ok(doc.places.length > 100);
  const counts = lib.countPlaces(doc.places);
  assert.deepEqual(doc.counts.byCategory, counts.byCategory);
  assert.deepEqual(doc.counts.byDistrict, counts.byDistrict);
  assert.equal(doc.counts.total, doc.places.length);
  const ids = new Set();
  const blocked = ['ขวัญฤทัยยอดราช', 'นายธีระวัชเมืองทองอ่อน', 'บ้านบุริมนาถศรีสุขใส', 'ที่อยู่อาศัย'];
  doc.places.forEach((place) => {
    assert.equal(typeof place.n, 'string');
    assert.ok(place.n.trim().length >= 2);
    assert.ok('wflmothvtkegbiopx'.includes(place.c) || 'rc'.includes(place.c));
    assert.equal(Number.isFinite(place.lat), true);
    assert.equal(Number.isFinite(place.lng), true);
    assert.ok(place.d);
    assert.equal(ids.has(place.i), false);
    ids.add(place.i);
    const folded = lib.foldName(place.n);
    blocked.forEach((name) => assert.notEqual(folded, name));
    assert.equal(/^นาย|^นางสาว|^นาง(?:\s|$)|^(?:ด\.?\s*ช|เด็กชาย|เด็กหญิง)/.test(place.n), false);
  });
  assert.ok(doc.places.some((p) => /มหาธาตุ/.test(p.n)));
  assert.ok(doc.places.some((p) => p.d === 'ขนอม' && (p.c === 't' || p.c === 'h' || p.c === 'v')));
  assert.ok(doc.places.some((p) => p.d === 'ชะอวด'));
  const bytes = fs.statSync(file).size;
  assert.ok(bytes < 900000, 'province file should stay under 900KB, got ' + bytes);
  const chauat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chauat-places.json'), 'utf8'));
  assert.equal(chauat.osmRelation, 18989358);
  assert.ok(Array.isArray(chauat.places) && chauat.places.length > 0);
});
