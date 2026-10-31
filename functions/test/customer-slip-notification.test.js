'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { customerSlipNotification } = require('../notifications');

test('creates a rider notification when customer slip is newly uploaded', () => {
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

  assert.equal(message.title, '💸 ลูกค้าโอนเงินแล้ว');
  assert.match(message.body, /OD-100/);
  assert.match(message.body, /฿230/);
  assert.equal(message.data.type, 'customer_slip_uploaded');
  assert.equal(message.data.orderId, 'order-1');
});

test('does not notify again when an existing customer slip is followed by an order update', () => {
  const message = customerSlipNotification(
    { riderId: 'rider-1', customerSlipUrl: 'https://storage.example/old.png' },
    { riderId: 'rider-1', customerSlipUrl: 'https://storage.example/old.png', status: 'customer_paid' },
    'order-1'
  );
  assert.equal(message, null);
});

test('does not notify when the order has no assigned rider or slip', () => {
  assert.equal(customerSlipNotification({}, { customerSlipUrl: 'https://x/slip.png' }, 'order-1'), null);
  assert.equal(customerSlipNotification({}, { riderId: 'rider-1' }, 'order-1'), null);
  assert.equal(customerSlipNotification({}, { riderId: 'rider-1', customerSlipUrl: '' }, 'order-1'), null);
});
