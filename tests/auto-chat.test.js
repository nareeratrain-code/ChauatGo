const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const rider = fs.readFileSync('rider.js', 'utf8');
const chatStart = rider.indexOf('const CASH_TIP');
const chatEnd = rider.indexOf('const MAX_SLIP_SIZE');
const chat = {};
vm.runInNewContext(rider.slice(chatStart, chatEnd), chat);

const gateStart = rider.indexOf('function orderNeedsKitchen');
const gateEnd = rider.indexOf('function dispatchMode');
const gate = {};
vm.runInNewContext(rider.slice(gateStart, gateEnd), gate);

const STATIC_KEYS = ['accepted', 'shop_arrived', 'on_the_way', 'near_customer', 'arrived_customer', 'delivered', 'shop_slip'];
const FOOD_BANNED = ['ฝากซื้อ', 'ซื้อของให้', 'ค่าสินค้า'];

function staticFood() {
  return STATIC_KEYS.map((key) => chat.autoChatText({ type: 'food', partnerShop: true }, key));
}

test('food status lines stay food-specific until the photo asks for payment', () => {
  const lines = staticFood();
  assert.equal(lines.some((line) => !line), false);
  for (const word of FOOD_BANNED) {
    assert.equal(lines.some((line) => line.includes(word)), false, word);
  }
  assert.match(lines[0], /ไปที่ร้านเพื่อรับอาหาร/);
  assert.match(chat.autoChatText({ type: 'food', partnerShop: true }, 'shop_arrived'), /ถ่ายรูปอาหาร/);
  assert.equal(lines.some((line) => line.includes('โอนเงินให้ไรเดอร์')), false);
});

test('food photo asks for a transfer of food plus delivery', () => {
  const order = { type: 'food', partnerShop: true, paymentMode: 'transfer', foodTotal: 210, fare: 20 };
  const text = chat.autoChatText(order, 'food_photo');
  assert.equal(text, chat.autoChatText(order, 'picked_up'));
  assert.match(text, /โอนเงินให้ไรเดอร์/);
  assert.match(text, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 = รวม ฿230/);
  for (const word of FOOD_BANNED) assert.equal(text.includes(word), false, word);
  const fromItems = chat.autoChatText({
    type: 'food', partnerShop: true,
    paymentMode: 'transfer',
    fare: 20,
    items: [{ price: 70, qty: 3 }]
  }, 'food_photo');
  assert.match(fromItems, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 = รวม ฿230/);
});

test('cash partner food asks the customer to confirm food and shop slip', () => {
  const text = chat.autoChatText({
    type: 'food', partnerShop: true, paymentMode: 'cash', foodTotal: 210, fare: 20
  }, 'food_photo');
  assert.match(text, /สำรองจ่ายค่าอาหารให้ร้าน/);
  assert.match(text, /เห็นรูปอาหารและสลิป/);
  assert.equal(text.includes('โอนเงิน'), false);
  assert.equal(text.includes('ฝากซื้อ'), false);
  const noTip = chat.autoChatText({
    type: 'food', partnerShop: true, paymentMode: 'cash', foodTotal: 210, fare: 20, cashTip: 0
  }, 'food_photo');
  assert.match(noTip, /แนบสลิปส่งให้ในแชท/);
  assert.equal(noTip.includes('โอนเงิน'), false);
});

test('buy-for-me keeps the shopping script, including the transfer step', () => {
  const accepted = chat.autoChatText({ type: 'shopping' }, 'accepted');
  const arrived = chat.autoChatText({ type: 'shopping' }, 'shop_arrived');
  assert.match(accepted, /ปักหมุดไว้เพื่อซื้อของให้/);
  assert.match(arrived, /ยืนยันรายการฝากซื้อ/);
  assert.match(arrived, /เตรียมโอนเงินค่าอาหารหรือค่าสินค้าให้ไรเดอร์/);
  assert.equal(accepted.includes('รับอาหารของลูกค้า'), false);
});

test('express auto-chat is parcel delivery and does not ask for food money', () => {
  const keys = ['accepted', 'shop_arrived', 'picked_up', 'on_the_way', 'near_customer', 'arrived_customer', 'delivered'];
  const lines = keys.map((key) => chat.autoChatText({ type: 'express' }, key));
  assert.match(lines[0], /รับพัสดุ/);
  assert.equal(lines.some((line) => line.includes('ฝากซื้อ')), false);
  assert.equal(lines.some((line) => line.includes('โอนเงิน')), false);
  assert.equal(lines.some((line) => line.includes('รับอาหาร')), false);
});

