'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const cssStart = html.indexOf('<style>');
const css = html.slice(cssStart, html.indexOf('</style>', cssStart));
const searchRule = css.slice(css.indexOf('.merchant-view .merchant-search {'), css.indexOf('.merchant-view .merchant-search .search-bar'));

test('shopping search sits on the page without a cream strip behind it', () => {
  assert.match(css, /\.merchant-view\[data-entry="shopping"\] \.partner-food-banner \{ display: none; \}/);
  assert.match(searchRule, /background: transparent/);
  assert.match(searchRule, /margin: 0 0 12px/);
  assert.equal(searchRule.includes('-26px'), false);
  assert.equal(css.includes('#FED7AA'), false);
  assert.equal(css.includes('#FFF1E6'), true);
  const bar = css.slice(css.indexOf('.merchant-view .merchant-search .search-bar'), css.indexOf('.merchant-view .merchant-search .search-bar input'));
  assert.match(bar, /background: var\(--surface\)/);
  assert.match(bar, /border-radius: 17px/);
  assert.match(css, /\.merchant-view\[data-entry="shopping"\] \.merchant-map-btn[\s\S]*#E85C00/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.merchant-view \{ overflow-x: clip/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.merchant-map-btn \{ min-width: 88px/);
});
