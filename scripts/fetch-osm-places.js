#!/usr/bin/env node
/**
 * Build data/nst/*.json for จังหวัดนครศรีธรรมราช (relation 1908792).
 *
 * Sources, each kept on the row as src + lic:
 *   osm  ODbL  OpenStreetMap via Overpass
 *   wd   CC0   Wikidata SPARQL (P625 inside the province bbox, then
 *              point-in-polygon against the district boundaries)
 *   tat  ODC   การท่องเที่ยวแห่งประเทศไทย accommodation register
 *              (Open Data Common). Rows without coordinates use the
 *              OSM tambon centroid and are flagged ax:1.
 *
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
const { spawnSync } = require('child_process');
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
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && Array.isArray(cached.elements)) {
        console.log('cache', cacheName, cached.elements.length);
        return cached;
      }
    } catch (err) {
      console.error('bad cache', cacheName);
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
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(150000)
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
  ],
  [
    'v2-stay-extra',
    'nwr["leisure"="resort"]["name"](area.a);' +
    'nwr["building"="hotel"]["name"](area.a);' +
    'nwr["boundary"="national_park"]["name"](area.a);' +
    'nwr["tourism"="picnic_site"]["name"](area.a);' +
    'nwr["tourism"="apartment"]["name"](area.a);' +
    'nwr["natural"="bay"]["name"](area.a);'
  ]
];

const TAT_URL = 'https://datacatalog.tat.or.th/dataset/981ad5c6-e064-46f7-b39e-17105789e638/resource/0d5f6500-f53c-42a6-ba19-db44d8411c28/download/accommodation.json';
const WD_BOX = 'SERVICE wikibase:box { ?item wdt:P625 ?coord . bd:serviceParam wikibase:cornerSouthWest "Point(99.15 7.85)"^^geo:wktLiteral . bd:serviceParam wikibase:cornerNorthEast "Point(100.25 9.20)"^^geo:wktLiteral . }';
const WD_DIRECT = [
  'Q27686', 'Q216212', 'Q654772', 'Q875157',
  'Q427287', 'Q34627', 'Q8441',
  'Q34038', 'Q40080', 'Q8502', 'Q35509', 'Q839954', 'Q177380',
  'Q46169', 'Q95080679', 'Q33506', 'Q17431399', 'Q23442', 'Q162602', 'Q570116'
];
const WD_CAT = {
  Q27686: 'h', Q216212: 'h', Q654772: 'h', Q875157: 'h',
  Q427287: 'w', Q34627: 'w', Q8441: 'w'
};
const CAT_RANK = { h: 4, w: 3, v: 2, t: 1, k: 1 };
const CODAB_URL = 'https://data.humdata.org/dataset/d24bdc45-eb4c-4e3d-8b16-44db02667c27/resource/10dde461-b781-4904-9559-7deb3e960913/download/tha_admin_boundaries.shp.zip';
const ATTRIBUTIONS = [
  { src: 'osm', lic: 'ODbL', text: '© OpenStreetMap contributors' },
  { src: 'wd', lic: 'CC0', text: 'Wikidata (CC0)' },
  { src: 'tat', lic: 'ODC', text: 'การท่องเที่ยวแห่งประเทศไทย — Open Data Common' },
  { src: 'codab', lic: 'CC-BY-IGO', text: 'ขอบเขตตำบล: OCHA ROAP / Royal Thai Survey Department, HDX COD-AB (CC BY-IGO)' }
];
const ATTRIBUTION = ATTRIBUTIONS.map((row) => row.text).join(' · ');
function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function adminKey(value) {
  return String(value || '').replace(/^(จังหวัด|อำเภอ|เขต|ตำบล|แขวง)\s*/, '').replace(/\s+/g, '').trim();
}

function runChecked(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' failed: ' + result.status);
}

