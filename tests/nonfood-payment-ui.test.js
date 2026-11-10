const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const dispatch = fs.readFileSync('functions/dispatch.js', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

test('Express and ride pay the fee at the end, while food and shopping require a slip', () => {
  assert.match(app, /var feeAtEnd = o\.type === 'express' \|\| o\.type === 'ride'/);
  assert.match(app, /riderQrCodeUrl/);
  assert.match(app, /โอนแล้วไม่ต้องแนบสลิป/);
  assert.match(app, /var needsCustomerSlip = buysGoods && !isCash/);
  assert.match(app, /var buysGoods = o\.type === 'food' \|\| o\.type === 'shopping'/);
});

test('Rider assignment copies only the QR URL to the order for Customer bill display', () => {
  assert.equal((dispatch.match(/riderQrCodeUrl: rider\.qrCodeUrl \|\| ''/g) || []).length, 3);
  assert.doesNotMatch(dispatch, /riderQrCodePath: rider\.qrCodePath/);
});

test('Cash food and buy-for-me are collected on delivery, not before the rider buys', () => {
  assert.match(orders, /cashOnDelivery = goods && order\.paymentMode === 'cash' && order\.status === 'on_the_way'/);
  assert.doesNotMatch(orders, /const cashWaiting = order\.paymentMode === 'cash'/);
  assert.match(rider, /j\.paymentMode === 'cash'\) return j\.status === 'on_the_way'/);
});

test('Customer and Rider Toasts can be dismissed with one tap', () => {
  assert.match(app, /t\.onclick = function\(\)\{ clearTimeout\(t\._t\); t\.className='toast'; \}/);
  assert.match(rider, /t\.onclick = \(\) => \{ clearTimeout\(t\._t\); t\.className = 'toast'; \}/);
});
