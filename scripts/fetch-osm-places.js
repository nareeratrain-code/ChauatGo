#!/usr/bin/env node
/**
 * Build data/nst/*.json from OpenStreetMap via the Overpass API (ODbL).
 *
 * Coverage is จังหวัดนครศรีธรรมราช (relation 1908792), not only อำเภอชะอวด.
 * Existing data/chauat-places.json is left untouched.
 *
 * Usage:
 *   node scripts/fetch-osm-places.js
 *   node scripts/fetch-osm-places.js --cache /tmp/nst-osm-cache
 *
 * Do not point this at Google Maps or any other site. The public Overpass
 * servers are rate-limited; the script retries and caches raw responses.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./osm-places-lib');

const ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
];

const UA = 'ChauatGo-places/1.0 (ODbL place dataset; https://github.com/nareeratrain-code/ChauatGo)';
const PROVINCE_RELATION = 1908792;
const PROVINCE_AREA = 3600000000 + PROVINCE_RELATION;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'nst');
const LEGACY_PATH = path.join(ROOT, 'data', 'nst-places.json');
const SLUGS = {
  'ขนอม': 'khanom',
  'จุฬาภรณ์': 'chulabhorn',
  'ฉวาง': 'chawang',
  'เฉลิมพระเกียรติ': 'chaloem-phra-kiat',
  'ชะอวด': 'cha-uat',
  'ช้างกลาง': 'chang-klang',
  'เชียรใหญ่': 'chian-yai',
  'ถ้ำพรรณรา': 'tham-phannara',
  'ท่าศาลา': 'tha-sala',
  'ทุ่งสง': 'thung-song',
  'ทุ่งใหญ่': 'thung-yai',
  'นบพิตำ': 'nopphitam',
  'นาบอน': 'na-bon',
  'บางขัน': 'bang-khan',
  'ปากพนัง': 'pak-phanang',
  'พรหมคีรี': 'phrom-khiri',
  'พระพรหม': 'phra-phrom',
  'พิปูน': 'phipun',
  'เมืองนครศรีธรรมราช': 'mueang',
  'ร่อนพิบูลย์': 'ron-phibun',
  'ลานสกา': 'lan-saka',
  'สิชล': 'sichon',
  'หัวไทร': 'hua-sai'
};

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || !process.argv[idx + 1]) return fallback;
  return process.argv[idx + 1];
}

const CACHE_DIR = argValue('--cache', '/tmp/nst-osm-cache');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function overpass(query, cacheName) {
  const cachePath = path.join(CACHE_DIR, cacheName);
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached && Array.isArray(cached.elements)) {
      console.log('cache', cacheName, cached.elements.length);
      return cached;
    }
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let last = 'no attempt';
  for (let e = 0; e < ENDPOINTS.length; e++) {
    const url = ENDPOINTS[e];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log('POST', url, cacheName, 'try', attempt + 1);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ data: query })
        });
        const text = await res.text();
        if (!res.ok) {
          last = url + ' HTTP ' + res.status + ' ' + text.slice(0, 180).replace(/\s+/g, ' ');
          console.error(last);
          await sleep(4000 * (attempt + 1));
          continue;
        }
        const parsed = JSON.parse(text);
        const remark = String(parsed.remark || '');
        if (/error|runtime error|timeout/i.test(remark) && !(parsed.elements || []).length) {
          last = remark;
          console.error(last);
          await sleep(4000 * (attempt + 1));
          continue;
        }
        fs.writeFileSync(cachePath, JSON.stringify(parsed));
        console.log('ok', cacheName, (parsed.elements || []).length);
        await sleep(1500);
        return parsed;
      } catch (err) {
        last = err && err.message ? err.message : String(err);
        console.error('fail', url, last);
        await sleep(4000 * (attempt + 1));
      }
    }
  }
  throw new Error('Overpass failed for ' + cacheName + ': ' + last);
}

function districtQuery() {
  return '[out:json][timeout:90];area(' + PROVINCE_AREA + ')->.a;rel(area.a)["boundary"="administrative"]["admin_level"="6"];out tags;';
}

function geomQuery(ids) {
  return '[out:json][timeout:180];rel(id:' + ids.join(',') + ');out geom;';
}

function poiQuery(body) {
  return '[out:json][timeout:180];area(' + PROVINCE_AREA + ')->.a;(' + body + ');out center tags;';
}

const SHOP_RE = '^(mall|department_store|supermarket|hypermarket|convenience|chemist|pharmacy|electronics|mobile_phone|computer|hardware|doityourself|clothes|fashion|beauty|hairdresser|car|car_repair|car_parts|bicycle|motorcycle|tyres|general|kiosk|greengrocer|bakery|butcher|seafood|coffee|tea|books|gift|jewelry|shoes|sports|furniture|florist|garden_centre|variety_store|houseware|electrical|hifi|camera|photo|optician|medical_supply|herbalist|beverages|alcohol|confectionery|pastry|deli|farm|agrarian|trade|wholesale|outdoor|toys|stationery|laundry|dry_cleaning|travel_agency|ice_cream|cosmetics|perfumery|watches|bag|fabric|tailor|music|musical_instrument|video_games|pet|newsagent|copyshop|paint|lighting|kitchen|appliance|telecommunication|baby_goods|boutique)$';

const POI_BATCHES = [
  [
    'v2-food',
    'nwr["amenity"~"^(restaurant|fast_food|food_court|cafe|bar|pub|biergarten)$"]["name"](area.a);'
  ],
  [
    'v2-civic',
    'nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|dentist|pharmacy|police|post_office|bank|atm|fuel|charging_station|townhall|courthouse|marketplace|bus_station|ferry_terminal|community_centre|library|fire_station|place_of_worship)$"]["name"](area.a);' +
    'nwr["healthcare"~"^(hospital|clinic)$"]["name"](area.a);' +
    'nwr["office"~"^(government|administrative)$"]["name"](area.a);' +
    'nwr["building"="temple"]["name"](area.a);'
  ],
  [
    'v2-shops',
    'nwr["shop"~"' + SHOP_RE + '"]["name"](area.a);'
  ],
  [
    'v2-places',
    'nwr["tourism"]["name"](area.a);' +
    'nwr["historic"]["name"](area.a);' +
    'nwr["natural"~"^(beach|waterfall|peak|cave_entrance|hot_spring|cape|cliff|spring)$"]["name"](area.a);' +
    'nwr["waterway"="waterfall"]["name"](area.a);' +
    'nwr["leisure"~"^(nature_reserve|park|garden)$"]["name"](area.a);' +
    'nwr["boundary"="protected_area"]["name"](area.a);' +
    'nwr["railway"~"^(station|halt)$"]["name"](area.a);' +
    'nwr["aeroway"="aerodrome"](area.a);' +
    'nwr["man_made"="pier"]["name"](area.a);' +
    'nwr["iata"="NST"](area.a);'
  ],
  [
    'v2-names-th',
    'nwr["name"~"พรายดำ|แสงจันทร์|ครัวนายหนัง|ท่าอากาศยาน"](area.a);' +
    'nwr["name:th"~"พรายดำ|แสงจันทร์|ครัวนายหนัง|ท่าอากาศยาน"](area.a);' +
    'nwr["alt_name"~"พรายดำ|แสงจันทร์|Phrai Dam|Saeng Chan",i](area.a);' +
    'nwr["name:en"~"Phrai Dam|Saeng Chan|Saengchan|Nakhon Si Thammarat Airport",i](area.a);'
  ],
  [
    'v2-branded',
    'nwr["amenity"~"^(atm|charging_station)$"](area.a);' +
    'nwr["amenity"="fuel"][!"name"](area.a);' +
    'nwr["amenity"="bank"][!"name"](area.a);'
  ]
];

async function main() {
  const districtData = await overpass(districtQuery(), 'districts.json');
  const districtIds = (districtData.elements || [])
    .filter((el) => el.type === 'relation' && (el.tags || {}).admin_level === '6')
    .map((el) => el.id);
  if (districtIds.length < 20) {
    throw new Error('Expected about 23 districts, got ' + districtIds.length);
  }
  const geomData = await overpass(geomQuery(districtIds), 'district-geom.json');
  const districts = (geomData.elements || [])
    .filter((el) => el.type === 'relation')
    .map(lib.prepareDistrict)
    .filter((d) => d.name && d.outers.length);
  console.log('district polygons', districts.length, districts.map((d) => d.name).join(', '));
  if (districts.length < 20) throw new Error('District polygons missing: ' + districts.length);

  const elements = [];
  for (let i = 0; i < POI_BATCHES.length; i++) {
    const name = POI_BATCHES[i][0];
    const body = POI_BATCHES[i][1];
    const data = await overpass(poiQuery(body), 'poi-' + name + '.json');
    elements.push(...(data.elements || []));
  }

  const seen = new Set();
  const places = [];
  let outside = 0;
  let dropped = 0;
  elements.forEach((el) => {
    if (!el || !el.tags || (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation')) return;
    const id = (el.type === 'way' ? 'w' : el.type === 'relation' ? 'r' : 'n') + el.id;
    if (seen.has(id)) return;
    seen.add(id);
    const lat = el.center ? el.center.lat : el.lat;
    const lng = el.center ? el.center.lon : el.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped++;
      return;
    }
    const district = lib.assignDistrict(lat, lng, districts);
    if (!district) {
      outside++;
      return;
    }
    const row = lib.compactPlace(el, district);
    if (!row) {
      dropped++;
      return;
    }
    places.push(row);
  });

  const finalPlaces = lib.finalizePlaces(places);
  const counts = lib.countPlaces(finalPlaces);
  const watched = [
    { name: 'เขาพรายดำ', re: /พรายดำ|phrai.?dam|khao phrai/i },
    { name: 'ร้านแสงจันทร์', re: /แสงจันทร์|saengchan|saeng chan/i }
  ];
  const missingFromOsm = watched.filter((item) => !finalPlaces.some((place) => item.re.test(place.n) || item.re.test(place.q || ''))).map((item) => item.name);
  const airport = finalPlaces.find((place) => place.k === 'airport' && /นครศรี|nakhon|NST/i.test(place.n + ' ' + (place.q || '')));
  if (!airport) throw new Error('Nakhon Si Thammarat Airport was not found in OSM aerodromes');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(LEGACY_PATH)) fs.unlinkSync(LEGACY_PATH);
  const byDistrict = new Map();
  finalPlaces.forEach((place) => {
    if (!byDistrict.has(place.d)) byDistrict.set(place.d, []);
    byDistrict.get(place.d).push(place);
  });
  const districtMeta = [];
  let largest = { file: '', bytes: 0 };
  let totalBytes = 0;
  byDistrict.forEach((rows, name) => {
    const slug = SLUGS[name] || lib.foldName(name) || 'district';
    const file = slug + '.json';
    const body = {
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      d: name,
      places: rows
    };
    const full = path.join(OUT_DIR, file);
    fs.writeFileSync(full, JSON.stringify(body));
    const bytes = fs.statSync(full).size;
    totalBytes += bytes;
    if (bytes > largest.bytes) largest = { file: file, bytes: bytes };
    districtMeta.push({ n: name, file: file, count: rows.length });
  });
  districtMeta.sort((a, b) => a.n.localeCompare(b.n, 'th'));
  const indexDoc = {
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    area: 'จังหวัดนครศรีธรรมราช',
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass API',
    provinceRelation: PROVINCE_RELATION,
    note: 'Named public places for the whole province, one file per district. Unnamed, private/residential, and route relations are omitted. Search keys are prebuilt in q. Chauat curated rows stay in locations-data.js and data/chauat-places.json.',
    missingFromOsm: missingFromOsm,
    counts: counts,
    districts: districtMeta
  };
  const indexPath = path.join(OUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(indexDoc));
  totalBytes += fs.statSync(indexPath).size;
  console.log(JSON.stringify({
    places: finalPlaces.length,
    outside: outside,
    dropped: dropped,
    totalBytes: totalBytes,
    largest: largest,
    missingFromOsm: missingFromOsm,
    airport: airport,
    counts: counts
  }, null, 2));
  if (!finalPlaces.length) throw new Error('No places written');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
