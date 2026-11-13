const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('index.html', 'utf8');
const start = app.indexOf('function renderTrackingInfo(o)');
const end = app.indexOf('\nfunction clearTrackingGraphics()', start);
assert.ok(start >= 0 && end > start, 'tracking renderer should exist');
const tracking = app.slice(start, end);
const cardStart = app.indexOf('function renderOrderCard(o)');
const cardEnd = app.indexOf('/* Customer payment flow:', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'order card renderer should exist');
const card = app.slice(cardStart, cardEnd);

test('Partner Food keeps restaurant-specific tracking timeline', () => {
  assert.match(tracking, /isPartnerFood = o && o\.type === 'food' && o\.partnerShop === true/);
  assert.match(tracking, /ร้านรับออเดอร์/);
  assert.match(tracking, /อาหารพร้อม/);
  assert.match(tracking, /รับอาหารจากร้าน/);
});

test('Ride tracking uses ride milestones instead of restaurant milestones', () => {
  assert.match(tracking, /o\.type === 'ride'/);
  assert.match(tracking, /สร้างงานเรียกรถ/);
  assert.match(tracking, /รับผู้โดยสารแล้ว/);
  assert.match(tracking, /กำลังเดินทางไปปลายทาง/);
  const rideBranch = tracking.slice(tracking.indexOf("} else if (o.type === 'ride') {"), tracking.indexOf("} else {", tracking.indexOf("} else if (o.type === 'ride') {")));
  assert.doesNotMatch(rideBranch, /ร้านรับออเดอร์|อาหารพร้อม/);
});

test('Express tracking uses pickup and delivery milestones', () => {
  assert.match(tracking, /o\.type === 'express'/);
  assert.match(tracking, /ถึงจุดรับพัสดุ/);
  assert.match(tracking, /รับพัสดุแล้ว/);
  assert.match(tracking, /ถึงปลายทาง/);
  assert.match(tracking, /ส่งพัสดุสำเร็จ/);
});

test('Non-partner food and shopping tracking use generic rider milestones', () => {
  assert.match(tracking, /ถึงจุดรับสินค้า/);
  assert.match(tracking, /รับสินค้าแล้ว/);
  assert.match(tracking, /ส่งถึงลูกค้า/);
  assert.match(card, /pending:'⏳ รอไรเดอร์รับงาน'/);
  assert.match(card, /cooking:'📦 กำลังเตรียมสินค้า'/);
});

test('Ride confirmation toast is constrained on mobile', () => {
  const toastCss = app.slice(app.indexOf('.toast {'), app.indexOf('\n.toast.show'));
  assert.match(toastCss, /width:\s*max-content/);
  assert.match(toastCss, /max-width:\s*min\(90vw, 360px\)/);
  assert.match(toastCss, /max-height:\s*72px/);
  assert.match(toastCss, /line-height:\s*1\.35/);
  assert.match(app, /showToast\('✅ เรียกรถแล้ว ฿'/);
});
