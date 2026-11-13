#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const testPath = path.join(root, 'tests', 'hotel-missing-coordinates-ui.test.js');
const checkOnly = process.argv.includes('--check');
let html = fs.readFileSync(htmlPath, 'utf8');
const original = html;
const changes = [];

function requireAnchor(anchor, label) {
  if (!html.includes(anchor)) {
    throw new Error(`ไม่พบ anchor สำหรับ ${label}: ${anchor.slice(0, 120)}`);
  }
}
function replaceOnce(from, to, label) {
  const count = html.split(from).length - 1;
  if (count === 0) throw new Error(`ไม่พบจุดแก้ไข ${label}`);
  if (count > 1) throw new Error(`พบจุดแก้ไข ${label} มากกว่า 1 จุด (${count})`);
  html = html.replace(from, to);
  changes.push(label);
}
function insertAfter(anchor, addition, label) {
  requireAnchor(anchor, label);
  replaceOnce(anchor, anchor + addition, label);
}

const helperMarker = 'function hotelHasCoordinates(place) {';
if (!html.includes(helperMarker)) {
  insertAfter(
    'function hotelPhone(p){ return String(p.phone || \'\').trim(); }',
    `\nfunction hotelCoordinateIsValid(value, min, max) {\n  if (value === null || value === undefined ||\n      (typeof value === 'string' && value.trim() === '')) return false;\n  var number = Number(value);\n  return Number.isFinite(number) && number >= min && number <= max;\n}\nfunction hotelHasCoordinates(place) {\n  return !!place &&\n    hotelCoordinateIsValid(place.lat, -90, 90) &&\n    hotelCoordinateIsValid(place.lng, -180, 180);\n}\n`,
    'hotel coordinate helpers'
  );
}

if (!html.includes('hotel-action.destination:disabled')) {
  insertAfter(
    '.hotel-action.destination { background: #E8F5E9; color: #2E7D32; border: 1px solid rgba(46,125,50,.2); }',
    `\n.hotel-action.destination:disabled, .hotel-action.destination.disabled { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); cursor: not-allowed; opacity: .72; box-shadow: none; }\n.hotel-destination-missing { margin: 8px 0 0; padding: 10px 12px; border-radius: 12px; background: #FFF4E5; color: #9A5A00; border: 1px solid #F4C27A; font-size: 12px; line-height: 1.45; font-weight: 800; }\n[data-theme="dark"] .hotel-destination-missing { background: #3A2915; color: #FFD58A; border-color: #8A6228; }`,
    'missing-coordinate CSS'
  );
}

