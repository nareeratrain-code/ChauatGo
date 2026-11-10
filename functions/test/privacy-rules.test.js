'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shop finance is private and a customer cannot mark cash as paid', {
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
      await root.collection('users').doc('shop1').set({ role: 'merchant' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('users').doc('admin1').set({ role: 'admin', isPending: false });
      await root.collection('merchants').doc('shop1').set({
        merchantId: 'shop1',
        name: 'ร้านร่วม',
        phone: '0812345678',
        address: 'ชะอวด',
        category: 'อาหาร',
        openTime: '08:00',
        closeTime: '20:00',
        isOpen: true,
        verified: true,
        ratingAvg: 4.5,
        ratingCount: 3
      });
      await root.collection('merchants').doc('shop1').collection('private').doc('profile').set({
        email: 'owner@shop.test',
        gpPending: 80,
        gpPaid: 10,
        gpConsent: true,
        gpHistory: []
      });
      await root.collection('menus').doc('menu1').set({
        merchantId: 'shop1', name: 'ข้าวไข่เจียว', price: 40
      });
      const paidBase = {
        type: 'shopping',
        status: 'picked_up',
        userId: 'cust1',
        riderId: 'rider1',
        fare: 30,
        total: 40,
        foodTotal: 10,
        foodImage: 'https://example.com/goods.jpg',
        partnerShop: false
      };
      await root.collection('orders').doc('cash-hand').set(Object.assign({}, paidBase, { paymentMode: 'cash', cashTip: 5 }));
      await root.collection('orders').doc('transfer-hand').set(Object.assign({}, paidBase, {
        paymentMode: 'transfer',
        customerSlipUrl: 'https://example.com/slip.jpg',
        customerSlipPath: 'orders/transfer-hand/riders/cust1/slip_1.jpg',
        customerSlipUploadedAt: new Date(),
        customerSlipStatus: 'pending'
      }));
    });

    const anon = rulesEnv.unauthenticatedContext().firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const owner = rulesEnv.authenticatedContext('shop1').firestore();
    const admin = rulesEnv.authenticatedContext('admin1').firestore();
    const paidPatch = {
      status: 'customer_paid',
      customerPaid: true,
      customerPaidAt: new Date(),
      foodDeliveryStage: 'customer_paid'
    };

    await assertSucceeds(anon.collection('merchants').where('verified', '==', true).get());
    await assertSucceeds(anon.collection('merchants').doc('shop1').get());
    await assertSucceeds(customer.collection('menus').where('merchantId', '==', 'shop1').get());
    await assertFails(anon.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    await assertFails(customer.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    await assertSucceeds(owner.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    await assertSucceeds(admin.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    await assertFails(owner.collection('merchants').doc('shop1').collection('private').doc('profile').update({ gpPending: 0 }));
    await assertFails(customer.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    await assertFails(customer.collection('orders').doc('cash-hand').update(paidPatch));
    await assertSucceeds(customer.collection('orders').doc('transfer-hand').update(paidPatch));
  } finally {
    await rulesEnv.cleanup();
  }
});
