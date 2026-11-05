const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');
const homeStart = html.indexOf('<div id="home-content">');
const homeEnd = html.indexOf('<div class="orders-tab"', homeStart);
const home = html.slice(homeStart, homeEnd);
const cssStart = html.indexOf('/* ═══ HOME V2');
const css = html.slice(cssStart, html.indexOf('/* Store detail page'));

test('home tiles keep the same destinations and Thai labels', () => {
  const tiles = [
    ["openMerchantView('food')", 'อาหาร'],
    ["openMerchantView('shopping')", 'ของใช้'],
    ['openTravelView()', 'เดินทาง'],
    ["openOrderForm('express')", 'ส่งด่วน'],
    ["showCategory('hotel')", 'โรงแรม ที่พัก'],
    ['openMapPage()', 'แผนที่']
  ];
  tiles.forEach(([action, label]) => {
    assert.match(home, new RegExp('onclick="' + action.replace(/[()]/g, '\\$&') + '"'));
    assert.match(home, new RegExp('class="menu-label">' + label + '</div>'));
  });
  assert.match(home, /สั่งอาหาร เรียกรถ ส่งของ/);
  assert.match(home, /อาหาร • เดินทาง • ส่งด่วน • ร้านค้า ในชะอวด/);
  assert.match(home, /เปิดร้านกับ ChauatGo/);
});

test('home tiles use a phone-sized surface card in light and dark', () => {
  assert.match(css, /\.menu-item \{[^}]*min-height: 112px/);
  assert.match(css, /\.menu-item \{[^}]*border-radius: 22px/);
  assert.match(css, /\.menu-emoji \{[^}]*font-size: 28px/);
  assert.match(css, /\.header-top \.search-bar \{[^}]*border-radius: 999px/);
  assert.match(css, /\.home-section \.section-more \{[^}]*border-radius: 999px[^}]*min-height: 44px/);
  assert.match(css, /\.partner-cta-btn \{[^}]*border-radius: 999px[^}]*min-height: 48px/);
  assert.match(css, /\.brand-hero \.t \{[^}]*white-space: normal/);
  assert.match(css, /\[data-theme="dark"\] \.menu-icon\.food/);
  assert.match(css, /\[data-theme="dark"\] \.section-restaurant/);
  assert.equal(css.includes('border: 4px solid #D9601A'), false);
  assert.equal(css.includes('font-size: 58cqi'), false);
});
