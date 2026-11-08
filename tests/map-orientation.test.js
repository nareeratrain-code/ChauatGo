'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function orientationLayout(width, height, expanded) {
  const mobile = width <= 600;
  const sheetRatio = mobile ? (expanded ? 0.56 : 0.28) : (expanded ? 0.72 : null);
  const sheetHeight = sheetRatio ? Math.min(height * sheetRatio, height * 0.72) : 236;
  return {
    mobile,
    sheetHeight,
    mapHeight: Math.max(0, height - 64 - sheetHeight),
    overflowsHorizontally: false
  };
}

test('Map registers resize, orientationchange, and visualViewport resize listeners', () => {
  assert.match(source, /window\.addEventListener\('resize', scheduleMapViewportSync/);
  assert.match(source, /window\.addEventListener\('orientationchange', scheduleMapViewportSync/);
  assert.match(source, /window\.visualViewport\.addEventListener\('resize', scheduleMapViewportSync/);
});

test('orientation handler debounces and performs multiple post-layout sync frames', () => {
  assert.match(source, /clearTimeout\(mapViewportSyncTimer\)/);
  assert.match(source, /mapViewportSyncTimer = setTimeout\(function\(\)/);
  assert.match(source, /requestAnimationFrame\(function\(\)/);
  assert.match(source, /requestAnimationFrame\(syncMapViewportAfterOrientation\)/);
});

test('orientation handler resets transient drag state and stale inline height', () => {
  assert.match(source, /sheet\.classList\.remove\('is-dragging'\)/);
  assert.match(source, /sheet\.style\.transition = ''/);
  assert.match(source, /sheet\.style\.height = ''/);
  assert.match(source, /page\.style\.removeProperty\('--dest-sheet-h'\)/);
});

test('orientation handler invalidates Leaflet without animated panning', () => {
  assert.match(source, /map\.invalidateSize\(\{ animate: false, pan: false \}\)/);
});

test('foldable and tablet portrait/landscape layouts remain inside viewport bounds', () => {
  for (const [width, height] of [[280, 653], [653, 280], [540, 720], [720, 540], [768, 1024], [1024, 768]]) {
    for (const expanded of [false, true]) {
      const layout = orientationLayout(width, height, expanded);
      assert.ok(layout.sheetHeight >= 0 && layout.sheetHeight <= height, `${width}x${height} sheet bounds`);
      assert.ok(layout.mapHeight >= 0, `${width}x${height} map bounds`);
      assert.equal(layout.overflowsHorizontally, false, `${width}x${height} horizontal overflow`);
    }
  }
});

test('mobile orientation keeps the intended compact and expanded proportions', () => {
  const foldPortrait = orientationLayout(280, 653, false);
  const foldLandscape = orientationLayout(653, 280, false);
  const duoPortrait = orientationLayout(540, 720, true);
  const duoLandscape = orientationLayout(720, 540, true);
  assert.equal(foldPortrait.mobile, true);
  assert.equal(foldLandscape.mobile, false);
  assert.ok(foldPortrait.sheetHeight < 653 * 0.4);
  assert.ok(foldLandscape.sheetHeight < 280);
  assert.ok(duoPortrait.sheetHeight > duoLandscape.sheetHeight);
});
