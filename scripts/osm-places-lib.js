/**
 * Pure filters for the Nakhon Si Thammarat OSM place extract.
 * No network. Used by scripts/fetch-osm-places.js and tests/osm-places.test.js.
 *
 * Coordinates and names come from OpenStreetMap (ODbL). This file does not
 * scrape any other map provider.
 */

'use strict';

const HOUSE_BUILDINGS = new Set([
  'house', 'residential', 'detached', 'semidetached_house',
  'terrace', 'bungalow', 'static_caravan', 'cabin', 'farm'
]);

const PUBLIC_KEYS = ['amenity', 'shop', 'tourism', 'office', 'healthcare', 'historic', 'leisure'];

const BLOCKED_NAMES = new Set([
  'ขวัญฤทัยยอดราช',
  'นายธีระวัชเมืองทองอ่อน',
  'บ้าน/ที่อยู่อาศัย',
  'บ้านที่อยู่อาศัย',
  'ที่อยู่อาศัย',
  'บ้านบุริมนาถศรีสุขใส'
]);

const PERSONAL_PREFIX = /^(นาย|นางสาว|นาง|ด\.?\s*ช\.?|ด\.?\s*ญ\.?|เด็กชาย|เด็กหญิง)(\s|$)/;
const HOUSE_PERSON = /^บ้าน(นาย|นางสาว|นาง|คุณ|ของ|ด\.?\s*ช|ด\.?\s*ญ|เด็กชาย|เด็กหญิง|แม่|พ่อ|ลุง|ป้า|น้า|อา|ยาย|ตา|ปู่|ย่า)/;

const LODGING_WORD = /โรงแรม|รีสอร์[ทต]|โฮมสเตย์|โฮมสเต|เกสต์เฮาส์|เกสท์เฮาส์|เกสต์เฮาส|ที่พัก|โฮสเทล|hostel|resort|hotel|guesthouse|homestay/i;
const PUBLIC_WORD = /วัด|สำนักสงฆ์|มัสยิด|โบสถ์|โรงพยาบาล|รพ\.|ตลาด|เทศบาล|อบต|ศาลากลาง|ที่ว่าการ|อุทยาน|น้ำตก|หาด|เขา|ถ้ำ|จุดชม|จุดเช็?ก|สถานี|โรงเรียน|มหาวิทยาลัย/;

const FOOD_CAP = { r: 20, f: 12 };
const FOOD_SCORE_MIN = 3;

function foldName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s.\-_'’"“”/]+/g, '');
}

function placeName(tags) {
  const t = tags || {};
  return String(t['name:th'] || t.name || t['name:en'] || t.official_name || t.brand || '').trim();
}

function hasPublicTag(tags) {
  return PUBLIC_KEYS.some((key) => {
    const value = tags[key];
    return value && value !== 'yes' && value !== 'no';
  });
}

function isClosed(tags) {
  const amenity = tags.amenity || '';
  const shop = tags.shop || '';
  const office = tags.office || '';
  if (amenity === 'vacant' || shop === 'vacant' || office === 'vacant') return true;
  const hours = String(tags.opening_hours || '').trim().toLowerCase();
  if (hours === 'closed' || hours === 'off') return true;
  if (tags.disused || tags.abandoned) return true;
  for (const key of Object.keys(tags)) {
    if (key.startsWith('disused:') || key.startsWith('abandoned:') || key.startsWith('was:')) return true;
  }
  return false;
}

function isPrivateOrUnnamed(tags, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length < 2) return true;
  const folded = foldName(trimmed);
  if (!folded || BLOCKED_NAMES.has(folded)) return true;
  if (PERSONAL_PREFIX.test(trimmed) || HOUSE_PERSON.test(trimmed.replace(/\s+/g, ''))) return true;
  if (trimmed === 'บ้าน' || trimmed === 'ที่อยู่อาศัย' || folded === 'บ้านที่อยู่อาศัย') return true;
  if (/^บ้านพัก/.test(trimmed) && !LODGING_WORD.test(trimmed)) return true;
  if (PUBLIC_WORD.test(trimmed) || LODGING_WORD.test(trimmed)) return false;
  if (tags.place === 'village' || tags.place === 'hamlet' || tags.place === 'town' || tags.place === 'city') {
    return false;
  }
  const building = tags.building || '';
  const lodging = LODGING_WORD.test(trimmed);
  const tourism = tags.tourism || '';
  const amenity = tags.amenity || '';
  if (building && HOUSE_BUILDINGS.has(building) && !lodging && !hasPublicTag(tags)) return true;
  if ((tags.access === 'private' || tags.access === 'no') && !tourism && !amenity) return true;
  if (/^บ้าน/.test(trimmed) && !lodging && !PUBLIC_WORD.test(trimmed) && !hasPublicTag(tags)) return true;
  return false;
}

