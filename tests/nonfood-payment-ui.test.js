const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const dispatch = fs.readFileSync('functions/dispatch.js', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

test('Non-food bill renders order-scoped rider QR and does not request customer slip', () => {
  assert.match(app, /var nonPartnerRiderPayment = o\.type !== 'food' \|\| o\.partnerShop !== true/);
  assert.match(app, /riderQrCodeUrl/);
  assert.match(app, /โอนแล้วไม่ต้องแนบสลิป/);
  assert.match(app, /var needsCustomerSlip = isPartnerFood && !isCash/);
});

test('Rider assignment copies only the QR URL to the order for Customer bill display', () => {
  assert.equal((dispatch.match(/riderQrCodeUrl: rider\.qrCodeUrl \|\| ''/g) || []).length, 3);
  assert.doesNotMatch(dispatch, /riderQrCodePath: rider\.qrCodePath/);
});

test('Non-partner cash payment can be confirmed, while Partner food cash remains delivery-only', () => {
  assert.match(orders, /const isPartnerFood = order\.type === 'food' && order\.partnerShop === true/);
  assert.match(orders, /order\.paymentMode === 'cash' && isPartnerFood/);
  assert.match(orders, /const nonFoodCashWaiting = order\.paymentMode === 'cash'/);
  assert.match(rider, /if \(orderIsCash\(j\) && j\.type === 'food' && j\.partnerShop === true\) return false/);
});

test('Customer and Rider Toasts can be dismissed with one tap', () => {
  assert.match(app, /t\.onclick = function\(\)\{ clearTimeout\(t\._t\); t\.className='toast'; \}/);
  assert.match(rider, /t\.onclick = \(\) => \{ clearTimeout\(t\._t\); t\.className = 'toast'; \}/);
});