function ensureCodTambons() {
  const out = path.join(CACHE_DIR, 'tambons-codab.json');
  if (fs.existsSync(out) && fs.statSync(out).size > 100000) {
    const cached = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (cached && Array.isArray(cached.tambons) && cached.tambons.length >= 140) {
      console.log('cache tambons-codab.json', cached.tambons.length);
      return cached.tambons;
    }
  }
  const zip = '/tmp/tha_admin_boundaries.shp.zip';
  const shp = '/tmp/tha-adm/tha_admin3.shp';
  if (!fs.existsSync(shp)) {
    if (!fs.existsSync(zip) || fs.statSync(zip).size < 1000000) {
      console.log('GET', CODAB_URL);
      runChecked('curl', ['-L', '--fail', '--retry', '3', '-A', UA, '-o', zip, CODAB_URL]);
    }
    fs.mkdirSync('/tmp/tha-adm', { recursive: true });
    runChecked('unzip', ['-o', '-q', zip, 'tha_admin3.shp', 'tha_admin3.dbf', 'tha_admin3.shx', 'tha_admin3.cpg', '-d', '/tmp/tha-adm']);
  }
  const probe = spawnSync('python3', ['-c', 'import shapefile'], { stdio: 'inherit' });
  if (probe.status !== 0) {
    runChecked('python3', ['-m', 'pip', 'install', '--user', 'pyshp']);
  }
  runChecked('python3', [path.join(__dirname, 'extract-nst-tambons.py'), shp, out]);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (!doc.tambons || doc.tambons.length < 140) throw new Error('COD-AB tambon extract is short: ' + (doc.tambons || []).length);
  return doc.tambons;
}

function assignTambonName(lat, lng, tambons) {
  const hits = [];
  for (let i = 0; i < tambons.length; i++) {
    if (lib.containsDistrict(tambons[i], lng, lat)) hits.push(tambons[i]);
  }
  if (!hits.length) return '';
  hits.sort((a, b) => {
    const aa = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
    const bb = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
    return aa - bb;
  });
  return hits[0].name;
}

function stampTambon(place, tambons) {
  const hit = assignTambonName(place.lat, place.lng, tambons);
  if (hit) place.t = hit;
}

async function sparql(query, cacheName) {
  const cachePath = path.join(CACHE_DIR, cacheName);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && cached.results && Array.isArray(cached.results.bindings)) {
        console.log('cache', cacheName, cached.results.bindings.length);
        return cached;
      }
    } catch (err) {
      console.error('bad cache', cacheName);
    }
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let last = 'no attempt';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      console.log('SPARQL', cacheName, 'try', attempt + 1);
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ query: query }),
        signal: AbortSignal.timeout(90000)
      });
      const text = await res.text();
      if (res.status === 400) throw new Error('SPARQL 400 ' + text.slice(0, 240).replace(/\s+/g, ' '));
      if (res.status === 429 || res.status >= 500) {
        last = 'HTTP ' + res.status;
        console.error(last, text.slice(0, 120).replace(/\s+/g, ' '));
        await sleep(8000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error('SPARQL HTTP ' + res.status);
      const parsed = JSON.parse(text);
      if (!parsed.results || !Array.isArray(parsed.results.bindings)) {
        last = 'bad sparql json';
        await sleep(8000 * (attempt + 1));
        continue;
      }
      fs.writeFileSync(cachePath, JSON.stringify(parsed));
      console.log('ok', cacheName, parsed.results.bindings.length);
      await sleep(1200);
      return parsed;
    } catch (err) {
      last = err && err.message ? err.message : String(err);
      if (/SPARQL 400/.test(last)) throw err;
      console.error('sparql fail', last);
      await sleep(8000 * (attempt + 1));
    }
  }
  throw new Error('Wikidata failed for ' + cacheName + ': ' + last);
}

