'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { merchantSummary } = require('../merchant-inbox');

test('merchant inbox keeps items, note, and a masked name only', () => {
  const summary = merchantSummary('order-1', {
    code: 'OD-1234',
    status: 'searching',
    type: 'food',
    userName: 'สมชาย ใจดี',
    userPhone: '0812345678',
    address: '99/1 หมู่ 3 ต.ชะอวด อ.ชะอวด',
    lat: 8.4123,
    lng: 99.9876,
    fromLat: 8.4,
    note: 'ไม่ใส่ผัก',
    items: [{ name: 'ข้าวแกง', qty: 2, price: 40, note: '99/1' }],
    itemsTotal: 80,
    paymentMode: 'cash',
    customerSlipUrl: 'https://example.com/slip.jpg',
    riderPhone: '0899999999',
    riderName: 'สมหญิง ดี',
    userId: 'cust1',
    merchantId: 'shop1'
  });
  const text = JSON.stringify(summary);
  assert.equal(text.includes('0812345678'), false);
  assert.equal(text.includes('0899999999'), false);
  assert.equal(text.includes('99/1'), false);
  assert.equal(text.includes('8.4123'), false);
  assert.equal(text.includes('slip'), false);
  assert.equal(text.includes('ใจดี'), false);
  assert.equal(summary.customerName, 'สมชาย จ.');
  assert.equal(summary.riderName, 'สมหญิง ด.');
  assert.equal(summary.note, 'ไม่ใส่ผัก');
  assert.equal(summary.items[0].name, 'ข้าวแกง');
  assert.equal(summary.items[0].note, undefined);
  assert.equal(summary.shortId, 'D-1234');
  assert.equal(summary.foodTotal, 80);
  assert.equal(summary.userId, 'cust1');
});