const cardStart = html.indexOf('function renderHotelCardHTML(p)');
const cardEnd = html.indexOf('\nfunction provinceDistrictNames', cardStart);
if (cardStart < 0 || cardEnd < 0) throw new Error('ไม่พบ hotel card renderer');
let card = html.slice(cardStart, cardEnd);
if (!card.includes('var canSetDestination = hotelHasCoordinates(p);')) {
  card = card.replace(
    '  var hasImg = hasRealImage(p.image);\n',
    '  var hasImg = hasRealImage(p.image);\n  var canSetDestination = hotelHasCoordinates(p);\n'
  );
  card = card.replace(
    "  var distance = userLocation ? ' • 📍 ' + fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng)) : '';",
    "  var distance = userLocation && canSetDestination ? ' • 📍 ' + fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng)) : '';"
  );
  card = card.replace(
    "  var image = hasImg ? '<img src=\"'+esc(p.image)+'\" loading=\"lazy\" onerror=\"this.parentElement.innerHTML=\\'<span>🏨</span>\\'\">' : '<span>🏨</span>';",
    "  var image = hasImg ? '<img src=\"'+esc(p.image)+'\" alt=\"'+esc(p.name)+'\" loading=\"lazy\" onerror=\"this.parentElement.innerHTML=\\'<span>🏨</span>\\'\">' : '<span>🏨</span>';"
  );
  const oldActions = `    '<div class="hotel-card-actions">' +\n    '<button type="button" class="hotel-action destination" onclick="event.stopPropagation();setDestFromPlace(\\''+esc(p.id)+'\\')">🎯 ปลายทาง</button>' +\n    '<button type="button" class="hotel-action book" onclick="event.stopPropagation();openHotelBooking(\\''+esc(p.id)+'\\')">ค้นหา Agoda</button></div></div></article>';`;
  const newActions = `    '<div class="hotel-card-actions">' +\n    (canSetDestination ? '<button type="button" class="hotel-action destination" onclick="event.stopPropagation();setDestFromPlace(\\''+esc(p.id)+'\\')">🎯 ปลายทาง</button>' : '<button type="button" class="hotel-action destination disabled" disabled aria-disabled="true" aria-describedby="hotel-missing-coordinate-'+esc(p.id)+'" title="ที่พักนี้ยังไม่มีพิกัด">⚠️ ไม่มีพิกัด</button>') +\n    '<button type="button" class="hotel-action book" onclick="event.stopPropagation();openHotelBooking(\\''+esc(p.id)+'\\')">ค้นหา Agoda</button></div>' +\n    (canSetDestination ? '' : '<div id="hotel-missing-coordinate-'+esc(p.id)+'" class="hotel-destination-missing" role="status" aria-live="polite">⚠️ ที่พักนี้ยังไม่มีพิกัด จึงยังตั้งเป็นปลายทางไม่ได้</div>') +\n    '</div></article>';`;
  if (!card.includes(oldActions)) throw new Error('ไม่พบ hotel card action anchor');
  card = card.replace(oldActions, newActions);
  html = html.slice(0, cardStart) + card + html.slice(cardEnd);
  changes.push('hotel card validation/UI');
}

const detailStart = html.indexOf('function openHotelDetail(p)');
const detailEnd = html.indexOf('\nwindow.showPlaceDetail = function(placeId)', detailStart);
if (detailStart < 0 || detailEnd < 0) throw new Error('ไม่พบ hotel detail renderer');
let detail = html.slice(detailStart, detailEnd);
if (!detail.includes('var canSetDestination = hotelHasCoordinates(p);')) {
  detail = detail.replace('  var hasImg = hasRealImage(p.image);\n', '  var hasImg = hasRealImage(p.image);\n  var canSetDestination = hotelHasCoordinates(p);\n');
  detail = detail.replace(
    "  var distance = userLocation ? ' • 📍 ' + fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng)) : '';",
    "  var distance = userLocation && canSetDestination ? ' • 📍 ' + fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng)) : '';"
  );
  const oldCta = `    '<button class="btn-full btn-green press-scale" type="button" onclick="setDestFromPlace(\\''+esc(p.id)+'\\')">🎯 เพิ่มที่พักเป็นปลายทางให้ไรเดอร์</button>' +`;
  const newCta = `    (canSetDestination ? '<button class="btn-full btn-green press-scale" type="button" onclick="setDestFromPlace(\\''+esc(p.id)+'\\')">🎯 เพิ่มที่พักเป็นปลายทางให้ไรเดอร์</button>' : '<button class="btn-full btn-green press-scale" type="button" disabled aria-disabled="true" aria-describedby="hotel-detail-missing-coordinate" title="ที่พักนี้ยังไม่มีพิกัด">⚠️ ยังตั้งเป็นปลายทางไม่ได้</button><div id="hotel-detail-missing-coordinate" class="hotel-destination-missing" role="alert" aria-live="assertive">⚠️ ที่พักนี้ยังไม่มีพิกัด จึงยังตั้งเป็นปลายทางไม่ได้ กรุณาเลือกสถานที่อื่นที่มีหมุดบนแผนที่</div>') +`;
  if (!detail.includes(oldCta)) throw new Error('ไม่พบ hotel detail CTA anchor');
  detail = detail.replace(oldCta, newCta);
  html = html.slice(0, detailStart) + detail + html.slice(detailEnd);
  changes.push('hotel detail validation/UI');
}

