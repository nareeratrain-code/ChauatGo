#!/usr/bin/env node
/**
 * Build data/nst-places.json from OpenStreetMap via the Overpass API (ODbL).
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
const OUT_PATH = path.join(ROOT, 'data', 'nst-places.json');

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

const POI_BATCHES = [
  [
    'landmarks',
    'nwr["amenity"="place_of_worship"]["name"](area.a);' +
    'nwr["building"="temple"]["name"](area.a);' +
    'nwr["historic"]["name"](area.a);' +
    'nwr["tourism"]["name"](area.a);' +
    'nwr["natural"~"^(beach|waterfall|peak|cave_entrance|hot_spring|cape|cliff|spring)$"]["name"](area.a);' +
    'nwr["waterway"="waterfall"]["name"](area.a);' +
    'nwr["leisure"~"^(nature_reserve|park|garden)$"]["name"](area.a);' +
    'nwr["boundary"="protected_area"]["name"](area.a);' +
    'nwr["railway"~"^(station|halt)$"]["name"](area.a);'
  ],
  [
    'services',
    'nwr["amenity"~"^(hospital|marketplace|townhall|courthouse|police|fuel|bank|university|college|bus_station|ferry_terminal|post_office)$"](area.a);' +
    'nwr["healthcare"="hospital"]["name"](area.a);' +
    'nwr["office"="government"]["name"](area.a);' +
    'nwr["name"~"โรงพยาบาล|รพ\\\\.สต"](area.a);'
  ],
  [
    'food',
    'nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](area.a);'
  ],
  [
    'named-temples',
    'nwr["name"~"^วัด|^สำนักสงฆ์"](area.a);'
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
  const doc = {
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    area: 'จังหวัดนครศรีธรรมราช',
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass API',
    provinceRelation: PROVINCE_RELATION,
    note: 'Named public places for the whole province. Restaurants and cafes are limited to notable OSM entries (wikidata, website, brand, extra tags) and capped per district. Unnamed and private/residential rows are omitted. Chauat curated rows stay in locations-data.js and data/chauat-places.json.',
    districts: districts
      .map((d) => ({ n: d.name, i: d.id }))
      .sort((a, b) => a.n.localeCompare(b.n, 'th')),
    counts: counts,
    places: finalPlaces
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(doc));
  const bytes = fs.statSync(OUT_PATH).size;
  console.log(JSON.stringify({ bytes: bytes, outside: outside, dropped: dropped, counts: counts }, null, 2));
  if (!finalPlaces.length) throw new Error('No places written');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
