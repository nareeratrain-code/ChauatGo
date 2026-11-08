'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('mobile map picker gives the map the primary viewport and uses a floating sheet', () => {
  assert.match(source, /@media \(max-width: 600px\) \{[\s\S]*?#map-page \{ --dest-sheet-h: 28vh; min-height: 100dvh; \}/);
  assert.match(source, /#map-page \.dest-sheet \{[\s\S]*?height: 28vh;[\s\S]*?max-height: 72vh;/);
  assert.match(source, /#map-page \.dest-sheet\.expanded \{ --dest-sheet-h: 42vh; height: 42vh; \}/);
  assert.match(source, /#map-page:has\(\.dest-sheet\.expanded\) \{ --dest-sheet-h: 42vh; \}/);
});

test('mobile map picker keeps controls touch-safe and readable over the map', () => {
  assert.match(source, /#map-page \.dest-search \{ min-height: 56px; font-size: 17px; \}/);
  assert.match(source, /id="dest-current-location-btn"[^>]+aria-label="ใช้ตำแหน่งปัจจุบันของฉัน"/);
  assert.doesNotMatch(source, /id="map-loc-status"/);
  assert.doesNotMatch(source, /<div class="reference-loc-bar" id="map-loc-bar">/);
  assert.match(source, /#map-page \.map-confirm-btn \{ min-height: 56px;[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(source, /#map-page \.map-float-controls \{ right: 14px; bottom: calc\(var\(--dest-sheet-h\) \+ 14px\); \}/);
});

test('destination selection shows a Thai location confirmation popup after a pick', () => {
  assert.match(source, /id="location-picked-popup"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(source, /id="location-picked-title">เลือกตำแหน่งของคุณ<\/h2>/);
  assert.match(source, /destSelectionPopupPending = true;/);
  assert.match(source, /showLocationPickedPopup\(\);/);
  assert.match(source, /window\.closeLocationPickedPopup/);
});

test('map-first layout does not remove the destination search or confirmation action', () => {
  assert.match(source, /id="dest-search-input"/);
  assert.match(source, /id="map-confirm-btn" onclick="confirmMapLocation\(\)"/);
  assert.match(source, /id="dest-sheet-handle"[^>]+aria-expanded="false"/);
});

test('bottom sheet uses a dedicated drag state without transition jank', () => {
  assert.match(source, /\.dest-sheet\.is-dragging\s*\{[^}]*transition:\s*none\s*!important[^}]*user-select:\s*none/);
  assert.match(source, /\.dest-sheet-handle:active, \.dest-sheet\.is-dragging \.dest-sheet-handle\s*\{[^}]*cursor:\s*grabbing/);
  assert.match(source, /\.dest-sheet\s*\{[^}]*will-change:\s*height/);
  assert.match(source, /sheet\.classList\.add\('is-dragging'\)/);
  assert.match(source, /sheet\.classList\.remove\('is-dragging'\)/);
});

test('dragging updates map offset dynamically and snaps on release', () => {
  assert.match(source, /sheet\.style\.height = next \+ 'px'/);
  assert.match(source, /page\.style\.setProperty\('--dest-sheet-h', next \+ 'px'\)/);
  assert.match(source, /if \(raw < minHeight\) next = minHeight - \(minHeight - raw\) \* 0\.24/);
  assert.match(source, /if \(raw > maxHeight\) next = maxHeight \+ \(raw - maxHeight\) \* 0\.24/);
  assert.match(source, /setDestSheetExpanded\(h > viewportHeight \* 0\.42\)/);
  assert.match(source, /page\.style\.removeProperty\('--dest-sheet-h'\)/);
});
