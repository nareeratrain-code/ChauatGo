'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('a rider can mark arrival, and cannot waive the stockout fee after arriving', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rulesEnv = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') }
  });
  try {
    await rulesEnv.clearFirestore();
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('riders').doc('rider1').set({ verified: true, riderId: 'rider1' });
      await root.collection('orders').doc('shop-open').set({
        type: 'shopping', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'cash', total: 40, fare: 30
      });
      await root.collection('orders').doc('shop-before').set({
        type: 'shopping', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'cash', total: 40, fare: 30
      });
      await root.collection('orders').doc('shop-after').set({
        type: 'shopping', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'transfer', total: 90, fare: 30, shopArrivedAt: new Date()
      });
    });
    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    await assertSucceeds(rider.collection('orders').doc('shop-before').update({ shopArrivedAt: new Date() }));
    await assertSucceeds(rider.collection('orders').doc('shop-open').update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'rider',
      cancelReason: 'ของหมด',
      refundDue: 0
    }));
    await assertFails(rider.collection('orders').doc('shop-after').update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'rider',
      cancelReason: 'ของหมด',
      refundDue: 0
    }));
  } finally {
    await rulesEnv.cleanup();
  }
});
