'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mobileBlock = source.slice(
  source.indexOf('@media (max-width: 600px) {'),
  source.indexOf('\n}\n.bottom-nav')
);

function cssVh(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{[^}]*${property}\\s*:\\s*([0-9.]+)vh`, 's');
  const match = mobileBlock.match(pattern);
  assert.ok(match, `expected ${property} in ${selector}`);
  return Number(match[1]) / 100;
}

function vhToPixels(ratio, viewportHeight) {
  return ratio * viewportHeight;
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: expected ${expected}, got ${actual}`);
}

const collapsedRatio = cssVh('#map-page', '--dest-sheet-h');
const expandedRatio = cssVh('#map-page .dest-sheet.expanded', '--dest-sheet-h');

test('Map sheet CSS uses the intended mobile height ratios', () => {
  assert.equal(collapsedRatio, 0.28);
  assert.equal(expandedRatio, 0.44);
});

test('collapsed and expanded sheet heights calculate correctly per mobile viewport', () => {
  const viewports = [
    { name: 'small Android', width: 320, height: 568 },
    { name: 'standard Android', width: 360, height: 800 },
    { name: 'large Android', width: 390, height: 844 },
    { name: 'large phone', width: 412, height: 915 }
  ];

  for (const viewport of viewports) {
    const collapsed = vhToPixels(collapsedRatio, viewport.height);
    const expanded = vhToPixels(expandedRatio, viewport.height);
    assertNear(collapsed, viewport.height * 0.28, `${viewport.name} collapsed height`);
    assertNear(expanded, viewport.height * 0.44, `${viewport.name} expanded height`);
    assert.ok(expanded > collapsed, `${viewport.name} expanded sheet should be taller`);
    assert.ok(expanded < viewport.height * 0.52, `${viewport.name} expanded sheet should stay below max-height`);
  }
});

test('expanded sheet leaves a usable map area above it on mobile', () => {
  const headerHeight = 64;
  const viewports = [
    { name: 'small Android', height: 568, minimumMapHeight: 240 },
    { name: 'standard Android', height: 800, minimumMapHeight: 300 },
    { name: 'large Android', height: 844, minimumMapHeight: 340 },
    { name: 'large phone', height: 915, minimumMapHeight: 380 }
  ];

  for (const viewport of viewports) {
    const stageHeight = viewport.height - headerHeight;
    const expandedSheetHeight = vhToPixels(expandedRatio, viewport.height);
    const visibleMapHeight = stageHeight - expandedSheetHeight;
    assert.ok(
      visibleMapHeight >= viewport.minimumMapHeight,
      `${viewport.name} should retain at least ${viewport.minimumMapHeight}px of map, got ${visibleMapHeight}px`
    );
  }
});

test('mobile expanded height remains below the 52vh safety cap', () => {
  const maxHeightRatio = cssVh('#map-page .dest-sheet', 'max-height');
  for (const height of [568, 800, 844, 915]) {
    assert.ok(vhToPixels(expandedRatio, height) < vhToPixels(maxHeightRatio, height));
  }
});
