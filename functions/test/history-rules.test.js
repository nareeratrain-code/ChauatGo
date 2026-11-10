'use strict';

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('a customer cannot write chat on a finished order, and the rider still can', {
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
      await root.collection('orders').doc('done1').set({
        type: 'food', status: 'done', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
      await root.collection('orders').doc('live1').set({
        type: 'food', status: 'on_the_way', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
      await root.collection('chats').doc('done1').set({
        orderId: 'done1', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
      await root.collection('chats').doc('live1').set({
        orderId: 'live1', userId: 'cust1', riderId: 'rider1', merchantId: 'shop1'
      });
    });
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const message = (role) => ({
      senderId: role === 'user' ? 'cust1' : 'rider1',
      senderRole: role,
      senderName: role === 'user' ? 'ลูกค้า' : 'ไรเดอร์',
      text: 'ทดสอบ',
      createdAt: new Date()
    });
    await assertFails(customer.collection('chats').doc('done1').collection('messages').add(message('user')));
    await assertSucceeds(rider.collection('chats').doc('done1').collection('messages').add(message('rider')));
    await assertSucceeds(customer.collection('chats').doc('live1').collection('messages').add(message('user')));
    await assertFails(customer.collection('orders').doc('done1').update({
      status: 'customer_paid',
      customerPaid: true,
      customerPaidAt: new Date()
    }));
  } finally {
    await rulesEnv.cleanup();
  }
});
