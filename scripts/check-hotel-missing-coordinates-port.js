#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const checks = [
  ['hotelPhone helper', /function hotelPhone\(p\)/],
  ['hotel card renderer', /function renderHotelCardHTML\(p\)/],
  ['hotel detail renderer', /function openHotelDetail\(p\)/],
  ['destination handler', /window\.setDestFromPlace = function\(placeId\)/],
  ['current ride destination handoff', /openRideOrderForm\(\{ missing: true \}\)/],
  ['current selected destination state', /selectedDestination\s*=\s*\{\s*lat:\s*Number\(p\.lat\)/],
];

const failures = [];
for (const [label, pattern] of checks) {
  if (!pattern.test(html)) failures.push(`missing current-flow anchor: ${label}`);
}

const legacySignals = [
  ['legacy hotel coordinate helper', /function hotelHasCoordinates\(/],
  ['legacy missing-coordinate class', /hotel-destination-missing/],
];

const alreadyPorted = legacySignals.filter(([, pattern]) => pattern.test(html)).map(([label]) => label);
const legacyBookingSignals = [
  ['Agoda helper', /function hotelBookingUrl\(/],
  ['Agoda handler', /function openHotelBooking\(/],
  ['Agoda label', /ค้นหา Agoda/],
];
const bookingPresent = legacyBookingSignals.filter(([, pattern]) => pattern.test(html)).map(([label]) => label);

const handlerStart = html.indexOf('window.setDestFromPlace = function(placeId)');
const handlerEnd = html.indexOf('\n};', handlerStart);
const handler = handlerStart >= 0 && handlerEnd >= 0 ? html.slice(handlerStart, handlerEnd) : '';
if (handler && /p\.lat\s*\|\|\s*0|p\.lng\s*\|\|\s*0/.test(handler)) {
  failures.push('destination handler contains fabricated 0 coordinate fallback');
}

if (failures.length) {
  console.error('Hotel missing-coordinate port preflight: BLOCKED');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('Hotel missing-coordinate port preflight: READY');
  console.log('- Current hotel destination flow anchors found');
  console.log(`- Missing-coordinate logic already present: ${alreadyPorted.length ? alreadyPorted.join(', ') : 'none'}`);
  console.log(`- Legacy booking signals still present in main: ${bookingPresent.length ? bookingPresent.join(', ') : 'none'}`);
  if (bookingPresent.length) {
    console.log('- Do not restore or copy booking code while porting PR #82.');
  }
  console.log('- Next safe step: add hotelHasCoordinates(), guarded renderers, handler guard, CSS, and focused tests.');
}
