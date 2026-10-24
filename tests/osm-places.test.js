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

test('keeps every named restaurant and drops only generic names', () => {
  const tiny = lib.compactPlace(el({ name: 'ร้านก๋วยเตี๋ยว', amenity: 'restaurant' }, { id: 20 }), 'สิชล');
  assert.equal(tiny.c, 'r');
  assert.equal(lib.compactPlace(el({ name: 'Food stalls', amenity: 'fast_food' }, { id: 22 }), 'สิชล'), null);
  assert.equal(lib.compactPlace(el({ name: 'ร้านอาหาร', amenity: 'restaurant' }, { id: 23 }), 'สิชล'), null);
  const known = lib.compactPlace(el({
    name: 'ร้านอาหารเขาหลวง',
    amenity: 'restaurant',
    wikidata: 'Q1',
    website: 'https://example.test',
    cuisine: 'thai'
  }, { id: 21 }), 'ลานสกา');
  assert.equal(known.c, 'r');
  const many = [tiny, known];
  for (let i = 0; i < 30; i++) {
    many.push(lib.compactPlace(el({
      name: 'ร้านทดสอบ ' + i,
      amenity: i % 2 ? 'cafe' : 'restaurant'
    }, { id: 200 + i, lat: 8.4 + i * 0.01, lon: 99.9 }), 'สิชล'));
  }
  const kept = lib.finalizePlaces(many);
  assert.equal(kept.length, many.length);
  assert.ok(kept.every((place) => place.q && place.score === undefined));
});

test('search keys ignore spaces, punctuation, and Thai tone marks', () => {
  const chedi = lib.finalizePlaces([lib.compactPlace(el({
    name: 'วัดเจดีย์ (ไอ้ไข่)',
    amenity: 'place_of_worship'
  }, { id: 77 }), 'สิชล')])[0];
  assert.equal(chedi.n, 'วัดเจดีย์ (ไอ้ไข่)');
  assert.equal(chedi.hl, 'tv');
  assert.equal(chedi.q.includes(lib.searchKey('ไอไข่')), true);
  assert.equal(chedi.q.includes(lib.searchKey('ไอ้ไข่')), true);

  const mahathat = lib.finalizePlaces([lib.compactPlace(el({
    name: 'วัดพระมหาธาตุ วรมหาวิหาร',
    amenity: 'place_of_worship',
    'name:en': 'Wat Phra Mahathat'
  }, { id: 78 }), 'เมืองนครศรีธรรมราช')])[0];
  assert.ok(mahathat.hl.includes('t'));
  assert.equal(mahathat.q.includes(lib.searchKey('วัดพระมหาธาตุ')), true);
  assert.equal(mahathat.q.includes('watphramahathat'), true);

  const kitchen = lib.compactPlace(el({ name: 'ครัวนายหนัง\u200b', amenity: 'restaurant' }, { id: 79 }), 'เมืองนครศรีธรรมราช');
  assert.equal(kitchen.n, 'ครัวนายหนัง');
  assert.equal(/[\u200B-\u200D\uFEFF]/.test(kitchen.n), false);
});

