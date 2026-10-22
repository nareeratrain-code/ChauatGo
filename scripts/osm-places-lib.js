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

const FOOD_SCORE_MIN = 1;

const SHOP_CAT = {
  mall: 'ml',
  department_store: 'ml',
  convenience: 'c',
  supermarket: 's',
  hypermarket: 's',
  chemist: 'q',
  pharmacy: 'q',
  electronics: 'n',
  mobile_phone: 'n',
  computer: 'n',
  hifi: 'n',
  camera: 'n',
  telecommunication: 'n',
  hardware: 'd',
  doityourself: 'd',
  electrical: 'd',
  paint: 'd',
  trade: 'd',
  car: 'u',
  car_repair: 'u',
  car_parts: 'u',
  motorcycle: 'u',
  bicycle: 'u',
  tyres: 'u',
  clothes: 'j',
  fashion: 'j',
  beauty: 'j',
  hairdresser: 'j',
  cosmetics: 'j',
  jewelry: 'j',
  shoes: 'j',
  watches: 'j',
  bag: 'j',
  tailor: 'j',
  fabric: 'j',
  agrarian: 'a',
  farm: 'a',
  florist: 'a',
  garden_centre: 'a',
  bakery: 'r',
  butcher: 'r',
  seafood: 'r',
  pastry: 'r',
  confectionery: 'r',
  deli: 'r',
  ice_cream: 'f',
  coffee: 'f',
  tea: 'f'
};

const BIG_BOX = /central|robinson|lotus|big\s*c|makro|เซ็นทรัล|โรบินสัน|โลตัส|บิ๊ก\s*ซี|แม็คโคร|เทสโก้|tesco/i;

const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060\u00AD\u180E]/g;
const TONE_MARKS = /[\u0E47-\u0E4C]/g;