test('ride auto-chat is a pickup, and an unknown type falls back to food', () => {
  const ride = chat.autoChatText({ type: 'ride' }, 'accepted');
  assert.match(ride, /เรียกรถ/);
  assert.equal(ride.includes('ฝากซื้อ'), false);
  assert.equal(ride.includes('โอนเงิน'), false);
  assert.match(chat.autoChatText({ type: 'ride' }, 'shop_arrived'), /จุดนัดหมาย/);
  assert.match(chat.autoChatText({ type: 'ride' }, 'arrived_customer'), /ถึงที่หมายแล้ว/);
  assert.match(chat.autoChatText({ type: 'ride' }, 'arrived_customer'), /ชำระค่าบริการ/);
  assert.equal(chat.autoChatText({ type: 'other' }, 'accepted'), chat.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(chat.autoChatText(null, 'accepted'), chat.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(chat.autoChatText({ type: 'food' }, 'missing'), '');
});

test('express stays a pickup, while food and shopping buy goods first', () => {
  const localFood = { type: 'food', partnerShop: false, paymentMode: 'transfer' };
  const express = { type: 'express', paymentMode: 'transfer' };
  const shopping = { type: 'shopping', paymentMode: 'transfer' };
  assert.equal(gate.orderNeedsKitchen(localFood), false);
  assert.equal(gate.orderNeedsKitchen(express), false);
  assert.equal(gate.orderNeedsKitchen(shopping), false);
  assert.equal(gate.orderBuysGoods(localFood), true);
  assert.equal(gate.orderBuysGoods(shopping), true);
  assert.equal(gate.orderBuysGoods(express), false);
  assert.match(chat.autoChatText(express, 'shop_arrived'), /รับพัสดุ|จุดนัดหมาย|สถานที่รับพัสดุ/);
  assert.equal(chat.autoChatText(express, 'shop_arrived').includes('ถึงร้าน'), false);
  assert.match(rider, /งานนี้ไม่ต้องแนบสลิปร้าน/);
  assert.match(rider, /งานนี้ไม่ต้องถ่ายรูปอาหาร/);
});

test('a food rider cannot leave before the shop slip', () => {
  const food = { type: 'food', partnerShop: true, paymentMode: 'transfer', foodTotal: 210, fare: 20 };
  assert.equal(gate.canLeaveShop(null), false);
  assert.equal(gate.canLeaveShop(food), false);
  assert.equal(gate.canLeaveShop(Object.assign({ customerPaidAt: {} }, food)), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip' }, food)), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip', customerPaidAt: {} }, food)), true);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipUrl: 'https://slip', status: 'customer_paid' }, food)), true);
  const cash = { type: 'food', partnerShop: true, paymentMode: 'cash', foodTotal: 210, fare: 20 };
  const directory = { type: 'food', partnerShop: false, paymentMode: 'transfer', fare: 20, customerPaidAt: {} };
  assert.equal(gate.canLeaveShop(directory), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip' }, directory)), true);
  assert.equal(gate.canLeaveShop(cash), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip' }, cash)), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip', customerOrderConfirmed: true }, cash)), true);
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'cash' }), true);
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'transfer' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', paymentMode: 'transfer', riderId: 'r', status: 'picked_up' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'express', paymentMode: 'transfer', riderId: 'r', status: 'on_the_way' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'food', paymentMode: 'transfer', riderId: 'r', status: 'picked_up' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'shopping', paymentMode: 'transfer', riderId: 'r', status: 'picked_up' }), true);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', paymentMode: 'transfer', riderId: 'r', status: 'picked_up' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', paymentMode: 'transfer', riderId: 'r', status: 'on_the_way' }), false);
  assert.equal(gate.riderMayConfirmPay({ type: 'ride', paymentMode: 'transfer', riderId: 'r', status: 'on_the_way', riderArrivedCustomerChatAt: {} }), true);
  assert.equal(gate.canLeaveShop({ type: 'shopping', paymentMode: 'transfer', customerPaidAt: {} }), false);
  assert.equal(gate.canLeaveShop({ type: 'shopping', paymentMode: 'transfer', customerPaidAt: {}, riderSlipToShop: 'https://slip' }), true);
  assert.equal(gate.canLeaveShop({ type: 'ride', paymentMode: 'transfer' }), true);
});

test('status messages choose the template from the order type', () => {
  assert.equal(rider.includes('AUTO_CHAT_MESSAGES'), false);
  assert.match(rider, /function sendAutomatedChat\(orderId, key\)/);
  assert.match(rider, /const text = autoChatText\(order, key\)/);
  assert.equal(/sendAutomatedChatLater\([^)\n]*,[^)\n]*,/.test(rider), false);
  assert.match(rider, /postFoodPaymentChat\(jobId, pickupFoodUrl/);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'shop_slip'\)/);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'picked_up'\)/);
  assert.match(rider, /แนบสลิปที่โอนให้ร้านก่อนออกเดินทาง/);
  assert.match(rider, /data-slip=/);
  const photo = rider.slice(rider.indexOf('async function submitFoodPhoto'), rider.indexOf('async function submitShopSlip'));
  assert.equal(photo.includes('riderSlipToShop'), false);
  assert.match(photo, /photoPatch\.status = 'picked_up'/);
  const slip = rider.slice(rider.indexOf('async function submitShopSlip'), rider.indexOf('async function confirmCombinedPickup'));
  assert.equal(slip.includes("status: 'on_the_way'"), false);
  assert.match(slip, /riderSlipToShop: pickupSlipUrl/);
});
