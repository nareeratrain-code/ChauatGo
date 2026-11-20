const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('node:vm');

const riderSource = fs.readFileSync('rider.js', 'utf8');
const ordersSource = fs.readFileSync('functions/orders.js', 'utf8');

function loadRidePaymentHelpers(jobOverrides = {}) {
  const start = riderSource.indexOf('function riderMayConfirmPay');
  const end = riderSource.indexOf('function payReceivedButton', start);
  assert.ok(start >= 0 && end > start, 'ride payment helpers must exist');

  const updates = [];
  const chats = [];
  const toasts = [];
  const context = {
    allJobs: [{
      id: 'ride-test-1',
      type: 'ride',
      riderId: 'rider-test',
      status: 'on_the_way',
      paymentMode: 'transfer',
      total: 59,
      fare: 59,
      ...jobOverrides
    }],
    allHistory: [],
    currentUser: { uid: 'rider-test' },
    riderProfile: {
      qrCodeUrl: 'https://example.test/qr.png',
      qrCodePath: 'rider_qr/rider-test/payment-qr.png'
    },
    activeChatId: null,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } } },
    db: {
      collection(name) {
        assert.equal(name, 'orders');
        return {
          doc(id) {
            assert.equal(id, 'ride-test-1');
            return { update: async (value) => updates.push(value) };
          }
        };
      }
    },
    orderIsCash: (job) => job.paymentMode === 'cash',
    sendAutomatedChatLater: (id, key) => chats.push({ id, key }),
    sendRiderQrPaymentChat: async (id, phase) => chats.push({ id, phase }),
    renderJobs: () => {},
    renderChatGuide: () => {},
    showToast: (message) => toasts.push(message),
    riderFirebaseErrorText: (_error, fallback) => fallback,
    console
  };
  vm.runInNewContext(riderSource.slice(start, end), context);
  return { context, updates, chats, toasts };
}

test('ride payment button is blocked while merely on the way', () => {
  const { context } = loadRidePaymentHelpers();
  assert.equal(context.riderMayConfirmPay(context.allJobs[0]), false);
  assert.equal(context.rideReachedDestination(context.allJobs[0]), false);
  assert.match(riderSource, /data-arrive-customer="\$\{esc\(j\.id\)\}"/);
});

test('ride payment becomes available only after arrival marker exists', () => {
  const { context } = loadRidePaymentHelpers({ riderArrivedCustomerChatAt: 'SERVER_TIMESTAMP' });
  assert.equal(context.rideReachedDestination(context.allJobs[0]), true);
  assert.equal(context.riderMayConfirmPay(context.allJobs[0]), true);
  assert.match(riderSource, /rideReachedDestination\(j\)[\s\S]{0,220}ridePayReceivedButton/);
});

test('arrival action records the marker and sends destination payment QR', async () => {
  const harness = loadRidePaymentHelpers();
  await harness.context.markRideArrived('ride-test-1');

  assert.equal(JSON.stringify(harness.updates), JSON.stringify([{
    riderArrivedCustomerChatAt: 'SERVER_TIMESTAMP',
    riderQrCodeUrl: 'https://example.test/qr.png',
    riderQrCodePath: 'rider_qr/rider-test/payment-qr.png'
  }]));
  assert.deepEqual(harness.chats, [
    { id: 'ride-test-1', key: 'arrived_customer' },
    { id: 'ride-test-1', phase: 'arrived_customer' }
  ]);
  assert.match(harness.toasts.join('\n'), /ถึงปลายทางแล้ว/);
});

test('arrival action does not overwrite a ride that is already paid', async () => {
  const harness = loadRidePaymentHelpers({ customerPaidAt: 'already-paid' });
  await harness.context.markRideArrived('ride-test-1');
  assert.deepEqual(harness.updates, []);
  assert.deepEqual(harness.chats, []);
  assert.match(harness.toasts.join('\n'), /ชำระเงินแล้ว/);
});

test('starting the ride does not send the destination payment message', () => {
  const start = riderSource.indexOf('async function startDelivery');
  const end = riderSource.indexOf('async function deliverJob', start);
  const block = riderSource.slice(start, end);
  assert.doesNotMatch(block, /sendRiderQrPaymentChat\(jobId, ['"]arrived_customer['"]\)/);
  assert.match(block, /status: 'on_the_way'/);
});

test('backend rejects ride payment confirmation before arrival marker', () => {
  assert.match(
    ordersSource,
    /order\.type === 'ride' && fareAtDestination && !order\.riderArrivedCustomerChatAt/
  );
  assert.match(ordersSource, /กรุณากดยืนยันว่าถึงปลายทางแล้วก่อนรับชำระเงิน/);
});

test('existing express payment flow remains available while on the way', () => {
  const { context } = loadRidePaymentHelpers({ type: 'express' });
  assert.equal(context.riderMayConfirmPay(context.allJobs[0]), true);
});