function cleanName(value) {
  return String(value || '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldName(value) {
  return cleanName(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s.'’"“”()[\]{}<>/\\,;:!?&+#_*=~|–—\-]+/g, '');
}

function searchKey(value) {
  return foldName(value).replace(TONE_MARKS, '');
}

function placeName(tags) {
  const t = tags || {};
  let name = cleanName(t['name:th'] || t.name || t['name:en'] || t.official_name || t.brand || '');
  if (!name && (t.amenity === 'atm' || t.amenity === 'charging_station' || t.amenity === 'fuel' || t.amenity === 'bank')) {
    name = cleanName(t['brand:th'] || t.operator || t.network || '');
  }
  if (name && t.amenity === 'atm' && !/เอทีเอ็ม|\batm\b/i.test(name)) name = 'ตู้เอทีเอ็ม ' + name;
  if (name && t.amenity === 'charging_station' && !/ชาร์จ|charging/i.test(name)) name = 'สถานีชาร์จ ' + name;
  return name;
}

function isRoute(tags) {
  const t = tags || {};
  if (t.type === 'route' || t.route) return true;
  return false;
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

function isPublicAerodrome(tags) {
  const t = tags || {};
  const kind = String(t.aerodrome || t['aerodrome:type'] || '').toLowerCase();
  if (kind === 'private' || kind === 'military') return false;
  if (t.military && t.military !== 'no') return false;
  if ((t.access === 'private' || t.access === 'no') && !t.iata && !t.icao) return false;
  return t.aeroway === 'aerodrome' || !!(t.iata || t.icao);
}

function isBigBox(name, tags) {
  const blob = (name || '') + ' ' + ((tags && (tags.brand || tags.operator)) || '');
  return BIG_BOX.test(blob);
}

function placeKind(tags) {
  const t = tags || {};
  if (isPublicAerodrome(t)) return 'airport';
  if (t.amenity === 'charging_station') return 'ev';
  if (t.railway === 'station' || t.railway === 'halt') return 'rail';
  if (t.amenity === 'bus_station') return 'bus';
  if (t.amenity === 'ferry_terminal' || t.man_made === 'pier') return 'pier';
  return '';
}

function highlightCodes(name) {
  const folded = foldName(name);
  const codes = [];
  if (folded.indexOf('วัดเจดีย์') !== -1 && (folded.indexOf('ไอ้ไข่') !== -1 || folded.indexOf('ไอไข่') !== -1)) {
    codes.push('t', 'v');
  }
  if (folded.indexOf('พระมหาธาตุ') !== -1 && folded.indexOf('วรมหาวิหาร') !== -1) codes.push('t');
  return codes;
}

function canonicalName(name) {
  const folded = foldName(name);
  const key = searchKey(name);
  const thai = folded.indexOf('วัดเจดีย์') !== -1 && (folded.indexOf('ไอ้ไข่') !== -1 || key.indexOf('ไอไข่') !== -1);
  const english = key.indexOf('watchedi') !== -1 && (key.indexOf('aikai') !== -1 || key.indexOf('aikhai') !== -1);
  if (thai || english) return 'วัดเจดีย์ (ไอ้ไข่)';
  return cleanName(name);
}

const CHAIN_NAME = /ปตท|พีที|7.?eleven|เซเว่น|เซเวน|lotus|โลตัส|bigc|บิ๊กซี|makro|แม็คโคร|tesco|เทสโก้|robinson|โรบินสัน|central|เซ็นทรัล|shell|เชลล์|bangchak|บางจาก|esso|เอสโซ่|caltex|susco|ซัสโก้|amazon|อเมซอน|starbucks|อินทนิล|familymart|แฟมิลี่|^ptt$|^pt$/i;

function dedupeLimitKm(name) {
  const cleaned = cleanName(name).toLowerCase();
  if (CHAIN_NAME.test(cleaned) || CHAIN_NAME.test(foldName(name))) return 0.15;
  return 0.5;
}

function classify(tags, name) {
  const t = tags || {};
  const amenity = t.amenity || '';
  const shop = t.shop || '';
  const tourism = t.tourism || '';
  const office = t.office || '';
  const leisure = t.leisure || '';
  const historic = t.historic || '';
  const natural = t.natural || '';
  const healthcare = t.healthcare || '';

  if (isRoute(t)) return null;
  if (/\bto\b.+\bvia\b/i.test(name)) return null;
  if (t.boundary === 'administrative' && !amenity && !office && !tourism && !shop) return null;
  if (t.highway && !hasPublicTag(t) && !historic && !natural && t.aeroway !== 'aerodrome') return null;

  if (isPublicAerodrome(t)) return 'tr';
  if (t.railway === 'station' || t.railway === 'halt') return 'tr';
  if (amenity === 'bus_station' || amenity === 'ferry_terminal' || t.man_made === 'pier') return 'tr';
  if (amenity === 'charging_station') return 'g';
  if (amenity === 'fuel') return 'g';
  if (amenity === 'police' || /สถานีตำรวจ|ป้อมตำรวจ/.test(name)) return 'i';
  if (
    amenity === 'hospital' ||
    healthcare === 'hospital' ||
    (/โรงพยาบาล|รพ\.สต|โรงพยาบาลส่งเสริม/.test(name) && !/^บ้านพัก/.test(name))
  ) return 'l';
  if (amenity === 'clinic' || amenity === 'doctors' || amenity === 'dentist' || amenity === 'pharmacy' || shop === 'chemist' || shop === 'pharmacy') {
    return 'q';
  }
  if (amenity === 'place_of_worship' || t.building === 'temple' || historic === 'temple' || /^วัด|^สำนักสงฆ์/.test(name)) {
    return 'w';
  }
  if (amenity === 'bank' || amenity === 'atm' || /^ธนาคาร/.test(name)) return 'b';
  if (amenity === 'marketplace' || /^ตลาด/.test(name)) return 'm';
  if (amenity === 'cafe' || shop === 'coffee' || shop === 'tea' || shop === 'ice_cream') return 'f';
  if (amenity === 'restaurant' || amenity === 'fast_food' || amenity === 'food_court' || amenity === 'bar' || amenity === 'pub' || amenity === 'biergarten') {
    return 'r';
  }
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
  if (amenity === 'school' || amenity === 'kindergarten' || amenity === 'college' || amenity === 'university' || /^โรงเรียน|^มหาวิทยาลัย|^วิทยาลัย/.test(name)) {
    return 'e';
  }
  if (shop === 'mall' || shop === 'department_store' || ((shop === 'supermarket' || shop === 'hypermarket') && isBigBox(name, t))) {
    return 'ml';
  }
  if (SHOP_CAT[shop]) return SHOP_CAT[shop];
  if (shop && shop !== 'vacant' && shop !== 'yes') return 's';
  if (office === 'government' || office === 'administrative' || amenity === 'townhall' || amenity === 'courthouse') {
    return 'o';
  }
  if (/อบต|เทศบาล|องค์การบริหาร|ที่ว่าการ|ศาลากลาง/.test(name)) return 'o';
  if (amenity === 'post_office' || /ไปรษณีย์/.test(name)) return 'p';
  if (
    tourism === 'attraction' || tourism === 'museum' || tourism === 'gallery' ||
    tourism === 'theme_park' || tourism === 'zoo' || tourism === 'aquarium' ||
    leisure === 'nature_reserve' || leisure === 'park' || leisure === 'garden' ||
    t.boundary === 'protected_area' || t.boundary === 'national_park' ||
    historic === 'archaeological_site' || historic === 'ruins' || historic === 'monument' ||
    historic === 'memorial' || historic === 'fort' || historic === 'castle' || historic === 'temple' ||
    natural === 'beach' || natural === 'waterfall' || natural === 'peak' ||
    natural === 'cave_entrance' || natural === 'hot_spring' || natural === 'cape' ||
    natural === 'cliff' || natural === 'spring' || t.waterway === 'waterfall'
  ) {
    if (tourism === 'information' || tourism === 'yes' || tourism === 'artwork') return null;
    return 't';
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
  if (isRoute(tags)) return null;
  const name = canonicalName(placeName(tags));
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
  const score = foodScore(tags) + Object.keys(tags).length;
  if ((cat === 'r' || cat === 'f') && /^(food stalls?|restaurant|cafe|fast food|bar|pub|ร้านอาหาร|ร้านกาแฟ)$/i.test(name)) {
    return null;
  }
  const extras = [tags.iata, tags.icao, tags['name:en'], tags.alt_name, tags.brand, tags.operator]
    .filter(Boolean)
    .join(' ');
  const row = {
    n: name,
    c: cat,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    i: (element.type === 'way' ? 'w' : element.type === 'relation' ? 'r' : 'n') + element.id,
    d: district,
    score: score,
    q: searchKey(extras)
  };
  const kind = placeKind(tags);
  const hl = highlightCodes(name);
  if (kind) row.k = kind;
  if (hl.length) row.hl = hl.join('');
  if (tags.iata) row.iata = String(tags.iata).trim().toUpperCase();
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

function absorbPlace(keep, extra) {
  const hl = new Set(((keep.hl || '') + (extra.hl || '')).split('').filter(Boolean));
  if (extra.c === 't' || extra.c === 'v') hl.add(extra.c);
  if (keep.c === 't' || keep.c === 'v') hl.add(keep.c);
  if (hl.size) keep.hl = Array.from(hl).join('');
  keep.n = canonicalName(keep.n);
  if (!keep.ph && extra.ph) keep.ph = extra.ph;
  if (!keep.web && extra.web) keep.web = extra.web;
  if (!keep.oh && extra.oh) keep.oh = extra.oh;
  if (!keep.k && extra.k) keep.k = extra.k;
  if (!keep.iata && extra.iata) keep.iata = extra.iata;
  keep.q = searchKey((keep.q || '') + ' ' + (extra.q || '') + ' ' + (extra.n || ''));
}

function dedupePlaces(places) {
  const ranked = places.slice().sort((a, b) => (b.score - a.score) || a.n.localeCompare(b.n, 'th'));
  const kept = [];
  const cells = new Map();
  ranked.forEach((place) => {
    const folded = foldName(place.n);
    const limit = dedupeLimitKm(place.n);
    const cx = Math.round(place.lat / 0.003);
    const cy = Math.round(place.lng / 0.003);
    const span = place.iata ? 8 : 2;
    let twin = null;
    for (let dx = -span; dx <= span && !twin; dx++) {
      for (let dy = -span; dy <= span && !twin; dy++) {
        const bucket = cells.get((cx + dx) + ':' + (cy + dy)) || [];
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          const dist = haversineKm(other.lat, other.lng, place.lat, place.lng);
          if (other.i === place.i) { twin = other; break; }
          if (place.iata && other.iata && place.iata === other.iata && dist < 2) {
            twin = other;
            break;
          }
          if (foldName(other.n) !== folded) continue;
          if (dist < limit) {
            twin = other;
            break;
          }
        }
      }
    }
    if (twin) {
      absorbPlace(twin, place);
      return;
    }
    kept.push(place);
    const id = cx + ':' + cy;
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id).push(place);
  });
  return kept;
}

function finalizePlaces(places) {
  const kept = dedupePlaces(places);
  kept.forEach((place) => {
    place.n = canonicalName(place.n);
    const hl = new Set(((place.hl || '') + highlightCodes(place.n).join('')).split('').filter(Boolean));
    if (hl.size) place.hl = Array.from(hl).join('');
    else delete place.hl;
    place.q = searchKey(place.n + ' ' + (place.q || ''));
  });
  kept.sort((a, b) => a.d.localeCompare(b.d, 'th') || a.c.localeCompare(b.c) || a.n.localeCompare(b.n, 'th'));
  return kept.map((place) => {
    const row = { n: place.n, q: place.q, c: place.c, lat: place.lat, lng: place.lng, i: place.i, d: place.d };
    if (place.k) row.k = place.k;
    if (place.hl) row.hl = place.hl;
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
  FOOD_SCORE_MIN,
  foldName,
  searchKey,
  cleanName,
  canonicalName,
  placeName,
  isPrivateOrUnnamed,
  isRoute,
  foodScore,
  classify,
  compactPlace,
  dedupePlaces,
  finalizePlaces,
  countPlaces,
  haversineKm,
  stitch,
  pointInRing,
  prepareDistrict,
  assignDistrict,
  containsDistrict
};
