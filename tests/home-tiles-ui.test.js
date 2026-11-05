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
  assert.match(home, /ร้านพาร์ทเนอร์ ChauatGo พร้อมรับออเดอร์/);
  assert.match(home, /เปิดอยู่ พร้อมส่ง ดูเมนูและโปรโมชั่น แล้วสั่งได้เลย/);
});

test('home tiles stay compact and the partner banner is a soft card', () => {
  assert.match(html, /สั่งครบ จบที่เดียว/);
  assert.match(css, /\.header \.cg-brand \{[^}]*flex-direction: column[^}]*text-align: center/);
  assert.match(css, /\.header \.cg-brand-name \{[^}]*text-align: center/);
  assert.match(css, /\.menu-grid \{ gap: 12px/);
  assert.match(css, /\.menu-item \{[^}]*background: #fff/);
  assert.match(css, /\.menu-icon \{[^}]*width: 64px/);
  assert.match(css, /\.menu-icon\.food \{ background: #FF9A3C/);
  assert.match(css, /\.menu-icon\.shopping \{ background: #2EAE6A/);
  assert.match(css, /\.menu-icon\.travel \{ background: #F26B8A/);
  assert.match(css, /\.menu-icon\.express \{ background: #C4956A/);
  assert.match(css, /\.menu-icon\.hotel \{ background: #7C6AE0/);
  assert.match(css, /\.menu-icon\.map \{ background: #4EB6E8/);
  assert.match(home, /class="menu-glyph"/);
  assert.match(css, /\.header-top \.search-bar \{[^}]*border-radius: 999px[^}]*background: #fff/);
  assert.match(css, /\.home-section \.section-more \{[^}]*border-radius: 999px[^}]*min-height: 44px/);
  assert.match(css, /\.partner-cta-btn \{[^}]*border-radius: 999px[^}]*min-height: 48px/);
  assert.match(css, /\.brand-hero \{[^}]*background: #fff/);
  assert.match(css, /\.brand-hero \.t \{[^}]*font-size: 28px[^}]*color: #E85C00/);
  assert.match(css, /\.partner-banner-kicker \{[^}]*background: #E53935/);
  assert.match(css, /\.nearby-title \{[^}]*background: #fff/);
  assert.match(css, /\.home-section \{[^}]*background: #fff/);
  assert.match(css, /\[data-theme="dark"\] \.nearby-title \{[^}]*background: #121A14/);
  assert.match(css, /\[data-theme="dark"\] \.menu-item \{[^}]*background: #17261B/);
  assert.match(css, /\[data-theme="dark"\] \.brand-hero \.t \{[^}]*color: #FF9E3D/);
  assert.match(css, /#tab-home \{ background: #3F8E26/);
  assert.match(css, /\.section-restaurant \{ --section: #2F7D32/);
  assert.equal(css.includes('#FFF1E6'), false);
  assert.equal(css.includes('#E85B2A'), false);
  assert.equal(css.includes('#FF6B35 0%'), false);
  assert.equal(css.includes('border: 4px solid #D9601A'), false);
  assert.equal(css.includes('font-size: 58cqi'), false);
});
