'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../cancel-flow');

test('partner food stays ready for another rider and is not sent back to the shop', () => {
  const ready = { type: 'food', partnerShop: true, status: 'accepted', foodReady: true };
  assert.equal(flow.beforeServiceCutoff(ready), true);
  assert.equal(flow.redispatchStatus(ready), 'ready');
  assert.equal(flow.beforeServiceCutoff(Object.assign({}, ready, { status: 'picked_up' })), false);
  assert.equal(flow.redispatchStatus({ type: 'food', partnerShop: true, status: 'accepted' }), 'cooking');
});

test('express, ride, and shopping use their own cancel cutoffs', () => {
  assert.equal(flow.beforeServiceCutoff({ type: 'express', status: 'picked_up', customerOrderConfirmed: false }), true);
  assert.equal(flow.beforeServiceCutoff({ type: 'express', status: 'picked_up', customerOrderConfirmed: true }), false);
  assert.equal(flow.redispatchStatus({ type: 'express', status: 'accepted' }), 'searching');
  assert.equal(flow.beforeServiceCutoff({ type: 'ride', status: 'accepted' }), true);
  assert.equal(flow.beforeServiceCutoff({ type: 'ride', status: 'picked_up' }), false);
  assert.equal(flow.beforeServiceCutoff({ type: 'shopping', status: 'accepted', foodImage: '' }), true);
  assert.equal(flow.beforeServiceCutoff({ type: 'shopping', status: 'picked_up', foodImage: 'https://item' }), false);
  assert.equal(flow.beforeServiceCutoff({ type: 'food', partnerShop: false, status: 'accepted', shopBillUrl: 'https://bill' }), false);
});

test('buy-for-me stockout keeps 20 baht only after the rider arrives', () => {
  const before = flow.shoppingStockoutPlan({ type: 'shopping', status: 'accepted', paymentMode: 'cash', total: 80 }, 'ของหมด');
  assert.equal(before.apply, false);
  assert.equal(before.beforeArrival, true);
  const cash = flow.shoppingStockoutPlan({
    type: 'shopping', status: 'accepted', shopArrivedAt: {}, paymentMode: 'cash', total: 80
  }, 'ของหมด');
  assert.equal(cash.apply, true);
  assert.equal(cash.fare, 20);
  assert.equal(cash.refundDue, 0);
  assert.equal(cash.riderOwe, 4);
  assert.equal(cash.riderIncome, 16);
  assert.equal(cash.finishNow, true);
  const paid = flow.shoppingStockoutPlan({
    type: 'shopping', status: 'picked_up', paymentMode: 'transfer', customerPaidAt: {}, total: 100
  }, 'ซื้อไม่ได้');
  assert.equal(paid.refundDue, 80);
  assert.equal(paid.fare, 20);
  const waiting = flow.shoppingStockoutPlan({
    type: 'shopping', status: 'picked_up', paymentMode: 'transfer', total: 90
  }, 'ของหมด');
  assert.equal(waiting.waitForSlip, true);
  assert.equal(waiting.refundDue, 0);
  const food = flow.shoppingStockoutPlan({
    type: 'food', partnerShop: true, status: 'accepted', shopArrivedAt: {}, paymentMode: 'cash', total: 80
  }, 'ของหมด');
  assert.equal(food.apply, false);
});

test('a paid transfer records the order total and cash records nothing', () => {
  assert.equal(flow.cancelRefundDue({ paymentMode: 'transfer', customerPaidAt: {}, total: 100 }), 100);
  assert.equal(flow.cancelRefundDue({ paymentMode: 'cash', customerPaidAt: {}, total: 100 }), 0);
  assert.equal(flow.cancelRefundDue({ paymentMode: 'transfer', total: 100 }), 0);
});

test('stock and no-show reasons end the job instead of finding a new rider', () => {
  assert.equal(flow.isEndJobReason('ของหมด'), true);
  assert.equal(flow.isEndJobReason('ซื้อไม่ได้'), true);
  assert.equal(flow.isEndJobReason('ลูกค้าไม่ขึ้นรถ'), true);
  assert.equal(flow.isEndJobReason('รถเสีย'), false);
  assert.equal(flow.isEndJobReason('ครัวปิดชั่วคราว'), false);
});
