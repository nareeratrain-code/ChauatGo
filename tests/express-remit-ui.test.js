'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const rider = fs.readFileSync('rider.js', 'utf8');
const riderHtml = fs.readFileSync('rider.html', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');

test('cash buy-for-me reminds the rider and still lets them leave', () => {
  assert.match(rider, /งานนี้เป็นเงินสด ซื้อของ/);
  assert.match(rider, /if \(!go\) return/);
  assert.match(rider, /order\.type === 'shopping' && order\.paymentMode === 'cash'/);
  assert.equal(riderHtml.includes('โอนให้ร้านค้า'), false);
});

test('express start and finish wait for photos and the customer', () => {
  assert.match(rider, /ถ่ายรูปพัสดุส่งให้ลูกค้า/);
  assert.match(rider, /รอลูกค้ายืนยัน/);
  assert.match(rider, /data-express-pickup/);
  assert.match(rider, /ส่งรูปให้ลูกค้าแล้ว — รอลูกค้ายืนยันรับของ/);
  assert.match(app, /confirmExpressPickup/);
  assert.match(app, /confirmExpressDropoff/);
  assert.match(app, /expressDropoffConfirmedAt/);
  assert.match(app, /ไรเดอร์รับงานแล้ว/);
});

test('the dashboard opens the 21:00 transfer and the admin chat', () => {
  assert.match(riderHtml, /id="hero-owe-cell"/);
  assert.match(riderHtml, /id="remit-dash-btn"/);
  assert.match(riderHtml, /openRiderSettlementChat\(\)/);
  assert.match(riderHtml, /id="remit-countdown"/);
  assert.match(rider, /function renderRemitDashboard/);
  assert.match(rider, /syncMySettlement/);
  assert.match(rider, /queueRiderRemitSync/);
  assert.match(rider, /riderIsRemitLocked/);
  assert.match(rider, /พักรับงาน/);
});
