const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');
const cssStart = html.indexOf('/* ═══ MENU ENTRY');
const css = html.slice(cssStart, html.indexOf('</style>', cssStart));

test('each home menu keeps its entry behavior', () => {
  assert.match(html, /openMerchantView\('food'\)/);
  assert.match(html, /openMerchantView\('shopping'\)/);
  assert.match(html, /openTravelView\(\)/);
  assert.match(html, /openOrderForm\('express'\)/);
  assert.match(html, /showCategory\('hotel'\)/);
  assert.match(html, /openMapPage\(\)/);
  assert.match(html, /id="merchant-source-tabs"/);
  assert.match(html, /id="merchant-filter-bar"/);
  assert.match(html, /id="map-confirm-btn" onclick="confirmMapLocation\(\)"/);
  assert.match(html, /data-exp-submit="1"/);
  assert.match(html, /dataset\.entry = merchantMode/);
});

test('entry screens use orange, red, green, white, and black accents', () => {
  const shadowStart = css.indexOf('.on-green-orange');
  const shadow = css.slice(shadowStart, css.indexOf('}', shadowStart) + 1);
  assert.match(shadow, /text-shadow:[\s\S]*#000/);
  assert.equal(shadow.includes('#fff'), false);
  assert.match(css, /\.merchant-view \.section-title[\s\S]*color: #E85C00/);
  assert.match(css, /\.merchant-view \.section-more[\s\S]*background: #E53935/);
  assert.match(css, /\.merchant-view\[data-entry="shopping"\] \.merchant-map-btn[\s\S]*#E85C00/);
  assert.match(css, /\.travel-view \.travel-map-btn[\s\S]*#E85C00/);
  assert.match(css, /#express-parcel-type[\s\S]*border: 2px solid #111/);
  assert.match(css, /#hotel-tools \.loc-action-btn\[data-refresh-gps\][\s\S]*#E53935/);
  assert.match(css, /#map-page \.map-confirm-btn \{ border-radius: 999px; background: #111; \}/);
  assert.match(css, /\[data-theme="dark"\] \.merchant-card/);
});

test('focused menu screens hide the global search and restore it on close', () => {
  assert.match(html, /\.header\.menu-focus \.header-top \.search-bar \{ display: none; \}/);
  assert.match(html, /function setMenuFocus\(active\)/);
  assert.match(html, /setMenuFocus\(true\);[\s\S]{0,180}if\(\$\('home-content'\)\)/);
  assert.match(html, /closeCategoryView = function\(\)\{[\s\S]*?setMenuFocus\(false\);/);
  assert.match(html, /closeMerchantView = function\(\)\{[\s\S]*?setMenuFocus\(false\);/);
});
