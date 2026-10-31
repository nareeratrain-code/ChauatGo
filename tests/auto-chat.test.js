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
  return STATIC_KEYS.map((key) => chat.autoChatText({ type: 'food' }, key));
}

test('food status lines stay food-specific until the photo asks for payment', () => {
  const lines = staticFood();
  assert.equal(lines.some((line) => !line), false);
  for (const word of FOOD_BANNED) {
    assert.equal(lines.some((line) => line.includes(word)), false, word);
  }
  assert.match(lines[0], /ไปที่ร้านเพื่อรับอาหาร/);
  assert.match(chat.autoChatText({ type: 'food' }, 'shop_arrived'), /ถ่ายรูปอาหาร/);
  assert.equal(lines.some((line) => line.includes('โอนเงินให้ไรเดอร์')), false);
});

test('food photo asks for a transfer of food plus delivery', () => {
  const order = { type: 'food', paymentMode: 'transfer', foodTotal: 210, fare: 20 };
  const text = chat.autoChatText(order, 'food_photo');
  assert.equal(text, chat.autoChatText(order, 'picked_up'));
  assert.match(text, /โอนเงินให้ไรเดอร์/);
  assert.match(text, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 = รวม ฿230/);
  for (const word of FOOD_BANNED) assert.equal(text.includes(word), false, word);
  const fromItems = chat.autoChatText({
    type: 'food',
    paymentMode: 'transfer',
    fare: 20,
    items: [{ price: 70, qty: 3 }]
  }, 'food_photo');
  assert.match(fromItems, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 = รวม ฿230/);
});

test('cash food asks the customer to pay the rider on delivery', () => {
  const text = chat.autoChatText({
    type: 'food', paymentMode: 'cash', foodTotal: 210, fare: 20
  }, 'food_photo');
  assert.match(text, /เงินสดจ่ายไรเดอร์ตอนรับอาหาร/);
  assert.match(text, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 \+ ค่าบริการเงินสด ฿5 = รวม ฿235/);
  assert.equal(text.includes('โอนเงิน'), false);
  assert.equal(text.includes('ฝากซื้อ'), false);
  const noTip = chat.autoChatText({
    type: 'food', paymentMode: 'cash', foodTotal: 210, fare: 20, cashTip: 0
  }, 'food_photo');
  assert.match(noTip, /ค่าอาหาร ฿210 \+ ค่าส่ง ฿20 = รวม ฿230/);
  assert.equal(noTip.includes('ค่าบริการเงินสด'), false);
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
  assert.equal(chat.autoChatText({ type: 'other' }, 'accepted'), chat.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(chat.autoChatText(null, 'accepted'), chat.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(chat.autoChatText({ type: 'food' }, 'missing'), '');
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
  assert.equal(gate.canLeaveShop(directory), true);
  assert.equal(gate.canLeaveShop(cash), false);
  assert.equal(gate.canLeaveShop(Object.assign({ riderSlipToShop: 'https://slip' }, cash)), true);
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'cash' }), true);
  assert.equal(gate.canLeaveShop({ type: 'express', paymentMode: 'transfer' }), false);
  assert.equal(gate.canLeaveShop({ type: 'shopping', paymentMode: 'transfer', customerPaidAt: {} }), true);
});

test('status messages choose the template from the order type', () => {
  assert.equal(rider.includes('AUTO_CHAT_MESSAGES'), false);
  assert.match(rider, /function sendAutomatedChat\(orderId, key\)/);
  assert.match(rider, /const text = autoChatText\(order, key\)/);
  assert.equal(/sendAutomatedChatLater\([^)\n]*,[^)\n]*,/.test(rider), false);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'food_photo'\)/);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'shop_slip'\)/);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'picked_up'\)/);
  assert.match(rider, /แนบสลิปที่โอนให้ร้านก่อนออกเดินทาง/);
  assert.match(rider, /data-slip=/);
  const photo = rider.slice(rider.indexOf('async function submitFoodPhoto'), rider.indexOf('async function submitShopSlip'));
  assert.equal(photo.includes('riderSlipToShop'), false);
  assert.match(photo, /status: 'picked_up'/);
  const slip = rider.slice(rider.indexOf('async function submitShopSlip'), rider.indexOf('async function confirmCombinedPickup'));
  assert.equal(slip.includes("status: 'on_the_way'"), false);
  assert.match(slip, /riderSlipToShop: pickupSlipUrl/);
});
