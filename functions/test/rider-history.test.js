'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maskThaiName, coarseArea, historySummary } = require('../rider-history');

test('masks a Thai surname and keeps a single given name', () => {
  assert.equal(maskThaiName('สมชาย แก้ว'), 'สมชาย ก.');
  assert.equal(maskThaiName('สมชาย ใจดี'), 'สมชาย จ.');
  assert.equal(maskThaiName('สมชาย'), 'สมชาย');
  assert.equal(maskThaiName(''), '');
});

test('keeps a district or tambon and drops a house-number address', () => {
  assert.equal(coarseArea('123/4 ถนนชะอวด ตำบลชะอวด อำเภอชะอวด'), 'อ.ชะอวด');
  assert.equal(coarseArea('บ้านเลขที่ 9 ต.ท่าศาลา'), 'ต.ท่าศาลา');
  assert.equal(coarseArea('99/1 หมู่ 3 ถนนใหญ่'), '');
  assert.equal(coarseArea('ตลาดชะอวด'), 'ตลาดชะอวด');
});

test('rider history summary has no customer name, phone, address, or coordinates', () => {
  const summary = historySummary('order-1', {
    code: 'OD-1234',
    status: 'done',
    type: 'food',
    userName: 'สมชาย ใจดี',
    userPhone: '0812345678',
    address: '99/1 หมู่ 3 ตำบลชะอวด อำเภอชะอวด',
    to: '99/1 หมู่ 3 ตำบลชะอวด อำเภอชะอวด',
    lat: 8.1,
    lng: 100.2,
    note: 'บ้านสีฟ้า',
    shopPlaceName: 'ร้านข้าว',
    fare: 30,
    cashTip: 5,
    paymentMode: 'cash',
    riderIncome: 29,
    riderOwe: 6,
    distanceKm: 2.4,
    customerSlipUrl: 'https://example.com/slip.jpg',
    doneAt: new Date('2026-01-02T03:04:05.000Z')
  });
  const text = JSON.stringify(summary);
  assert.equal(text.includes('0812345678'), false);
  assert.equal(text.includes('99/1'), false);
  assert.equal(text.includes('สมชาย'), false);
  assert.equal(text.includes('slip'), false);
  assert.equal(text.includes('8.1'), false);
  assert.equal(summary.pickupLabel, 'ร้านข้าว');
  assert.equal(summary.dropoffArea, 'อ.ชะอวด');
  const tambonOnly = historySummary('order-2', {
    status: 'done',
    type: 'express',
    to: 'บ้านเลขที่ 9 ต.ท่าศาลา',
    from: 'ต.ชะอวด'
  });
  assert.equal(tambonOnly.dropoffArea, 'พื้นที่ปลายทาง');
  assert.equal(tambonOnly.pickupLabel, 'ต.ชะอวด');
  assert.equal(summary.cashTip, 5);
  assert.equal(summary.shortId, 'D-1234');
});