function foodScore(tags) {
  const t = tags || {};
  let score = 0;
  if (t.wikidata) score += 5;
  if (t.wikipedia || t['wikipedia:th'] || t['wikipedia:en']) score += 4;
  if (t.website || t['contact:website'] || t['contact:facebook'] || t['contact:instagram']) score += 2;
  if (t.phone || t['contact:phone'] || t['contact:mobile'] || t['phone:mobile']) score += 1;
  if (t.cuisine) score += 1;
  if (t.stars || t['stars:food']) score += 2;
  if (t.description || t['description:th']) score += 1;
  if (t.tourism && t.tourism !== 'yes') score += 3;
  if (t.brand) score += 2;
  if (t.opening_hours) score += 1;
  const n = Object.keys(t).length;
  if (n >= 10) score += 2;
  else if (n >= 7) score += 1;
  return score;
}

function keepGovernment(name, tags) {
  if (tags.amenity === 'townhall' || tags.amenity === 'courthouse') return true;
  if (!/ที่ว่าการ|ศาลากลาง|เทศบาล|อบต|องค์การบริหาร|ศาลจังหวัด|ที่ทำการปกครอง|อำเภอ|จังหวัด/.test(name)) {
    return false;
  }
  return true;
}

function classify(tags, name) {
  const t = tags || {};
  const amenity = t.amenity || '';
  const tourism = t.tourism || '';
  const office = t.office || '';
  const leisure = t.leisure || '';
  const historic = t.historic || '';
  const natural = t.natural || '';
  const healthcare = t.healthcare || '';

  if (t.boundary === 'administrative' && !amenity && !office && !tourism) return null;
  if (t.highway && !hasPublicTag(t) && !historic && !natural) return null;

  if (amenity === 'police' || /สถานีตำรวจ|ป้อมตำรวจ/.test(name)) return 'i';
  if (
    amenity === 'hospital' ||
    healthcare === 'hospital' ||
    /โรงพยาบาล|รพ\.สต|โรงพยาบาลส่งเสริม/.test(name)
  ) return 'l';
  if (amenity === 'place_of_worship' || t.building === 'temple' || historic === 'temple' || /^วัด|^สำนักสงฆ์/.test(name)) {
    return 'w';
  }
  if (amenity === 'fuel') return 'g';
  if (amenity === 'bank' || /^ธนาคาร/.test(name)) return 'b';
  if (amenity === 'marketplace' || /^ตลาด/.test(name)) return 'm';
  if (amenity === 'cafe' || /คาเฟ่|กาแฟ/.test(name)) return 'f';
  if (amenity === 'restaurant' || amenity === 'fast_food' || amenity === 'food_court') return 'r';
  if (tourism === 'camp_site' || tourism === 'caravan_site' || /แคมป์|กางเต็นท์|ลานกาง/.test(name)) return 'k';
  if (
    tourism === 'hotel' || tourism === 'guest_house' || tourism === 'hostel' ||
    tourism === 'motel' || tourism === 'chalet' || tourism === 'resort' ||
    (tourism === 'apartment' && LODGING_WORD.test(name)) ||
    LODGING_WORD.test(name)
  ) {
    if (/เสริมสวย|คลินิก|ร้านยา/.test(name) && !LODGING_WORD.test(name)) return null;
    return 'h';
  }
  if (tourism === 'viewpoint' || /จุดชม|จุดถ่าย|เช็คอิน|เช็ค อิน|จุดเช็ค|จุดเช็ก/.test(name)) return 'v';
  if (amenity === 'university' || amenity === 'college') return 'e';
  if (office === 'government' || amenity === 'townhall') {
    return keepGovernment(name, t) ? 'o' : null;
  }
  if (/อบต|เทศบาล|องค์การบริหาร|ที่ว่าการ|ศาลากลาง/.test(name)) return 'o';
  if (amenity === 'post_office' || /ไปรษณีย์/.test(name)) return 'p';
  if (amenity === 'bus_station' || amenity === 'ferry_terminal') return 'o';
  if (t.railway === 'station' || t.railway === 'halt' || /^สถานีรถไฟ|^สถานีรถ/.test(name)) return 'x';
  if (
    tourism === 'attraction' || tourism === 'museum' || tourism === 'gallery' ||
    tourism === 'theme_park' || tourism === 'zoo' || tourism === 'aquarium' ||
    leisure === 'nature_reserve' || t.boundary === 'protected_area' || t.boundary === 'national_park' ||
    historic === 'archaeological_site' || historic === 'ruins' || historic === 'monument' ||
    historic === 'memorial' || historic === 'fort' || historic === 'castle' ||
    natural === 'beach' || natural === 'waterfall' || natural === 'peak' ||
    natural === 'cave_entrance' || natural === 'hot_spring' || natural === 'cape' ||
    natural === 'cliff' || natural === 'spring' || t.waterway === 'waterfall'
  ) {
    if (leisure === 'park' || leisure === 'garden') {
      if (!t.wikidata && !t.tourism && !/สวน|อุทยาน|น้ำตก|หาด/.test(name)) return null;
    }
    return 't';
  }
  if (leisure === 'park' || leisure === 'garden') {
    if (t.wikidata || /อุทยาน|สวนสาธารณะ|น้ำตก|หาด/.test(name)) return 't';
    return null;
  }
  if (tourism === 'information' || tourism === 'yes' || tourism === 'artwork') return null;
  return null;
}