function wikidataPlaces(bindings, districts) {
  const best = new Map();
  bindings.forEach((row) => {
    const uri = row.item && row.item.value;
    const label = row.itemLabel && row.itemLabel.value;
    const coord = row.coord && row.coord.value;
    const typeUri = row.type && row.type.value;
    if (!uri || !label || !coord) return;
    const id = uri.split('/').pop();
    if (!id || label === id) return;
    const type = typeUri ? typeUri.split('/').pop() : '';
    const cat = WD_CAT[type] || 't';
    const match = String(coord).match(/Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
    if (!match) return;
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    const district = lib.assignDistrict(lat, lng, districts);
    if (!district) return;
    const name = lib.canonicalName(label);
    if (!name || name.length < 2) return;
    const prev = best.get(id);
    if (prev && (CAT_RANK[prev.c] || 0) >= (CAT_RANK[cat] || 0)) return;
    const place = {
      n: name,
      q: lib.searchKey(name),
      c: cat,
      lat: round5(lat),
      lng: round5(lng),
      i: 'wd' + id,
      d: district,
      src: 'wd',
      lic: 'CC0'
    };
    const hl = lib.highlightCodes(name);
    if (hl.length) place.hl = hl.join('');
    best.set(id, place);
  });
  return Array.from(best.values());
}

async function loadWikidata(districts) {
  const direct = 'SELECT ?item ?itemLabel ?coord ?type WHERE { ' + WD_BOX +
    ' VALUES ?type { ' + WD_DIRECT.map((id) => 'wd:' + id).join(' ') + ' } ?item wdt:P31 ?type . ' +
    'SERVICE wikibase:label { bd:serviceParam wikibase:language "th,en". } }';
  const sub = 'SELECT ?item ?itemLabel ?coord ?type WHERE { ' + WD_BOX +
    ' VALUES ?root { wd:Q46169 wd:Q23442 wd:Q33506 wd:Q570116 } ?item wdt:P31/wdt:P279* ?root . ?item wdt:P31 ?type . ' +
    'SERVICE wikibase:label { bd:serviceParam wikibase:language "th,en". } }';
  const directData = await sparql(direct, 'wikidata-direct.json');
  const subData = await sparql(sub, 'wikidata-sub.json');
  const places = wikidataPlaces(
    directData.results.bindings.concat(subData.results.bindings),
    districts
  );
  try {
    const found = new Set();
    for (const term of ['เขาพรายดำ', 'Khao Phrai Dam']) {
      const url = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=th&limit=5&search=' + encodeURIComponent(term);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      (data.search || []).forEach((row) => { if (row.id) found.add(row.id); });
    }
    const ids = Array.from(found).filter((id) => !places.some((place) => place.i === 'wd' + id));
    if (ids.length) {
      const infoUrl = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|claims&languages=th|en&ids=' + ids.join('|');
      const infoRes = await fetch(infoUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (infoRes.ok) {
        const info = await infoRes.json();
        ids.forEach((id) => {
          const entity = info.entities && info.entities[id];
          if (!entity || !entity.claims) return;
          const label = (entity.labels && ((entity.labels.th && entity.labels.th.value) || (entity.labels.en && entity.labels.en.value))) || '';
          if (!/พรายดำ|phrai.?dam/i.test(label)) return;
          const coord = (((entity.claims.P625 || [])[0] || {}).mainsnak || {}).datavalue;
          const value = coord && coord.value;
          if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return;
          const district = lib.assignDistrict(value.latitude, value.longitude, districts);
          if (!district) return;
          const name = lib.canonicalName(label);
          places.push({
            n: name,
            q: lib.searchKey(name + ' เขาพรายดำ'),
            c: 't',
            lat: round5(value.latitude),
            lng: round5(value.longitude),
            i: 'wd' + id,
            d: district,
            src: 'wd',
            lic: 'CC0'
          });
        });
      }
    }
  } catch (err) {
    console.error('wikidata name search', err && err.message ? err.message : err);
  }
  console.log('wikidata in province', places.length);
  return places;
}

async function loadTatRows() {
  const cachePath = path.join(CACHE_DIR, 'tat-accommodation.json');
  let text = '';
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000000) {
    text = fs.readFileSync(cachePath, 'utf8');
    console.log('cache tat-accommodation.json', fs.statSync(cachePath).size);
  } else {
    console.log('GET', TAT_URL);
    const res = await fetch(TAT_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error('TAT accommodation HTTP ' + res.status);
    text = await res.text();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, text);
  }
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data[Object.keys(data)[0]];
  if (!Array.isArray(rows)) throw new Error('TAT accommodation JSON has no row array');
  return rows;
}

function parseLatLng(value) {
  const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (lat < 7.5 || lat > 9.6 || lng < 99.0 || lng > 100.4) return null;
  return { lat: lat, lng: lng };
}

const TAMBON_ALIAS = {
  [lib.searchKey('ลำนาว')]: lib.searchKey('บ้านลำนาว'),
  [lib.searchKey('โพธิ์เสต็จ')]: lib.searchKey('โพธิ์เสด็จ'),
  [lib.searchKey('กระทูน')]: lib.searchKey('กะทูน'),
  [lib.searchKey('สำเภา')]: lib.searchKey('เสาเภา'),
  [lib.searchKey('หน้าสน')]: lib.searchKey('หน้าสตน'),
  [lib.searchKey('ทองหงส์')]: lib.searchKey('ทอนหงส์'),
  [lib.searchKey('ชมาย')]: lib.searchKey('ชะมาย'),
  [lib.searchKey('ไทรบุรี')]: lib.searchKey('ไทยบุรี')
};

function tambonMatchKey(value) {
  const stripped = String(value || '').replace(/\([^)]*\)/g, '').trim();
  if (!stripped || stripped === '-') return '';
  const key = lib.searchKey(stripped);
  return TAMBON_ALIAS[key] || key;
}

