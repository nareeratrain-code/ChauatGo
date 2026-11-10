'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shopping quote cannot exceed ฿100,000 and a ride cannot take a slip at pickup', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rulesEnv = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')
    }
  });
  try {
    await rulesEnv.clearFirestore();
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('riders').doc('rider1').set({ verified: true, riderId: 'rider1' });
      await root.collection('orders').doc('shop-quote').set({
        type: 'shopping',
        status: 'accepted',
        userId: 'cust1',
        riderId: 'rider1',
        paymentMode: 'transfer',
        fare: 30,
        total: 30,
        partnerShop: false
      });
      await root.collection('orders').doc('ride-early').set({
        type: 'ride',
        status: 'picked_up',
        userId: 'cust1',
        riderId: 'rider1',
        paymentMode: 'transfer',
        fare: 50,
        total: 50
      });
    });

    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const quote = {
      status: 'picked_up',
      pickedUpAt: new Date(),
      foodImage: 'https://example.com/goods.jpg',
      foodImagePath: 'chats/shop-quote/riders/rider1/food_1.jpg',
      foodPriceUpdatedAt: new Date(),
      foodDeliveryStage: 'food_photo_sent'
    };
    await assertFails(rider.collection('orders').doc('shop-quote').update(Object.assign({}, quote, {
      foodTotal: 100001,
      itemsTotal: 100001
    })));
    await assertSucceeds(rider.collection('orders').doc('shop-quote').update(Object.assign({}, quote, {
      foodTotal: 80,
      itemsTotal: 80
    })));
    await assertFails(customer.collection('orders').doc('ride-early').update({
      customerSlipUrl: 'https://example.com/slip.jpg',
      customerSlipPath: 'orders/ride-early/riders/cust1/slip_1.jpg',
      customerSlipUploadedAt: new Date(),
      foodDeliveryStage: 'customer_slip_uploaded'
    }));
  } finally {
    await rulesEnv.cleanup();
  }
});
