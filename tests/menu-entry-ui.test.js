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

test('food partner source is visually prominent and advertises delivery from entry', () => {
  assert.match(html, /class="merchant-source-tab partner-tab active"[^>]*data-source="partner"/);
  assert.doesNotMatch(html, /class="merchant-source-tab"[^>]*data-source="local"/);
  assert.match(html, /<div class="section-title">🍽️ ร้านอาหารในพื้นที่<\/div>/);
  assert.match(html, /<span class="delivery-icons"[^>]*>🚗 🛵<\/span> ร้านพาร์ทเนอร์/);
  assert.match(html, /สั่งได้ทันที • มีบริการเดลิเวอรี/);
  assert.match(html, /class="merchant-source-note partner-note"[^>]*>🚗 🛵 มีไรเดอร์รับส่งถึงบ้าน/);
  assert.match(css, /\.merchant-source-tabs\s*\{[^}]*grid-template-columns: 1fr/);
  assert.match(css, /\.merchant-source-tab\.partner-tab\s*\{[^}]*min-height: 76px[^}]*font-size: 17px/);
  assert.match(css, /\.merchant-source-tab\.partner-tab\.active\s*\{[^}]*#E53935[^}]*#B71C1C/);
  assert.match(css, /\.merchant-source-note\.partner-note\s*\{[^}]*#E53935/);
  assert.match(html, /sourceNote\.classList\.toggle\('partner-note', merchantSource === 'partner'\)/);
  assert.match(html, /merchantSource = 'partner';/);
});

test('focused menu screens hide the global search and restore it on close', () => {
  assert.match(html, /\.header\.menu-focus \.header-top \.search-bar \{ display: none; \}/);
  assert.match(html, /function setMenuFocus\(active\)/);
  assert.match(html, /setMenuFocus\(true\);[\s\S]{0,180}if\(\$\('home-content'\)\)/);
  assert.match(html, /closeCategoryView = function\(\)\{[\s\S]*?setMenuFocus\(false\);/);
  assert.match(html, /closeMerchantView = function\(\)\{[\s\S]*?setMenuFocus\(false\);/);
});