function firstContact(tags, keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = String(tags[keys[i]] || '').trim();
    if (value) return value.split(/[;|]/)[0].trim();
  }
  return '';
}

function compactPlace(element, district) {
  const tags = (element && element.tags) || {};
  const name = placeName(tags);
  if (isClosed(tags) || isPrivateOrUnnamed(tags, name)) return null;
  const cat = classify(tags, name);
  if (!cat) return null;
  let lat = element.lat;
  let lng = element.lon;
  if (element.center) {
    lat = element.center.lat;
    lng = element.center.lon;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const score = foodScore(tags);
  if ((cat === 'r' || cat === 'f') && /^(food stalls?|restaurant|cafe|fast food|ร้านอาหาร|ร้านกาแฟ)$/i.test(name)) {
    return null;
  }
  const row = {
    n: name,
    c: cat,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    i: (element.type === 'way' ? 'w' : element.type === 'relation' ? 'r' : 'n') + element.id,
    d: district,
    score: score
  };
  const phone = firstContact(tags, ['phone', 'contact:phone', 'contact:mobile', 'phone:mobile']);
  const web = firstContact(tags, ['website', 'contact:website', 'contact:facebook']);
  const hours = String(tags.opening_hours || '').trim();
  if (phone) row.ph = phone.slice(0, 40);
  if (web) row.web = web.slice(0, 180);
  if (hours && hours.toLowerCase() !== 'closed') row.oh = hours.slice(0, 80);
  return row;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function limitFood(places) {
  const other = [];
  const groups = new Map();
  places.forEach((place) => {
    if (place.c !== 'r' && place.c !== 'f') {
      other.push(place);
      return;
    }
    const key = place.d + '|' + place.c;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(place);
  });
  groups.forEach((list, key) => {
    const cat = key.endsWith('|f') ? 'f' : 'r';
    list.sort((a, b) => (b.score - a.score) || a.n.localeCompare(b.n, 'th'));
    const cap = FOOD_CAP[cat];
    const strong = list.filter((place) => place.score >= FOOD_SCORE_MIN);
    const weak = list.filter((place) => place.score < FOOD_SCORE_MIN);
    const picked = (strong.length >= cap ? strong : strong.concat(weak)).slice(0, cap);
    other.push(...picked);
  });
  return other;
}

function dedupePlaces(places) {
  const ranked = places.slice().sort((a, b) => (b.score - a.score) || a.n.localeCompare(b.n, 'th'));
  const kept = [];
  const byId = new Set();
  ranked.forEach((place) => {
    if (byId.has(place.i)) return;
    const folded = foldName(place.n);
    const dup = kept.some((other) => {
      if (other.i === place.i) return true;
      if (other.c !== place.c) return false;
      if (foldName(other.n) !== folded) return false;
      return haversineKm(other.lat, other.lng, place.lat, place.lng) < 0.15;
    });
    if (dup) return;
    byId.add(place.i);
    kept.push(place);
  });
  return kept;
}

function finalizePlaces(places) {
  const limited = limitFood(dedupePlaces(places));
  limited.sort((a, b) => a.d.localeCompare(b.d, 'th') || a.c.localeCompare(b.c) || a.n.localeCompare(b.n, 'th'));
  return limited.map((place) => {
    const row = { n: place.n, c: place.c, lat: place.lat, lng: place.lng, i: place.i, d: place.d };
    if (place.ph) row.ph = place.ph;
    if (place.web) row.web = place.web;
    if (place.oh) row.oh = place.oh;
    return row;
  });
}

function countPlaces(places) {
  const byCategory = {};
  const byDistrict = {};
  places.forEach((place) => {
    byCategory[place.c] = (byCategory[place.c] || 0) + 1;
    byDistrict[place.d] = (byDistrict[place.d] || 0) + 1;
  });
  return { byCategory, byDistrict, total: places.length };
}

function closeEnough(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function closed(line) {
  return line.length >= 4 && closeEnough(line[0], line[line.length - 1]);
}

function stitch(lines) {
  const unused = lines.filter((line) => line.length >= 2).map((line) => line.slice());
  const rings = [];
  while (unused.length) {
    let ring = unused.pop();
    let progressed = true;
    while (progressed && !closed(ring)) {
      progressed = false;
      for (let i = 0; i < unused.length; i++) {
        const line = unused[i];
        if (closeEnough(ring[ring.length - 1], line[0])) ring = ring.concat(line.slice(1));
        else if (closeEnough(ring[ring.length - 1], line[line.length - 1])) ring = ring.concat(line.slice().reverse().slice(1));
        else if (closeEnough(ring[0], line[line.length - 1])) ring = line.slice(0, -1).concat(ring);
        else if (closeEnough(ring[0], line[0])) ring = line.slice().reverse().slice(1).concat(ring);
        else continue;
        unused.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (ring.length >= 3 && !closed(ring)) ring = ring.concat([ring[0]]);
    if (closed(ring)) rings.push(ring);
  }
  return rings;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ring.forEach((pt) => {
    if (pt[0] < minX) minX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] > maxY) maxY = pt[1];
  });
  return [minX, minY, maxX, maxY];
}

function bboxContains(bbox, lon, lat) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function relationPolygons(element) {
  const outers = [];
  const inners = [];
  (element.members || []).forEach((member) => {
    if (member.type !== 'way' || !member.geometry) return;
    const pts = member.geometry
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map((p) => [p.lon, p.lat]);
    if (pts.length < 2) return;
    if (member.role === 'inner') inners.push(pts);
    else outers.push(pts);
  });
  return { outers: stitch(outers), inners: stitch(inners) };
}

function prepareDistrict(element) {
  const tags = element.tags || {};
  const name = String(tags['name:th'] || tags.name || '').replace(/^อำเภอ/, '').trim();
  const poly = relationPolygons(element);
  const bbox = poly.outers.length
    ? poly.outers.reduce((acc, ring) => {
      const box = ringBBox(ring);
      return [
        Math.min(acc[0], box[0]),
        Math.min(acc[1], box[1]),
        Math.max(acc[2], box[2]),
        Math.max(acc[3], box[3])
      ];
    }, [Infinity, Infinity, -Infinity, -Infinity])
    : null;
  return { id: element.id, name: name, bbox: bbox, outers: poly.outers, inners: poly.inners };
}

function containsDistrict(district, lon, lat) {
  if (!district.bbox || !bboxContains(district.bbox, lon, lat)) return false;
  const inOuter = district.outers.some((ring) => pointInRing(lon, lat, ring));
  if (!inOuter) return false;
  if (district.inners.some((ring) => pointInRing(lon, lat, ring))) return false;
  return true;
}

function assignDistrict(lat, lng, districts) {
  const hits = [];
  for (let i = 0; i < districts.length; i++) {
    if (containsDistrict(districts[i], lng, lat)) hits.push(districts[i]);
  }
  if (!hits.length) return '';
  hits.sort((a, b) => {
    const aa = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
    const bb = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
    return aa - bb;
  });
  return hits[0].name;
}

module.exports = {
  FOOD_CAP,
  FOOD_SCORE_MIN,
  foldName,
  placeName,
  isPrivateOrUnnamed,
  foodScore,
  classify,
  compactPlace,
  dedupePlaces,
  limitFood,
  finalizePlaces,
  countPlaces,
  haversineKm,
  stitch,
  pointInRing,
  prepareDistrict,
  assignDistrict,
  containsDistrict
};
