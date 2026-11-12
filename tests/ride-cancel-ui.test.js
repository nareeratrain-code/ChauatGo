'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const rider = fs.readFileSync('rider.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

test('a ride finishes at the destination and cancel is labelled ยกเลิก', () => {
  assert.match(rider, /data-finish-ride/);
  assert.match(rider, /ถึงที่หมายแล้ว/);
  assert.match(rider, /function finishRide/);
  assert.match(rider, /completeOrder/);
  assert.match(rider, /function openRideCancel/);
  assert.match(rider, /ยกเลิกงาน/);
  assert.match(rider, /อุบัติเหตุ/);
  assert.match(rider, /ยางรถแบน/);
  assert.match(rider, /รถเสีย/);
  assert.match(rider, /อื่นๆ/);
  assert.match(rider, /ลูกค้าไม่ขึ้นรถ/);
  const exit = rider.slice(rider.indexOf('function riderExitButtons'), rider.indexOf('function riderReasonSheet'));
  assert.match(exit, /j\.type === 'ride'/);
  assert.match(exit, />ยกเลิก</);
  assert.equal(exit.includes('>จบงาน<'), false);
  const rideCard = rider.slice(rider.indexOf("} else if (j.status === 'on_the_way')"), rider.indexOf("} else if (j.status === 'done'"));
  assert.match(rideCard, /data-finish-ride/);
  assert.equal(rideCard.includes('openRiderEndJob'), false);
});

test('rules reject a rider cancel after the passenger is picked up', () => {
  assert.match(rules, /resource\.data\.get\('type', ''\) == 'ride'/);
  assert.match(rules, /resource\.data\.status == 'picked_up'/);
  assert.match(rules, /ลูกค้าไม่ขึ้นรถ/);
  const complete = orders.slice(orders.indexOf('async function completeOrder'), orders.indexOf('function shopClosedText'));
  assert.match(complete, /status: 'done'/);
  assert.match(complete, /riderOwe: platformShare/);
  assert.match(complete, /order\.status !== 'on_the_way'/);
});