const handlerStart = html.indexOf('window.setDestFromPlace = function(placeId)');
const handlerEnd = html.indexOf('\n};', handlerStart);
if (handlerStart < 0 || handlerEnd < 0) throw new Error('ไม่พบ destination handler');
let handler = html.slice(handlerStart, handlerEnd);
if (!handler.includes('hotelHasCoordinates(p)')) {
  replaceOnce(
    "  if (!p || !isFinite(Number(p.lat)) || !isFinite(Number(p.lng))) return showToast('ไม่พบตำแหน่งของสถานที่นี้', 'warning');",
    "  if (!p) return;\n  if (!hotelHasCoordinates(p)) return showToast('ที่พักนี้ยังไม่มีพิกัดสำหรับตั้งเป็นปลายทาง', 'warning');",
    'destination handler guard'
  );
  changes.push('destination handler guard');
}

const testSource = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, 'missing start marker: ' + startMarker);
  assert.notEqual(end, -1, 'missing end marker: ' + endMarker);
  return html.slice(start, end);
}

test('hotel coordinate validation rejects missing and invalid values', () => {
  assert.match(html, /function hotelCoordinateIsValid\\(value, min, max\\)/);
  assert.match(html, /typeof value === 'string' && value\\.trim\\(\\) === ''/);
  assert.match(html, /Number\\.isFinite\\(number\\)/);
  assert.match(html, /return !!place &&[\\s\\S]*hotelCoordinateIsValid\\(place\\.lat, -90, 90\\)/);
});

test('hotel card disables destination when coordinates are missing', () => {
  const card = blockBetween('function renderHotelCardHTML(p)', '\\nfunction provinceDistrictNames');
  assert.match(card, /var canSetDestination = hotelHasCoordinates\\(p\\)/);
  assert.match(card, /hotel-action destination disabled/);
  assert.match(card, /disabled aria-disabled="true"/);
  assert.match(card, /hotel-destination-missing/);
  assert.match(card, /role="status" aria-live="polite"/);
  assert.match(card, /alt="'\\+esc\\(p\\.name\\)/);
  assert.doesNotMatch(card, /hotel-action destination disabled[^>]+onclick=/);
});

test('hotel detail disables destination CTA when coordinates are missing', () => {
  const detail = blockBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(detail, /var canSetDestination = hotelHasCoordinates\\(p\\)/);
  assert.match(detail, /hotel-detail-missing-coordinate/);
  assert.match(detail, /role="alert" aria-live="assertive"/);
  assert.match(detail, /disabled aria-disabled="true"/);
});

test('destination handler blocks missing coordinates before creating destination state', () => {
  const handler = blockBetween('window.setDestFromPlace = function(placeId)', '\\n};');
  assert.match(handler, /if \\(!p\\) return;/);
  assert.match(handler, /hotelHasCoordinates\\(p\\)/);
  assert.match(handler, /ที่พักนี้ยังไม่มีพิกัดสำหรับตั้งเป็นปลายทาง/);
  assert.ok(handler.indexOf('hotelHasCoordinates(p)') < handler.indexOf('selectedDestination ='));
  assert.doesNotMatch(handler, /p\\.lat\\s*\\|\\|\\s*0|p\\.lng\\s*\\|\\|\\s*0/);
});

test('missing-coordinate CSS remains accessible in light and dark themes', () => {
  assert.match(html, /hotel-action\\.destination:disabled/);
  assert.match(html, /hotel-destination-missing \\{/);
  assert.match(html, /\\[data-theme="dark"\\] \\.hotel-destination-missing/);
});
`;

if (!checkOnly) {
  if (html !== original) fs.writeFileSync(htmlPath, html);
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(testPath, testSource);
}

console.log(`Hotel missing-coordinate port ${checkOnly ? 'check' : 'apply'} complete.`);
console.log(changes.length ? changes.map((item) => `- ${item}`).join('\n') : '- Already applied; no index.html changes needed.');
console.log(checkOnly ? '- No files written.' : `- Wrote ${path.relative(root, htmlPath)} and ${path.relative(root, testPath)}`);
