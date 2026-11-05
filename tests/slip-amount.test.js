const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const slip = require('../slip-amount');

test('transfer due is goods plus service fee, within one baht', () => {
  const food = { type: 'food', paymentMode: 'transfer', foodTotal: 120, fare: 20, total: 140, transferDue: 140 };
  assert.equal(slip.expectedTransferAmount(food), 140);
  assert.equal(slip.slipAmountsMatch(140, 140), true);
  assert.equal(slip.slipAmountsMatch(141, 140), true);
  assert.equal(slip.slipAmountsMatch(139, 140), true);
  assert.equal(slip.slipAmountsMatch(142, 140), false);
  assert.equal(slip.slipAmountsMatch(138.99, 140), false);
  assert.equal(slip.slipMismatchText(140), 'ยอดสลิปไม่ตรง ต้องโอน ฿140');
  assert.equal(slip.parseSlipAmount('฿140'), 140);
  assert.equal(slip.parseSlipAmount('1,400.50'), 1400.5);
  assert.equal(slip.parseSlipAmount('140 บาท'), 140);
  assert.equal(slip.parseSlipAmount('ไม่ทราบ'), null);

  const discounted = { type: 'food', paymentMode: 'transfer', foodTotal: 120, fare: 20, total: 130, transferDue: 130 };
  assert.equal(slip.expectedTransferAmount(discounted), 130);
  assert.equal(slip.slipAmountsMatch(140, slip.expectedTransferAmount(discounted)), false);

  const shopping = { type: 'shopping', paymentMode: 'transfer', fare: 31, total: 31 };
  assert.equal(slip.expectedTransferAmount(shopping), 31);
  assert.equal(slip.slipAmountsMatch('32', 31), true);
  assert.equal(slip.slipAmountsMatch('33', 31), false);
});

test('customer slip confirm records the amount and blocks a mismatch', () => {
  const app = fs.readFileSync('index.html', 'utf8');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const orders = fs.readFileSync('functions/orders.js', 'utf8');
  assert.match(app, /slip-amount\.js/);
  assert.match(app, /ChauatSlipAmount\.slipAmountsMatch/);
  assert.match(app, /slipMismatchText\(expected\)/);
  assert.match(app, /paymentConfirmSource = 'customer_slip'/);
  assert.match(app, /customerSlipAmount = amount/);
  assert.match(app, /id="slip-amount-input"/);
  assert.match(rules, /function expectedTransferBaht\(\)/);
  assert.match(rules, /let due = expectedTransferBaht\(\)/);
  assert.match(rules, /amount >= due - 1 && amount <= due \+ 1/);
  assert.match(rules, /paymentConfirmSource == 'customer_slip'/);
  assert.match(rules, /paymentConfirmSource == 'rider_manual'/);
  assert.match(orders, /paymentConfirmSource: 'rider_manual'/);
  assert.match(orders, /body\.transferDue = total/);
  assert.equal(orders.includes('slipAmount') && orders.includes('ocr'), false);
});
