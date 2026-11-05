'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');

const skip = !process.env.FIRESTORE_EMULATOR_HOST;

function order(id, extra) {
  return Object.assign({
    type: 'food',
    paymentMode: 'transfer',
    status: 'picked_up',
    userId: 'cust1',
    riderId: 'rider1',
    foodTotal: 100,
    fare: 20,
    total: 120,
    transferDue: 120,
    customerSlipUrl: '',
    customerSlipStatus: ''
  }, extra);
}

test('firestore rejects a transfer slip confirm when the amount does not match', { skip }, async () => {
  const env = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')
    }
  });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('users/cust1').set({ role: 'user' });
      await db.doc('users/rider1').set({ role: 'rider' });
      await db.doc('riders/rider1').set({ verified: true, riderId: 'rider1' });
      await db.doc('orders/ord-match').set(order('ord-match'));
      await db.doc('orders/ord-wrong').set(order('ord-wrong', {
        customerSlipUrl: 'https://example.test/slip.jpg',
        customerSlipPath: 'slips/customers/cust1/ord-wrong/proof_1.jpg',
        customerSlipUploadedAt: new Date(),
        customerSlipAmount: 200
      }));
      await db.doc('orders/ord-near').set(order('ord-near', {
        customerSlipUrl: 'https://example.test/slip-near.jpg',
        customerSlipPath: 'slips/customers/cust1/ord-near/proof_1.jpg',
        customerSlipUploadedAt: new Date(),
        customerSlipAmount: 121
      }));
      await db.doc('orders/ord-manual').set(order('ord-manual', {
        customerSlipUrl: 'https://example.test/slip-manual.jpg',
        customerSlipPath: 'slips/customers/cust1/ord-manual/proof_1.jpg',
        customerSlipUploadedAt: new Date(),
        customerSlipAmount: 50
      }));
    });

    const customer = env.authenticatedContext('cust1').firestore();
    const rider = env.authenticatedContext('rider1').firestore();
    const paid = {
      status: 'customer_paid',
      customerPaid: true,
      customerPaidAt: new Date(),
      paymentConfirmSource: 'customer_slip'
    };

    await assertFails(customer.doc('orders/ord-match').update(paid));
    await assertSucceeds(customer.doc('orders/ord-match').update({
      customerSlipUrl: 'https://example.test/slip-ok.jpg',
      customerSlipPath: 'slips/customers/cust1/ord-match/proof_1.jpg',
      customerSlipUploadedAt: new Date(),
      customerSlipAmount: 120
    }));
    await assertSucceeds(customer.doc('orders/ord-match').update(paid));
    let saved;
    await env.withSecurityRulesDisabled(async (ctx) => {
      saved = (await ctx.firestore().doc('orders/ord-match').get()).data();
    });
    assert.equal(saved.status, 'customer_paid');
    assert.equal(saved.customerSlipAmount, 120);
    assert.equal(saved.paymentConfirmSource, 'customer_slip');

    await assertFails(customer.doc('orders/ord-wrong').update(paid));
    await assertSucceeds(customer.doc('orders/ord-near').update(paid));
    await assertSucceeds(rider.doc('orders/ord-manual').update({
      status: 'customer_paid',
      customerPaid: true,
      customerPaidAt: new Date(),
      paymentConfirmSource: 'rider_manual'
    }));
  } finally {
    await env.cleanup();
  }
});
