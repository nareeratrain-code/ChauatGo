const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const html = fs.readFileSync('merchant.html', 'utf8');
const js = fs.readFileSync('merchant.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

test('merchant shell matches the phone admin layout', () => {
  assert.match(html, /\.app-header \{\s*border-radius: 0;/);
  assert.match(html, /shop-summary-card money/);
  assert.match(html, /text-shadow: 0 1px 0 #000/);
  assert.match(html, /id="stat-done"/);
  assert.match(html, /id="hero-revenue"/);
  assert.match(html, /id="stat-gp"/);
  assert.match(html, /id="orders-loading"/);
  assert.match(html, /id="menus-loading"/);
  assert.match(html, /data-stock="out_of_stock"/);
  assert.match(html, /rejectFromPopup\(\)/);
  assert.match(html, /acceptFromPopup\(\)/);
  assert.match(html, /white-space: nowrap/);
  assert.match(html, /รอไรเดอร์รับ/);
  assert.match(html, /วัตถุดิบหมด/);
});

test('merchant orders come from the safe inbox and respect the saved alert sound', () => {
  assert.match(js, /collection\('orderInbox'\)/);
  assert.match(js, /soundSettings/);
  assert.match(js, /collection\('private'\)\.doc\('profile'\)/);
  assert.match(js, /volumeKey === 'off'/);
  assert.match(js, /customerName/);
  assert.equal(js.includes('order.address'), false);
  assert.equal(js.includes('userPhone'), false);
  assert.match(js, /function orderIsHistory/);
  assert.match(js, /function setMenuStock/);
  assert.match(js, /__shop/);
  assert.match(js, /function shopWaitingPickup/);
  assert.match(js, /function openStockIssue/);
  const card = js.slice(js.indexOf('function renderOrderCard'), js.indexOf('function isShopKitchen'));
  assert.match(card, /shopHistory/);
  assert.equal(card.includes('openChatWithCustomer'), true);
  const historyBranch = card.slice(card.indexOf('const contactActions'));
  assert.match(historyBranch, /finished \? ''/);
});

test('a shop cannot read the raw order document', () => {
  const read = rules.slice(rules.indexOf('function canReadOrder'), rules.indexOf('function noDispatchControl'));
  assert.equal(read.includes('merchantId'), false);
  assert.match(rules, /match \/orderInbox\/\{orderId\}/);
  assert.match(rules, /function readerIsFinishedMerchant/);
  assert.match(rules, /function readerIsOrderMerchant/);
});
