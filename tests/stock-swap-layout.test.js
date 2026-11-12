'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const rider = fs.readFileSync('rider.js', 'utf8');
const css = fs.readFileSync('rider.css', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');
const shop = fs.readFileSync('merchant.js', 'utf8');
const shopHtml = fs.readFileSync('merchant.html', 'utf8');

test('rider exit actions sit on their own full-width row', () => {
  assert.equal(rider.includes('primaryAction += riderExitButtons'), false);
  assert.match(rider, /const exitActions = riderExitButtons\(j\)/);
  assert.match(rider, /class="jc-exit-btn"/);
  assert.match(rider, /jc-exit-row/);
  const actions = rider.slice(rider.indexOf('<div class="jc-actions">'), rider.indexOf('function findKnownOrder'));
  assert.match(actions, /jc-exit-row/);
  assert.equal(actions.includes('ขอไรเดอร์คนใหม่'), false);
  const exitCss = css.slice(css.indexOf('.jc-exit-row'), css.indexOf('.jc-primary-btn'));
  assert.match(exitCss, /flex-direction:\s*column/);
  assert.match(exitCss, /\.jc-exit-btn \{[\s\S]*width:\s*100%/);
  assert.match(exitCss, /min-height:\s*48px/);
  assert.match(css, /\.jc-primary-btn \{[\s\S]*min-width:\s*0/);
});

test('the customer taps a menu instead of typing a name', () => {
  const swap = app.slice(app.indexOf('window.swapStockItem'), app.indexOf('window.removeStockItems'));
  assert.equal(swap.includes('prompt('), false);
  assert.equal(app.includes('พิมพ์ชื่อเมนูที่จะเปลี่ยน'), false);
  assert.match(app, /id="swap-menu-modal"/);
  assert.match(app, /function menuAvailableForSwap/);
  assert.match(app, /chooseSwapMenu/);
  assert.match(app, /writeStockChoice\(order, 'swapped'/);
  assert.match(swap, /menu\.image \|\| menu\.imageUrl/);
  const chat = app.slice(app.indexOf("m.automationKey === 'stock_issue'"), app.indexOf("html += '<div class=\"chat-bubble"));
  assert.match(chat, /__shop/);
  assert.match(chat, /swapStockItem/);
});

test('the shop lists one item per row and tells the customer in the shop thread', () => {
  assert.match(shopHtml, /\.stock-pick \{[^}]*display:\s*flex[^}]*width:\s*100%/);
  const submit = shop.slice(shop.indexOf('async function submitStockIssue'), shop.indexOf('async function readyOrder'));
  assert.match(submit, /automationKey: 'stock_issue'/);
  assert.match(submit, /shopChatId\(order\.id\)/);
  assert.match(submit, /เลือกเมนูใหม่ เอาออก หรือยกเลิกออเดอร์ได้จากปุ่มด้านล่าง/);
  assert.equal(submit.includes('userPhone'), false);
  assert.equal(submit.includes('address'), false);
});
