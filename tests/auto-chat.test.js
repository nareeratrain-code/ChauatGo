const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const rider = fs.readFileSync('rider.js', 'utf8');
const start = rider.indexOf('const AUTO_CHAT_BY_TYPE');
const end = rider.indexOf('const MAX_SLIP_SIZE');
const sandbox = {};
vm.runInNewContext(rider.slice(start, end), sandbox);

const KEYS = ['accepted', 'shop_arrived', 'picked_up', 'on_the_way', 'near_customer', 'arrived_customer', 'delivered'];
const FOOD_FORBIDDEN = ['ฝากซื้อ', 'ซื้อของให้', 'โอนเงิน', 'ค่าสินค้า'];

function texts(type) {
  return KEYS.map((key) => sandbox.autoChatText({ type }, key));
}

test('food auto-chat picks up food and never asks for a transfer', () => {
  const lines = texts('food');
  assert.equal(lines.some((line) => !line), false);
  for (const word of FOOD_FORBIDDEN) {
    assert.equal(lines.some((line) => line.includes(word)), false, word);
  }
  assert.match(lines[0], /ไปที่ร้านเพื่อรับอาหาร/);
  assert.match(lines[1], /รับอาหารจากร้าน/);
  assert.match(lines[2], /รับอาหารจากร้านเรียบร้อย/);
  assert.match(lines[3], /นำอาหารไปส่ง/);
});

test('buy-for-me keeps the shopping script, including the transfer step', () => {
  const accepted = sandbox.autoChatText({ type: 'shopping' }, 'accepted');
  const arrived = sandbox.autoChatText({ type: 'shopping' }, 'shop_arrived');
  assert.match(accepted, /ปักหมุดไว้เพื่อซื้อของให้/);
  assert.match(arrived, /ยืนยันรายการฝากซื้อ/);
  assert.match(arrived, /เตรียมโอนเงินค่าอาหารหรือค่าสินค้าให้ไรเดอร์/);
  assert.equal(accepted.includes('รับอาหารของลูกค้า'), false);
});

test('express auto-chat is parcel delivery and does not ask for food money', () => {
  const lines = texts('express');
  assert.match(lines[0], /รับพัสดุ/);
  assert.equal(lines.some((line) => line.includes('ฝากซื้อ')), false);
  assert.equal(lines.some((line) => line.includes('โอนเงิน')), false);
  assert.equal(lines.some((line) => line.includes('รับอาหาร')), false);
});

test('ride auto-chat is a pickup, and an unknown type falls back to food', () => {
  const ride = texts('ride');
  assert.match(ride[0], /เรียกรถ/);
  assert.equal(ride.some((line) => line.includes('ฝากซื้อ')), false);
  assert.equal(ride.some((line) => line.includes('โอนเงิน')), false);
  const fallback = sandbox.autoChatText({ type: 'other' }, 'accepted');
  assert.equal(fallback, sandbox.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(sandbox.autoChatText(null, 'accepted'), sandbox.autoChatText({ type: 'food' }, 'accepted'));
  assert.equal(sandbox.autoChatText({ type: 'food' }, 'missing'), '');
});

test('status messages choose the template from the order type', () => {
  assert.equal(rider.includes('AUTO_CHAT_MESSAGES'), false);
  assert.match(rider, /function sendAutomatedChat\(orderId, key\)/);
  assert.match(rider, /const text = autoChatText\(order, key\)/);
  assert.equal(/sendAutomatedChatLater\([^)\n]*,[^)\n]*,/.test(rider), false);
  assert.match(rider, /sendAutomatedChatLater\(jobId, 'picked_up'\)/);
  assert.match(rider, /sendAutomatedChatLater\(o\.orderId, 'accepted'\)/);
});
