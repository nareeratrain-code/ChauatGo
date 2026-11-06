const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const app = fs.readFileSync('index.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

test('โอนเงินแล้ว opens the photo library, not a camera-only capture', () => {
  const tag = app.match(/<input[^>]*id="customer-slip-input"[^>]*>/);
  assert.ok(tag, 'customer slip input');
  assert.match(tag[0], /accept="image\/\*"/);
  assert.equal(/capture\s*=/.test(tag[0]), false);
  assert.match(app, /window\.pickCustomerSlip = function\(orderId\)/);
  const picker = app.slice(app.indexOf('window.pickCustomerSlip'), app.indexOf('window.handleCustomerSlipPick'));
  assert.match(picker, /\$\('customer-slip-input'\)/);
  assert.equal(picker.includes('getUserMedia'), false);
  assert.equal(picker.includes('capture'), false);
});

test('storage lets the order owner upload a slip in any status and blocks everyone else', () => {
  const block = storage.slice(storage.indexOf('match /slips/customers/'), storage.indexOf('match /slips/orders/'));
  assert.match(block, /request\.auth\.uid == uid/);
  assert.match(block, /isOrderCustomer\(orderId\)/);
  assert.match(block, /allow update: if false/);
  assert.equal(block.includes('on_the_way'), false);
  assert.equal(block.includes('picked_up'), false);
  assert.match(storage, /function isOrderCustomer\(orderId\)/);
  assert.match(storage, /orderFieldIsMe\(orderId, 'userId'\)/);
});

test('customer slip upload sends an image content type for gallery files', () => {
  const upload = app.slice(app.indexOf('window.handleCustomerSlipPick'), app.indexOf('bindCustomerSlipInput'));
  assert.match(upload, /orders\/' \+ orderId \+ '\/riders\/' \+ currentUser\.uid \+ '\/slip_/);
  assert.match(upload, /rawType\.indexOf\('image\/'\) === 0 \? rawType : 'image\/jpeg'/);
  assert.match(upload, /contentType: mime/);
  assert.equal(upload.includes('contentType: file.type'), false);
});

test('express transfer keeps payment action available through the order chat', () => {
  assert.match(app, /function expressTransferOwed\(o\)/);
  assert.match(app, /o\.type === 'express' && o\.paymentMode !== 'cash' && o\.status === 'on_the_way'/);
  assert.match(app, /💳 โอนเงินแล้ว/);
  const card = app.slice(app.indexOf('function renderOrderCard'), app.indexOf('function customerGoodsTotal'));
  assert.match(card, /openChatPage/);
  assert.doesNotMatch(card, /expressTransferClick\(o\)\">💳 โอนเงินแล้ว/);
  const confirm = app.slice(app.indexOf('window.confirmCustomerPaid'), app.indexOf('function monitorRiderProximity'));
  assert.match(confirm, /cached\.type === 'express' && cached\.status === 'on_the_way'/);
  assert.match(confirm, /if \(!expressDropoff\) paidPatch\.status = 'customer_paid'/);
  assert.match(confirm, /กรุณาแนบสลิปการโอนก่อนยืนยัน/);
});

test('food and shopping still attach the slip only while picked_up', () => {
  assert.match(app, /var needsCustomerSlip = buysGoods && !isCash/);
  assert.match(app, /needsCustomerSlip && o\.status === 'picked_up'/);
  assert.match(rules, /function customerPaidOk\(\)/);
  assert.match(rules, /resource\.data\.status == 'picked_up'[\s\S]{0,120}request\.resource\.data\.status == 'customer_paid'/);
});

test('express can attach a slip and mark the fee paid while on the way', () => {
  assert.match(rules, /function customerMayAttachSlip\(\)/);
  assert.match(rules, /resource\.data\.get\('type', ''\) == 'express' && resource\.data\.status == 'on_the_way'/);
  assert.match(rules, /function customerSlipPathOk\(path, orderId\)/);
  assert.match(rules, /orders\/' \+ orderId \+ '\/riders\/' \+ myUid\(\) \+ '\/slip_/);
  assert.match(rules, /function expressFarePaidOk\(\)/);
  assert.match(rules, /changed\.hasOnly\(\['customerPaid', 'customerPaidAt', 'foodDeliveryStage'\]\)[\s\S]{0,120}expressFarePaidOk\(\)/);
  const fn = orders.slice(orders.indexOf('async function confirmPaymentReceived'), orders.indexOf('module.exports'));
  assert.match(fn, /order\.type === 'ride' \|\| order\.type === 'express'/);
  assert.match(fn, /fareAtDestination/);
  assert.match(fn, /ระหว่างกำลังส่ง/);
});
