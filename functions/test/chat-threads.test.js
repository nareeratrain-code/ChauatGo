'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('shop and rider chats are separate threads', {
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
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านข้าว' });
      await root.collection('riders').doc('rider1').set({ verified: true, riderId: 'rider1' });
      await root.collection('orders').doc('ord1').set({
        type: 'food', status: 'cooking', userId: 'cust1', merchantId: 'shop1', riderId: 'rider1',
        partnerShop: true, userName: 'สมชาย ใจดี', userPhone: '0812345678'
      });
      await root.collection('chats').doc('ord1').set({
        orderId: 'ord1', thread: 'rider', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
      await root.collection('chats').doc('ord1__shop').set({
        orderId: 'ord1', thread: 'shop', userId: 'cust1', merchantId: 'shop1', riderId: ''
      });
      await root.collection('chats').doc('ord1').collection('messages').doc('r1').set({ text: 'ถึงร้าน', senderId: 'rider1' });
      await root.collection('chats').doc('ord1__shop').collection('messages').doc('s1').set({ text: 'เนื้อหมด', senderId: 'shop1' });
    });
    const shop = rulesEnv.authenticatedContext('shop1').firestore();
    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    await assertSucceeds(shop.collection('chats').doc('ord1__shop').collection('messages').doc('s1').get());
    await assertFails(shop.collection('chats').doc('ord1').collection('messages').doc('r1').get());
    await assertSucceeds(rider.collection('chats').doc('ord1').collection('messages').doc('r1').get());
    await assertFails(rider.collection('chats').doc('ord1__shop').collection('messages').doc('s1').get());
    await assertSucceeds(customer.collection('chats').doc('ord1').collection('messages').doc('r1').get());
    await assertSucceeds(customer.collection('chats').doc('ord1__shop').collection('messages').doc('s1').get());
  } finally {
    await rulesEnv.cleanup();
  }
});
