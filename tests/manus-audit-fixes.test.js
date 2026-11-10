const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const orders = fs.readFileSync('functions/orders.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const index = fs.readFileSync('functions/index.js', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');

test('cash buy-for-me stores the 5 baht service fee on the order', () => {
  const shopping = orders.slice(orders.indexOf("type === 'express'"), orders.indexOf('const net = food'));
  assert.match(shopping, /cashTip = mode === 'cash' \? 5 : 0/);
  const saved = orders.slice(orders.indexOf("type === 'shopping'"), orders.indexOf('const ref = db.collection'));
  assert.match(saved, /body\.cashTip = cashTip/);
});

test('a rider quote cannot set an unbounded goods price', () => {
  const quote = rules.slice(rules.indexOf('function riderGoodsQuoteOk'), rules.indexOf('function riderOnTheWayOk'));
  assert.match(quote, /foodTotal <= 100000/);
  assert.match(quote, /itemsTotal <= 100000/);
  assert.match(rider, /shoppingPrice > 100000/);
});

test('ride and express slips are not accepted before the destination', () => {
  const slip = rules.slice(rules.indexOf('function customerMayAttachSlip'), rules.indexOf('function customerSlipPathOk'));
  assert.match(slip, /buysGoods\(\) && resource\.data\.status == 'picked_up'/);
  assert.match(slip, /type', ''\) == 'express' && resource\.data\.status == 'on_the_way'/);
  const paid = rules.slice(rules.indexOf('function customerPaidOk'), rules.indexOf('function expressFarePaidOk'));
  assert.match(paid, /buysGoods\(\)/);
});

test('cash food and buy-for-me are confirmed on delivery, not before the rider buys', () => {
  const fn = orders.slice(orders.indexOf('async function confirmPaymentReceived'), orders.indexOf('module.exports'));
  assert.match(fn, /const transferGoods = goods && order\.paymentMode !== 'cash'/);
  assert.match(fn, /cashOnDelivery = goods && order\.paymentMode === 'cash' && order\.status === 'on_the_way'/);
  assert.match(fn, /fareAtDestination/);
  const gateStart = rider.indexOf('function riderMayConfirmPay');
  const gateEnd = rider.indexOf('function rideReachedDestination');
  const gate = {};
  vm.runInNewContext(rider.slice(gateStart, gateEnd) + '\nthis.riderMayConfirmPay = riderMayConfirmPay;', gate);
  assert.equal(gate.riderMayConfirmPay({ type: 'shopping', riderId: 'r', paymentMode: 'cash', status: 'picked_up' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'food', riderId: 'r', paymentMode: 'cash', status: 'accepted' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'shopping', riderId: 'r', paymentMode: 'cash', status: 'on_the_way' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'food', riderId: 'r', paymentMode: 'transfer', status: 'picked_up' }), true);
});

test('function rollout uses fractional CPU so a full deploy can finish', () => {
  assert.match(index, /cpu: 'gcf_gen1'/);
  assert.match(index, /concurrency: 1/);
  assert.equal(index.includes('expireDispatchOffers'), false);
  assert.match(index, /exports\.expireDispatchOffer/);
});

test('verified shop documents do not receive GP slip download URLs', () => {
  const created = index.slice(index.indexOf('exports.onGpTransferCreated'), index.indexOf('exports.onRatingCreated'));
  assert.match(created, /merchantHistoryEntry\(/);
  assert.equal(created.includes('slipUrl'), false);
  assert.match(app, /รวมค่าบริการเงินสด ฿5/);
});
