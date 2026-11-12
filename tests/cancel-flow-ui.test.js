'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const shop = fs.readFileSync('merchant.js', 'utf8');
const shopHtml = fs.readFileSync('merchant.html', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

test('the shop can flag a missing item and cancel after the food is ready', () => {
  const card = shop.slice(shop.indexOf('function renderOrderCard'), shop.indexOf('function isShopKitchen'));
  const waiting = card.slice(card.indexOf('} else if (waiting)'));
  assert.match(waiting, /openStockIssue/);
  assert.match(waiting, /openShopCancel/);
  assert.match(waiting, /วัตถุดิบหมด/);
  assert.match(waiting, /ยกเลิกออเดอร์/);
  assert.equal(shop.includes('shopWaitingPickup(order)'), false);
  assert.match(shop, /ครัวเต็ม/);
  assert.match(shop, /ร้านปิดฉุกเฉิน/);
  assert.match(shopHtml, /id="cancel-reason-modal"/);
  assert.match(rules, /resource.data.status in \['searching', 'pending', 'cooking', 'ready', 'accepted'\]/);
});

test('the customer can cancel from the order and the tracking screen until the cutoff', () => {
  assert.match(app, /function customerMayCancel/);
  assert.match(app, /openCustomerCancel/);
  assert.match(app, /customerOrderConfirmed !== true/);
  assert.match(app, /id="track-cancel"/);
  assert.match(app, /เปลี่ยนใจ/);
  assert.match(app, /ที่อยู่ผิด/);
  assert.match(app, /ยกเลิกออเดอร์/);
});

test('the rider releases a job before pickup and ends it afterwards', () => {
  assert.match(rider, /function openRiderRelease/);
  assert.match(rider, /function openRiderEndJob/);
  assert.match(rider, /redispatchOrder/);
  assert.match(rider, /ขอไรเดอร์คนใหม่/);
  assert.match(rider, /ยืนยันว่านำของคืนผู้ส่งแล้ว/);
  assert.match(rider, /ลูกค้าไม่ขึ้นรถ/);
  assert.match(rider, /ของหมด \/ ซื้อไม่ได้/);
  assert.match(rider, /lastReleasedRiderId/);
  assert.match(rider, /data-shop-closed/);
  assert.match(rider, /ลูกค้าไม่โอนเงินภายใน 15 นาที/);
});