test('classifies transport, malls, and drops route relations', () => {
  assert.equal(lib.compactPlace(el({
    name: 'Khanom to Nakhon Si Thammarat via Airport',
    route: 'bus',
    type: 'route'
  }, { id: 80, type: 'relation' }), 'ขนอม'), null);
  assert.equal(lib.compactPlace(el({
    name: 'Khanom to Nakhon Si Thammarat via Airport',
    amenity: 'bus_station'
  }, { id: 80 }), 'ขนอม'), null);
  const namedAirport = lib.compactPlace(el({
    name: 'ท่าอากาศยานนครศรีธรรมราช',
    iata: 'NST',
    aerodrome: 'domestic'
  }, { id: 93 }), 'เมืองนครศรีธรรมราช');
  assert.equal(namedAirport.c, 'tr');
  assert.equal(namedAirport.k, 'airport');
  const air = lib.compactPlace(el({
    name: 'ท่าอากาศยานนครศรีธรรมราช',
    aeroway: 'aerodrome',
    iata: 'NST',
    'name:en': 'Nakhon Si Thammarat Airport'
  }, { id: 81 }), 'เมืองนครศรีธรรมราช');
  assert.equal(air.c, 'tr');
  assert.equal(air.k, 'airport');
  assert.equal(air.q.includes('nst'), true);
  assert.equal(lib.compactPlace(el({
    name: 'สนามบินส่วนตัว',
    aeroway: 'aerodrome',
    aerodrome: 'private'
  }, { id: 85 }), 'เมืองนครศรีธรรมราช'), null);
  const mall = lib.compactPlace(el({ name: 'เซ็นทรัลนครศรี', shop: 'mall' }, { id: 82 }), 'เมืองนครศรีธรรมราช');
  assert.equal(mall.c, 'ml');
  const lotus = lib.compactPlace(el({ name: 'โลตัส', shop: 'supermarket', brand: "Lotus's" }, { id: 83 }), 'ทุ่งสง');
  assert.equal(lotus.c, 'ml');
  const grocery = lib.compactPlace(el({ name: 'ร้านโชห่วย', shop: 'supermarket' }, { id: 84 }), 'ชะอวด');
  assert.equal(grocery.c, 's');
  const ev = lib.compactPlace(el({ name: 'สถานีชาร์จ EA', amenity: 'charging_station' }, { id: 86 }), 'เมืองนครศรีธรรมราช');
  assert.equal(ev.c, 'g');
  assert.equal(ev.k, 'ev');
  const atm = lib.compactPlace(el({ amenity: 'atm', brand: 'กสิกรไทย' }, { id: 90 }), 'เมืองนครศรีธรรมราช');
  assert.equal(atm && atm.n, 'ตู้เอทีเอ็ม กสิกรไทย');
  assert.equal(atm && atm.c, 'b');
  const bareEv = lib.compactPlace(el({ amenity: 'charging_station', operator: 'EA Anywhere' }, { id: 91 }), 'ทุ่งสง');
  assert.equal(bareEv && bareEv.n, 'สถานีชาร์จ EA Anywhere');
  assert.equal(bareEv && bareEv.k, 'ev');
  assert.equal(lib.compactPlace(el({ amenity: 'atm' }, { id: 92 }), 'เมืองนครศรีธรรมราช'), null);
  const rail = lib.compactPlace(el({ name: 'ชุมทางทุ่งสง', railway: 'station' }, { id: 87 }), 'ทุ่งสง');
  assert.equal(rail.c, 'tr');
  assert.equal(rail.k, 'rail');
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

test('merges bracket variants within 500 m and keeps identical names farther apart', () => {
  const merged = lib.finalizePlaces([
    { n: 'วัดเจดีย์ (ไอ้ไข่)', c: 'w', lat: 8.91141, lng: 99.84537, i: 'w1336289881', d: 'สิชล', score: 8, q: '' },
    { n: 'วัดเจดีย์ ไอ้ไข่', c: 'w', lat: 8.91123, lng: 99.848, i: 'n5387111612', d: 'สิชล', score: 4, q: '' }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].n, 'วัดเจดีย์ (ไอ้ไข่)');
  assert.ok(merged[0].hl.includes('t') && merged[0].hl.includes('v'));

  const english = lib.compactPlace(el({
    name: 'Wat Chedi Ai Kai',
    amenity: 'place_of_worship'
  }, { id: 5387111612, lat: 8.91123, lon: 99.848 }), 'สิชล');
  const thai = lib.compactPlace(el({
    name: 'วัดเจดีย์ (ไอ้ไข่)',
    amenity: 'place_of_worship'
  }, { id: 1336289881, lat: 8.91141, lon: 99.84537, type: 'way' }), 'สิชล');
  assert.equal(english.n, 'วัดเจดีย์ (ไอ้ไข่)');
  const oneTemple = lib.finalizePlaces([english, thai]);
  assert.equal(oneTemple.length, 1);
  assert.equal(oneTemple[0].n, 'วัดเจดีย์ (ไอ้ไข่)');

  const brands = lib.finalizePlaces([
    { n: 'ปตท.', c: 'g', lat: 8.4, lng: 99.9, i: 'n1', d: 'เมืองนครศรีธรรมราช', score: 2, q: '' },
    { n: 'ปตท.', c: 'g', lat: 8.4036, lng: 99.9, i: 'n2', d: 'เมืองนครศรีธรรมราช', score: 2, q: '' }
  ]);
  assert.equal(brands.length, 2);
  assert.ok(lib.haversineKm(8.4, 99.9, 8.4036, 99.9) > 0.15);
  assert.ok(lib.haversineKm(8.4, 99.9, 8.4036, 99.9) < 0.5);
});

test('classifies apartments, resorts, artwork, and historic sites', () => {
  assert.equal(lib.classify({ tourism: 'apartment' }, 'อพาร์ตเมนต์สวน'), 'h');
  assert.equal(lib.classify({ leisure: 'resort' }, 'รีสอร์ทเขา'), 'h');
  assert.equal(lib.classify({ building: 'hotel' }, 'โรงแรมทดสอบ'), 'h');
  assert.equal(lib.classify({ tourism: 'artwork' }, 'ประติมากรรมหาด'), 't');
  assert.equal(lib.classify({ tourism: 'picnic_site' }, 'ลานปิกนิก'), 't');
  assert.equal(lib.classify({ historic: 'ruins' }, 'เมืองเก่า'), 't');
  assert.equal(lib.classify({ boundary: 'national_park' }, 'อุทยานแห่งชาติเขาหลวง'), 't');
  const row = lib.finalizePlaces([lib.compactPlace(el({ name: 'อพาร์ตเมนต์สวน', tourism: 'apartment' }, { id: 301 }), 'เมืองนครศรีธรรมราช')])[0];
  assert.equal(row.src, 'osm');
  assert.equal(row.lic, 'ODbL');
});

test('tambon centroid stays inside the polygon', () => {
  const area = lib.prepareDistrict({
    type: 'relation',
    id: 9,
    tags: { name: 'ตำบลทดสอบ' },
    members: [{
      type: 'way',
      role: 'outer',
      geometry: [
        { lon: 99, lat: 8 }, { lon: 100, lat: 8 }, { lon: 100, lat: 9 }, { lon: 99, lat: 9 }, { lon: 99, lat: 8 }
      ]
    }]
  }, /^ตำบล/);
  assert.equal(area.name, 'ทดสอบ');
  const point = lib.interiorPoint(area);
  assert.equal(lib.containsDistrict(area, point.lng, point.lat), true);
});

test('merges the same stay within 300 m and prefers a precise pin', () => {
  const osm = { n: 'บ้านสวนรีสอร์ท', c: 'h', lat: 8.4, lng: 99.9, i: 'n1', d: 'สิชล', src: 'osm', lic: 'ODbL', t: 'เสาเถา', q: 'บ้านสวนรีสอร์ท' };
  const approx = { n: 'บ้านสวนรีสอร์ท', c: 'h', lat: 8.45, lng: 99.95, i: 'tat1', d: 'สิชล', src: 'tat', lic: 'ODC', ax: 1, t: 'เสาเถา', ph: '0812345678', q: 'บ้านสวนรีสอร์ท' };
  const merged = lib.mergeIncoming([Object.assign({}, osm)], [approx]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].lat, 8.4);
  assert.equal(merged[0].src, 'osm');
  assert.equal(merged[0].ph, '0812345678');
  assert.equal(merged[0].ax, undefined);
  const alone = lib.mergeIncoming([], [Object.assign({}, approx)]);
  assert.equal(alone.length, 1);
  assert.equal(alone[0].ax, 1);
  const twoApprox = lib.mergeIncoming(
    [Object.assign({}, approx, { i: 'tat1', t: 'เสาเถา' })],
    [Object.assign({}, approx, { i: 'tat2', t: 'สิชล', lat: 8.52, lng: 99.9 })]
  );
  assert.equal(twoApprox.length, 2);
  const far = lib.mergeIncoming(
    [Object.assign({}, osm)],
    [Object.assign({}, approx, { n: 'รีสอร์ทคนละชื่อ', lat: 8.401, lng: 99.901, ax: undefined })]
  );
  assert.equal(far.length, 2);
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

test('committed province files match the split catalog shape', () => {
  const root = path.join(__dirname, '..', 'data', 'nst');
  const indexPath = path.join(root, 'index.json');
  const legacy = path.join(__dirname, '..', 'data', 'nst-places.json');
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(indexPath), true, 'run node scripts/fetch-osm-places.js');
  const doc = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(doc.license, 'mixed');
  assert.ok(/OpenStreetMap contributors/.test(doc.attribution));
  assert.ok(/Wikidata/.test(doc.attribution));
  assert.ok(/Open Data Common/.test(doc.attribution));
  assert.ok(/COD-AB/.test(doc.attribution));
  assert.ok(doc.attributions.some((row) => row.src === 'osm' && row.lic === 'ODbL'));
  assert.ok(doc.attributions.some((row) => row.src === 'wd' && row.lic === 'CC0'));
  assert.ok(doc.attributions.some((row) => row.src === 'tat' && row.lic === 'ODC'));
  assert.equal(doc.area, 'จังหวัดนครศรีธรรมราช');
  assert.equal(doc.provinceRelation, 1908792);
  assert.ok(doc.districts.length >= 23);
  assert.ok(Array.isArray(doc.missingFromOsm));
  assert.ok(doc.coverage.tambons >= 140);
  assert.equal(
    doc.coverage.tambonsWithAccommodation + doc.coverage.tambonsWithoutAccommodation.length,
    doc.coverage.tambons
  );
  const allowed = new Set('r f c m q t h s u a d n j z w g b e o x l p y i k v tr ml'.split(' '));
  const places = [];
  const ids = new Set();
  const blocked = ['ขวัญฤทัยยอดราช', 'นายธีระวัชเมืองทองอ่อน', 'บ้านบุริมนาถศรีสุขใส', 'ที่อยู่อาศัย'];
  let totalBytes = fs.statSync(indexPath).size;
  let largest = 0;
  doc.districts.forEach((meta) => {
    assert.match(meta.file, /^[a-z0-9-]+\.json$/);
    const full = path.join(root, meta.file);
    const bytes = fs.statSync(full).size;
    totalBytes += bytes;
    if (bytes > largest) largest = bytes;
    const body = JSON.parse(fs.readFileSync(full, 'utf8'));
    assert.equal(body.d, meta.n);
    assert.ok(/OpenStreetMap contributors/.test(body.attribution));
    assert.ok(Array.isArray(meta.tambons) && meta.tambons.length > 0);
    assert.equal(body.places.length, meta.count);
    body.places.forEach((place) => {
      assert.equal(place.d, meta.n);
      assert.ok(place.src === 'osm' || place.src === 'wd' || place.src === 'tat');
      assert.ok(place.lic === 'ODbL' || place.lic === 'CC0' || place.lic === 'ODC');
      if (place.ax) {
        assert.equal(place.ax, 1);
        assert.equal(typeof place.t, 'string');
        assert.ok(place.t.length > 0);
      } else {
        assert.equal(place.ax, undefined);
      }
      assert.equal(typeof place.n, 'string');
      assert.ok(place.n.trim().length >= 2);
      assert.equal(/[\u200B-\u200D\uFEFF\u2060]/.test(place.n), false);
      assert.equal(/via airport/i.test(place.n), false);
      assert.equal(allowed.has(place.c), true, place.c + ' ' + place.n);
      assert.equal(typeof place.q, 'string');
      assert.ok(place.q.length >= 2);
      assert.equal(place.score, undefined);
      assert.equal(Number.isFinite(place.lat), true);
      assert.equal(Number.isFinite(place.lng), true);
      assert.equal(ids.has(place.i), false);
      ids.add(place.i);
      const folded = lib.foldName(place.n);
      blocked.forEach((name) => assert.notEqual(folded, name));
      assert.equal(/^นาย|^นางสาว|^นาง(?:\s|$)|^(?:ด\.?\s*ช|เด็กชาย|เด็กหญิง)/.test(place.n), false);
      places.push(place);
    });
  });
  const counts = lib.countPlaces(places);
  assert.deepEqual(doc.counts.byCategory, counts.byCategory);
  assert.deepEqual(doc.counts.byDistrict, counts.byDistrict);
  assert.equal(doc.counts.total, places.length);
  assert.ok(places.length > 700);
  assert.ok(places.some((p) => /มหาธาตุ/.test(p.n) && p.q.includes(lib.searchKey('วัดพระมหาธาตุ'))));
  const chedi = places.filter((p) => lib.searchKey(p.n).includes(lib.searchKey('วัดเจดีย์ไอ้ไข่')));
  assert.equal(chedi.length, 1);
  assert.equal(chedi[0].n, 'วัดเจดีย์ (ไอ้ไข่)');
  const airport = places.find((p) => p.k === 'airport' && /นครศรี|nst/i.test(p.n + p.q));
  assert.ok(airport, 'NST airport missing');
  assert.equal(airport.c, 'tr');
  assert.ok(places.some((p) => p.d === 'ขนอม' && (p.c === 't' || p.c === 'h' || p.c === 'v')));
  assert.ok(places.some((p) => p.d === 'ชะอวด'));
  assert.ok(places.filter((p) => p.c === 'h').length > 122);
  assert.ok(places.some((p) => p.src === 'tat'));
  assert.equal(doc.coverage.approximate, places.filter((p) => p.ax === 1).length);
  assert.ok(largest < 2500000, 'largest district file should stay under 2.5MB, got ' + largest);
  assert.ok(totalBytes < 12000000, 'province catalog should stay under 12MB, got ' + totalBytes);
  const chauat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chauat-places.json'), 'utf8'));
  assert.equal(chauat.osmRelation, 18989358);
  assert.ok(Array.isArray(chauat.places) && chauat.places.length > 0);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const assets = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];'));
  assert.equal(assets.includes('/data/nst/'), false);
  assert.equal(assets.includes('/data/chauat-places.json'), true);
  assert.equal(sw.includes('chauat-app-v3.9.33'), true);
});
