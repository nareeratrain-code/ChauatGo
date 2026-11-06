'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { customerSlipNotification, customerQuoteNotification } = require('../notifications');

test('notifies the customer once when rider uploads product photo and actual price', () => {
  const message = customerQuoteNotification(
    { userId: 'customer-1', riderId: 'rider-1', status: 'picked_up' },
    {
      userId: 'customer-1', riderId: 'rider-1', type: 'shopping', code: 'OD-200', status: 'picked_up',
      foodImage: 'https://storage.example/product.jpg', foodTotal: 125, fare: 32
    },
    'order-2'
  );
  assert.equal(message.title, '📸 ไรเดอร์ส่งรูปสินค้าและราคาแล้ว');
  assert.match(message.body, /OD-200/);
  assert.match(message.body, /฿125/);
  assert.match(message.body, /฿157/);
  assert.equal(message.data.type, 'customer_quote_ready');
});

test('does not notify customer again when the quote already existed', () => {
  const quote = {
    userId: 'customer-1', riderId: 'rider-1', type: 'shopping', status: 'picked_up',
    foodImage: 'https://storage.example/product.jpg', foodTotal: 125, fare: 32
  };
  assert.equal(customerQuoteNotification(quote, quote, 'order-2'), null);
});

test('does not tell the rider the customer paid when only a slip is uploaded', () => {
  const message = customerSlipNotification(
    { status: 'picked_up', riderId: 'rider-1' },
    {
      code: 'OD-100',
      riderId: 'rider-1',
      status: 'picked_up',
      total: 230,
      customerSlipUrl: 'https://storage.example/slip.png'
    },
    'order-1'
  );
  assert.equal(message, null);
});

test('notifies the rider only after payment is confirmed', () => {
  const message = customerSlipNotification(
    { riderId: 'rider-1', status: 'picked_up', customerSlipUrl: 'https://storage.example/slip.png' },
    {
      code: 'OD-100',
      riderId: 'rider-1',
      status: 'customer_paid',
      total: 230,
      customerSlipUrl: 'https://storage.example/slip.png',
      customerPaidAt: { seconds: 1 }
    },
    'order-1'
  );
  assert.equal(message.title, '💸 ลูกค้าโอนเงินแล้ว');
  assert.match(message.body, /OD-100/);
  assert.match(message.body, /ยืนยันการโอนแล้ว/);
  assert.equal(message.data.type, 'customer_paid');
});

test('does not notify again after payment was already confirmed', () => {
  const message = customerSlipNotification(
    { riderId: 'rider-1', customerSlipUrl: 'https://storage.example/old.png', customerPaidAt: { seconds: 1 } },
    { riderId: 'rider-1', customerSlipUrl: 'https://storage.example/old.png', status: 'on_the_way', customerPaidAt: { seconds: 1 } },
    'order-1'
  );
  assert.equal(message, null);
});

test('does not notify when the order has no assigned rider or slip', () => {
  assert.equal(customerSlipNotification({}, { customerSlipUrl: 'https://x/slip.png' }, 'order-1'), null);
  assert.equal(customerSlipNotification({}, { riderId: 'rider-1' }, 'order-1'), null);
  assert.equal(customerSlipNotification({}, { riderId: 'rider-1', customerSlipUrl: '' }, 'order-1'), null);
});
