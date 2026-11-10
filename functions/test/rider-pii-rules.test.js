'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('a rider can read customer details only while the job is active', {
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
      await root.collection('riders').doc('rider1').set({ verified: true, riderId: 'rider1' });
      await root.collection('users').doc('admin1').set({ role: 'admin', isPending: false });
      const pii = {
        type: 'food',
        userId: 'cust1',
        riderId: 'rider1',
        userName: 'สมชาย ใจดี',
        userPhone: '0812345678',
        address: '99/1 หมู่ 3 ต.ชะอวด',
        lat: 8.4123,
        lng: 99.9876,
        note: 'บ้านสีฟ้า',
        customerSlipUrl: 'https://example.com/slip.jpg',
        riderName: 'สมหญิง ดี',
        riderPhone: '0899999999'
      };
      await root.collection('orders').doc('active1').set(Object.assign({ status: 'on_the_way' }, pii));
      await root.collection('orders').doc('done1').set(Object.assign({}, pii, {
        status: 'done',
        riderName: 'สมหญิง ด.',
        riderPhone: null
      }));
      await root.collection('orders').doc('done1').collection('private').doc('contacts').set({
        userName: 'สมชาย ใจดี', userPhone: '0812345678', riderName: 'สมหญิง ดี', riderPhone: '0899999999'
      });
      await root.collection('chats').doc('active1').set({ orderId: 'active1', userId: 'cust1', riderId: 'rider1' });
      await root.collection('chats').doc('done1').set({ orderId: 'done1', userId: 'cust1', riderId: 'rider1' });
      await root.collection('chats').doc('active1').collection('messages').doc('m1').set({ text: 'ถึงแล้ว', senderId: 'cust1' });
      await root.collection('chats').doc('done1').collection('messages').doc('m1').set({ text: 'เบอร์ 0812345678', senderId: 'cust1' });
      await root.collection('riders').doc('rider1').collection('jobHistory').doc('done1').set({
        orderId: 'done1', shortId: 'OD-1', type: 'food', pickupLabel: 'ร้านข้าว',
        dropoffArea: 'ต.ชะอวด', fare: 30, status: 'done', safe: true
      });
    });

    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const admin = rulesEnv.authenticatedContext('admin1').firestore();

    const active = await assertSucceeds(rider.collection('orders').doc('active1').get());
    assert.equal(active.data().userPhone, '0812345678');
    await assertSucceeds(rider.collection('chats').doc('active1').collection('messages').doc('m1').get());

    await assertFails(rider.collection('orders').doc('done1').get());
    await assertFails(rider.collection('chats').doc('done1').collection('messages').doc('m1').get());
    await assertFails(rider.collection('orders').doc('done1').collection('private').doc('contacts').get());

    const history = await assertSucceeds(rider.collection('riders').doc('rider1').collection('jobHistory').doc('done1').get());
    assert.equal(history.data().userPhone, undefined);
    assert.equal(history.data().dropoffArea, 'ต.ชะอวด');

    const own = await assertSucceeds(customer.collection('orders').doc('done1').get());
    assert.equal(own.data().riderPhone, null);
    assert.equal(own.data().riderName, 'สมหญิง ด.');
    await assertFails(customer.collection('orders').doc('done1').collection('private').doc('contacts').get());
    const hidden = await assertSucceeds(admin.collection('orders').doc('done1').collection('private').doc('contacts').get());
    assert.equal(hidden.data().userPhone, '0812345678');
    assert.equal(hidden.data().riderPhone, '0899999999');
  } finally {
    await rulesEnv.cleanup();
  }
});
