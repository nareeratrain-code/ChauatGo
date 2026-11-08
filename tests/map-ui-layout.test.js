'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function mobileMapCss() {
  const start = source.indexOf('@media (max-width: 600px) {');
  const end = source.indexOf('\n}\n.bottom-nav', start);
  assert.ok(start >= 0 && end > start, 'mobile map CSS block should exist');
  return source.slice(start, end);
}

test('mobile map keeps the collapsed sheet compact so the map remains dominant', () => {
  const css = mobileMapCss();
  assert.match(css, /#map-page\s*\{[^}]*--dest-sheet-h:\s*28vh/);
  assert.match(css, /#map-page \.dest-sheet\s*\{[^}]*max-height:\s*52vh/);
  assert.match(css, /#map-page \.dest-sheet\.expanded\s*\{[^}]*--dest-sheet-h:\s*44vh[^}]*height:\s*44vh/);
  assert.doesNotMatch(css, /--dest-sheet-h:\s*72%/);
});

test('mobile map uses touch-safe, readable controls', () => {
  const css = mobileMapCss();
  assert.match(css, /\.map-back-btn\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.loc-action-btn\s*\{[^}]*min-height:\s*52px/);
  assert.match(css, /\.dest-search\s*\{[^}]*min-height:\s*58px/);
  assert.match(css, /\.dest-search input\s*\{[^}]*font-size:\s*18px/);
  assert.match(css, /\.map-fab\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/);
  assert.match(css, /\.map-confirm-btn\s*\{[^}]*min-height:\s*58px[^}]*font-size:\s*17px/);
});

test('map page remains full-height on mobile devices with dynamic browser chrome', () => {
  const css = mobileMapCss();
  assert.match(css, /#map-page\s*\{[^}]*min-height:\s*100dvh/);
  assert.match(source, /#main-map\s*\{\s*width:\s*100%;\s*height:\s*100%/);
});

test('map page avoids spanning a foldable hinge when viewport segments are available', () => {
  assert.match(source, /@supports\s*\(height:\s*100dvh\)\s*\{[^}]*#map-page\s*\{[^}]*width:\s*100dvw[^}]*height:\s*100dvh/s);
  assert.match(source, /@media\s*\(horizontal-viewport-segments:\s*2\)\s*\{[^}]*viewport-segment-width\s+0\s+0/s);
  assert.match(source, /@media\s*\(vertical-viewport-segments:\s*2\)\s*\{[^}]*viewport-segment-height\s+0\s+0/s);
});

test('map controls account for safe-area insets and dynamic viewport resize', () => {
  const css = mobileMapCss();
  assert.match(css, /map-header-bar[^}]*safe-area-inset-top/s);
  assert.match(css, /map-float-controls[^}]*safe-area-inset-right/s);
  assert.match(source, /function mapViewportHeight\(\)[\s\S]*page\.clientHeight[\s\S]*visualViewport/);
  assert.match(source, /function scheduleMapViewportSync\(\)[\s\S]*invalidateSize/);
  assert.match(source, /visualViewport\.addEventListener\(['"]resize['"]/);
});
