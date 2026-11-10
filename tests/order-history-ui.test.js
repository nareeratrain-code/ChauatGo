const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const admin = fs.readFileSync('admin.js', 'utf8');
const css = fs.readFileSync('admin.css', 'utf8');

test('finished customer orders render a receipt and a reorder button', () => {
  assert.match(app, /function renderHistoryCard/);
  assert.match(app, /สั่งอีกครั้ง/);
  assert.match(app, /done\.map\(renderHistoryCard\)/);
  assert.match(app, /class="order-history-card"/);
  const history = app.slice(app.indexOf('function renderHistoryCard'), app.indexOf('function renderOrderCard'));
  assert.equal(history.includes('openChatPage'), false);
  assert.equal(history.includes('ChauatCall'), false);
  assert.equal(history.includes('pickCustomerSlip'), false);
  assert.equal(history.includes('openTrackingPage'), false);
});

test('admin summary and order chips stay on the phone layout', () => {
  assert.match(admin, /class="admin-summary"/);
  assert.match(admin, /ออเดอร์วันนี้/);
  assert.match(admin, /ไรเดอร์พร้อมงาน/);
  assert.match(admin, /รายได้ GP วันนี้/);
  assert.match(admin, /data-order-status/);
  assert.match(admin, /กำลังโหลดออเดอร์/);
  assert.match(css, /\.admin-summary-card\.money strong/);
  assert.match(css, /text-shadow: 0 1px 0 #000/);
  assert.match(css, /border-radius: 0/);
});

test('a finished rider job does not keep chat, call, or navigation actions', () => {
  const card = rider.slice(rider.indexOf('function renderJobCard'), rider.indexOf('function findKnownOrder'));
  assert.match(card, /const jobFinished = \['done', 'delivered', 'cancelled', 'shop_closed'\]/);
  assert.match(card, /jobFinished \? '' : riderNavBlock/);
  assert.match(card, /const chatBtn = jobFinished \? ''/);
});
