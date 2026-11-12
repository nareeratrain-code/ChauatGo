'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const app = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const shop = fs.readFileSync('merchant.js', 'utf8');

test('the buy-for-me title and close button do not share an overlapping row', () => {
  const head = app.slice(app.indexOf('class="merchant-view-head"'), app.indexOf('class="partner-food-topbar"'));
  assert.match(head, /merchant-view-head-row/);
  assert.match(head, /id="merchant-view-title"/);
  assert.match(head, /✕ ปิด/);
  assert.match(head, /id="merchant-view-kicker"/);
  const titleAt = head.indexOf('id="merchant-view-title"');
  const closeAt = head.indexOf('✕ ปิด');
  const kickerAt = head.indexOf('id="merchant-view-kicker"');
  assert.ok(titleAt < closeAt);
  assert.ok(closeAt < kickerAt);
  assert.match(app, /\.merchant-view \.merchant-view-head \.section-title \{[^}]*min-width:\s*0/);
  assert.match(app, /\.merchant-view \.merchant-view-head \.section-title \{[^}]*flex:\s*1 1 auto/);
  assert.match(app, /\.merchant-view \.merchant-view-head \.section-more \{[^}]*flex:\s*0 0 auto/);
  assert.match(app, /\.merchant-view \.merchant-view-head \.section-title \{[^}]*color:\s*#fff/);
  assert.match(app, /\.merchant-view \.merchant-view-head \.section-title \{[^}]*text-shadow:\s*none/);
});

test('the buy-for-me confirm step warns about the 20 baht arrival fee', () => {
  const form = app.slice(app.indexOf('window.openShopOrderForm'), app.indexOf('window.addQuickItem'));
  assert.match(form, /id="shopping-stockout-warning"/);
  assert.match(form, /ค่าบริการเริ่มต้น <b>20 บาท<\/b>/);
  assert.match(form, /ของที่ไม่ได้ซื้อไม่คิดเงิน/);
  const partner = shop.slice(shop.indexOf('async function submitStockIssue'), shop.indexOf('async function readyOrder'));
  assert.equal(partner.includes('20 บาท'), false);
});

test('ของหมด after arrival goes through the server fee and not a free client cancel', () => {
  assert.match(rider, /reportShoppingStockout/);
  assert.match(rider, /shopArrivedAt/);
  assert.match(rider, /ค่าบริการเริ่มต้น 20 บาท/);
  assert.match(rules, /function shoppingStockoutNeedsServer/);
  assert.match(rules, /function riderShoppingArrivalOk/);
  assert.match(rules, /!shoppingStockoutNeedsServer\(\)/);
  assert.match(app, /function shoppingStockoutPanel/);
  assert.match(app, /shopping_stockout/);
});
