'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('the shop can flag a missing item and the customer can remove it', {
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
      await root.collection('users').doc('shop1').set({ role: 'merchant' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านข้าว' });
      await root.collection('orders').doc('cook1').set({
        type: 'food', status: 'cooking', partnerShop: true,
        userId: 'cust1', merchantId: 'shop1', riderId: 'rider1',
        paymentMode: 'cash', foodTotal: 80, itemsTotal: 80, fare: 20, cashTip: 5, total: 105,
        items: [{ name: 'ข้าว', qty: 1, price: 40 }, { name: 'แกง', qty: 1, price: 40 }]
      });
      await root.collection('orders').doc('paid1').set({
        type: 'food', status: 'accepted', partnerShop: true,
        userId: 'cust1', merchantId: 'shop1', riderId: 'rider1',
        paymentMode: 'transfer', customerPaidAt: new Date(),
        foodTotal: 80, itemsTotal: 80, fare: 20, cashTip: 0, total: 100,
        items: [{ name: 'ข้าว', qty: 1, price: 40 }, { name: 'แกง', qty: 1, price: 40 }],
        stockIssue: { status: 'pending', items: [{ name: 'แกง', qty: 1, price: 40 }], note: '' }
      });
    });
    const shop = rulesEnv.authenticatedContext('shop1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    await assertSucceeds(shop.collection('orders').doc('cook1').update({
      stockIssue: { status: 'pending', items: [{ name: 'แกง', qty: 1, price: 40 }], note: 'แกงหมด' }
    }));
    await assertFails(customer.collection('orders').doc('cook1').update({
      foodTotal: 1, itemsTotal: 1, total: 1, refundDue: 0, items: [], stockIssue: { status: 'removed' }
    }));
    await assertSucceeds(customer.collection('orders').doc('paid1').update({
      items: [{ name: 'ข้าว', qty: 1, price: 40 }],
      itemsText: 'ข้าว x1',
      foodTotal: 40,
      itemsTotal: 40,
      total: 60,
      refundDue: 40,
      stockIssue: { status: 'removed', items: [{ name: 'แกง', qty: 1, price: 40 }], note: '' }
    }));
  } finally {
    await rulesEnv.cleanup();
  }
});