function findTambon(districtName, rawName, tambons) {
  const key = tambonMatchKey(rawName);
  if (!key) return null;
  const inDistrict = tambons.filter((tambon) => tambon.district === districtName && tambonMatchKey(tambon.name) === key);
  if (inDistrict.length === 1) return inDistrict[0];
  if (inDistrict.length > 1) return null;
  const anywhere = tambons.filter((tambon) => tambonMatchKey(tambon.name) === key);
  return anywhere.length === 1 ? anywhere[0] : null;
}

function tatPlaces(rows, districts, tambons) {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  rows.forEach((row) => {
    if (String(row.PROVINCE_NAME_TH || '').trim() !== 'นครศรีธรรมราช') return;
    const name = lib.canonicalName(String(row.ACC_NAME_TH || row.ACC_NAME_EN || '').trim());
    if (!name || name.length < 2) { dropped++; return; }
    const id = 'tat' + String(row.ACC_ID || name);
    if (seen.has(id)) return;
    seen.add(id);
    const dkey = adminKey(row.DISTRICT_NAME_TH);
    const namedDistrict = districts.find((d) => adminKey(d.name) === dkey || (dkey === 'นครศรีธรรมราช' && d.name === 'เมืองนครศรีธรรมราช'));
    const namedTambon = findTambon(namedDistrict ? namedDistrict.name : '', row.ACC_SUBDISTRICT_NAME || row.SUBDISTRICT_NAME_TH, tambons);
    const precise = parseLatLng(row.ACC_LOCATION);
    const preciseDistrict = precise ? lib.assignDistrict(precise.lat, precise.lng, districts) : '';
    const place = {
      n: name,
      q: lib.searchKey(name + ' ' + String(row.ACC_NAME_EN || '')),
      c: 'h',
      i: id,
      src: 'tat',
      lic: 'ODC'
    };
    const phone = String(row.ACC_TEL || '').trim();
    const web = String(row.ACC_WEBSITE || row.ACC_FACEBOOK || '').trim();
    if (phone) place.ph = phone.slice(0, 40);
    if (web) place.web = web.slice(0, 180);
    if (precise && preciseDistrict) {
      place.lat = round5(precise.lat);
      place.lng = round5(precise.lng);
      place.d = preciseDistrict;
    } else if (namedTambon) {
      place.lat = namedTambon.lat;
      place.lng = namedTambon.lng;
      place.d = namedTambon.district;
      place.t = namedTambon.name;
      place.ax = 1;
    } else {
      dropped++;
      return;
    }
    out.push(place);
  });
  return { places: out, dropped: dropped };
}

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
    .map((el) => lib.prepareDistrict(el))
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

  const tambons = ensureCodTambons().map((row) => {
    const district = districts.find((item) => item.name === row.district);
    if (!district) throw new Error('COD-AB district is not an OSM district: ' + row.district);
    const area = {
      id: row.id,
      name: row.name,
      district: district ? district.name : row.district,
      bbox: row.bbox,
      outers: row.outers,
      inners: row.inners || [],
      lat: row.lat,
      lng: row.lng
    };
    if (!lib.containsDistrict(area, area.lng, area.lat)) {
      const point = lib.interiorPoint(area);
      if (point) {
        area.lat = round5(point.lat);
        area.lng = round5(point.lng);
      }
    } else {
      area.lat = round5(area.lat);
      area.lng = round5(area.lng);
    }
    return area;
  }).filter((row) => row.name && districts.some((item) => item.name === row.district));
  console.log('tambon polygons', tambons.length);
  if (tambons.length < 140) throw new Error('Tambon polygons missing: ' + tambons.length);

  let finalPlaces = lib.finalizePlaces(places);
  finalPlaces.forEach((place) => stampTambon(place, tambons));
  const wdPlaces = await loadWikidata(districts);
  wdPlaces.forEach((place) => stampTambon(place, tambons));
  const tatRows = await loadTatRows();
  const tat = tatPlaces(tatRows, districts, tambons);
  tat.places.forEach((place) => { if (!place.ax) stampTambon(place, tambons); });
  const beforeWd = finalPlaces.length;
  finalPlaces = lib.mergeIncoming(finalPlaces, wdPlaces);
  const afterWd = finalPlaces.length;
  finalPlaces = lib.mergeIncoming(finalPlaces, tat.places);
  finalPlaces.forEach((place) => {
    place.n = lib.canonicalName(place.n);
    if (!place.q) place.q = lib.searchKey(place.n);
    if (!place.hl) {
      const hl = lib.highlightCodes(place.n);
      if (hl.length) place.hl = hl.join('');
    }
    if (!place.src) place.src = 'osm';
    if (!place.lic) place.lic = 'ODbL';
  });
  finalPlaces.sort((a, b) => a.d.localeCompare(b.d, 'th') || a.c.localeCompare(b.c) || a.n.localeCompare(b.n, 'th'));

  const counts = lib.countPlaces(finalPlaces);
  const watched = [
    { name: 'เขาพรายดำ', re: /พรายดำ|phrai.?dam|khao phrai/i },
    { name: 'ร้านแสงจันทร์', re: /แสงจันทร์|saengchan|saeng chan/i }
  ];
  const missingFromOsm = watched.filter((item) => !finalPlaces.some((place) => item.re.test(place.n) || item.re.test(place.q || ''))).map((item) => item.name);
  const airport = finalPlaces.find((place) => place.k === 'airport' && /นครศรี|nakhon|NST/i.test(place.n + ' ' + (place.q || '')));
  if (!airport) throw new Error('Nakhon Si Thammarat Airport was not found in OSM aerodromes');

  const accommodationByDistrict = {};
  const tourismByDistrict = {};
  const templesByDistrict = {};
  const sources = {};
  let approximate = 0;
  finalPlaces.forEach((place) => {
    sources[place.src] = (sources[place.src] || 0) + 1;
    if (place.ax) approximate++;
    if (place.c === 'h') accommodationByDistrict[place.d] = (accommodationByDistrict[place.d] || 0) + 1;
    if (place.c === 't' || place.c === 'v' || place.c === 'k') tourismByDistrict[place.d] = (tourismByDistrict[place.d] || 0) + 1;
    if (place.c === 'w') templesByDistrict[place.d] = (templesByDistrict[place.d] || 0) + 1;
  });
  const stayKeys = new Set(finalPlaces.filter((place) => place.c === 'h' && place.t).map((place) => place.d + '\t' + place.t));
  const tambonsWithoutAccommodation = tambons
    .filter((tambon) => !stayKeys.has(tambon.district + '\t' + tambon.name))
    .map((tambon) => 'อำเภอ' + tambon.district + ' ตำบล' + tambon.name)
    .sort((a, b) => a.localeCompare(b, 'th'));
  const coverage = {
    tambons: tambons.length,
    tambonsWithAccommodation: tambons.length - tambonsWithoutAccommodation.length,
    tambonsWithoutAccommodation: tambonsWithoutAccommodation,
    accommodationByDistrict: accommodationByDistrict,
    tourismByDistrict: tourismByDistrict,
    templesByDistrict: templesByDistrict,
    sources: sources,
    approximate: approximate,
    incoming: {
      wikidata: wdPlaces.length,
      wikidataAdded: afterWd - beforeWd,
      tat: tat.places.length,
      tatAdded: finalPlaces.length - afterWd,
      tatPrecise: tat.places.filter((place) => !place.ax).length,
      tatApproximate: tat.places.filter((place) => place.ax).length,
      tatDropped: tat.dropped
    }
  };

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
  districts.forEach((district) => {
    const name = district.name;
    const rows = byDistrict.get(name) || [];
    const slug = SLUGS[name] || lib.foldName(name) || 'district';
    const file = slug + '.json';
    const tambonNames = tambons
      .filter((tambon) => tambon.district === name)
      .map((tambon) => tambon.name)
      .filter((value, index, list) => list.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, 'th'));
    const body = {
      license: 'mixed',
      attribution: ATTRIBUTION,
      attributions: ATTRIBUTIONS,
      d: name,
      tambons: tambonNames,
      places: rows
    };
    const full = path.join(OUT_DIR, file);
    fs.writeFileSync(full, JSON.stringify(body));
    const bytes = fs.statSync(full).size;
    totalBytes += bytes;
    if (bytes > largest.bytes) largest = { file: file, bytes: bytes };
    districtMeta.push({ n: name, file: file, count: rows.length, tambons: tambonNames });
  });
  districtMeta.sort((a, b) => a.n.localeCompare(b.n, 'th'));
  const indexDoc = {
    license: 'mixed',
    attribution: ATTRIBUTION,
    attributions: ATTRIBUTIONS,
    area: 'จังหวัดนครศรีธรรมราช',
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap (ODbL), Wikidata (CC0), การท่องเที่ยวแห่งประเทศไทย accommodation register (Open Data Common)',
    provinceRelation: PROVINCE_RELATION,
    note: 'Named public places for the whole province, one file per district. OSM has no admin_level=8 tambon polygons here, so tambon comes from HDX COD-AB (CC BY-IGO). Stays without a published coordinate use that tambon reference point and have ax:1 (ตำแหน่งโดยประมาณ). Unnamed, private/residential, and route relations are omitted. Search keys are prebuilt in q. Chauat curated rows stay in locations-data.js and data/chauat-places.json.',
    missingFromOsm: missingFromOsm,
    counts: counts,
    coverage: coverage,
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
    approximate: approximate,
    coverage: {
      tambons: coverage.tambons,
      tambonsWithAccommodation: coverage.tambonsWithAccommodation,
      tambonsWithout: tambonsWithoutAccommodation.length,
      sources: sources,
      incoming: coverage.incoming,
      accommodationByDistrict: accommodationByDistrict,
      tourismByDistrict: tourismByDistrict
    },
    counts: counts
  }, null, 2));
  if (!finalPlaces.length) throw new Error('No places written');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
