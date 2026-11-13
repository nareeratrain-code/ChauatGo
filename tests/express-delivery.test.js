const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const rider = fs.readFileSync('rider.js', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

const gateStart = rider.indexOf('function orderNeedsKitchen');
const gateEnd = rider.indexOf('function dispatchMode');
const gate = {};
vm.runInNewContext(rider.slice(gateStart, gateEnd), gate);

test('express leaves pickup only after the customer confirms the pickup photo', () => {
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'transfer' }), false);
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'cash', foodImage: 'https://p', customerOrderConfirmed: true }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', riderId: 'r', paymentMode: 'transfer', status: 'picked_up' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', riderId: 'r', paymentMode: 'transfer', status: 'accepted' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', riderId: 'r', paymentMode: 'transfer', status: 'on_the_way' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', riderId: 'r', paymentMode: 'cash', status: 'on_the_way' }), false);
});

test('food and shopping still wait for payment, and ride still pays at the destination', () => {
  assert.equal(gate.canLeaveShop({ type: 'food', partnerShop: true, paymentMode: 'transfer' }), false);
  assert.equal(gate.canLeaveShop({ type: 'shopping', paymentMode: 'transfer', customerPaidAt: {}, riderSlipToShop: 'https://slip' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'food', riderId: 'r', paymentMode: 'transfer', status: 'picked_up' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'shopping', riderId: 'r', paymentMode: 'transfer', status: 'picked_up' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', riderId: 'r', paymentMode: 'transfer', status: 'picked_up' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', riderId: 'r', paymentMode: 'transfer', status: 'on_the_way' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', riderId: 'r', paymentMode: 'transfer', status: 'on_the_way', riderArrivedCustomerChatAt: {} }), true);
});

test('express picked_up card starts delivery instead of waiting for a transfer', () => {
  const card = rider.slice(
    rider.indexOf("} else if (j.status === 'picked_up' || j.status === 'customer_paid')"),
    rider.indexOf("} else if (j.status === 'on_the_way')")
  );
  const express = card.slice(card.indexOf("j.type === 'express'"), card.indexOf('customerSlipRejected'));
  assert.match(express, /data-start-deliver/);
  assert.match(express, /🚀 เริ่มส่ง/);
  assert.equal(express.includes('ลูกค้าโอนแล้ว'), false);
  assert.equal(express.includes('รอลูกค้าโอนเงิน'), false);
  assert.match(card, /🚗 เริ่มเดินทางไปส่งลูกค้า/);
  assert.match(card, /payReceivedButton\(j\.id\)/);
  assert.match(rider, /📦 รับพัสดุแล้ว • กำลังไปส่ง/);
  assert.match(rider, /📦 รับพัสดุแล้ว — กดเริ่มส่ง/);
  assert.match(rider, /j\.type !== 'express'/);
  assert.match(rider, /data-express-proof/);
  assert.match(rider, /deliveryProofUrl/);
  assert.match(rider, /sendRiderQrPaymentChat\(jobId, 'arrived_customer'\)/);
});

test('customer tracking does not tell an express pickup to transfer first', () => {
  assert.match(app, /o\.type === 'express' && o\.status === 'picked_up'/);
  assert.match(app, /รับพัสดุแล้ว/);
  assert.match(app, /ไรเดอร์กำลังไปส่ง/);
  assert.match(app, /o\.type === 'express' && o\.status === 'on_the_way' && o\.riderArrivedCustomerChatAt/);
  assert.match(app, /ไรเดอร์ถึงปลายทางแล้ว/);
  assert.match(app, /กรุณาออกมารับพัสดุ — รอรูปยืนยันการส่ง/);
  assert.match(app, /_orderNoticeArrival/);
  const confirm = orders.slice(orders.indexOf('async function confirmPaymentReceived'), orders.indexOf('module.exports'));
  assert.match(confirm, /order\.type === 'ride' \|\| order\.type === 'express'/);
  assert.match(confirm, /fareAtDestination/);
});
