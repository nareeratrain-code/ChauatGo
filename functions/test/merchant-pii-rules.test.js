'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('a shop reads the safe inbox and its private profile, not customer PII', {
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
      await root.collection('users').doc('admin1').set({ role: 'admin', isPending: false });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านข้าว', phone: '0811111111' });
      await root.collection('merchants').doc('shop1').collection('private').doc('profile').set({
        gpPending: 42, soundSettings: { tone: 2, volume: 'low' }, email: 'shop@example.com'
      });
      const pii = {
        type: 'food',
        userId: 'cust1',
        merchantId: 'shop1',
        userName: 'สมชาย ใจดี',
        userPhone: '0812345678',
        address: '99/1 หมู่ 3 ต.ชะอวด',
        lat: 8.4123,
        lng: 99.9876,
        note: 'ไม่ใส่ผัก',
        items: [{ name: 'ข้าวแกง', qty: 1, price: 40 }]
      };
      await root.collection('orders').doc('active1').set(Object.assign({ status: 'searching' }, pii));
      await root.collection('orders').doc('done1').set(Object.assign({ status: 'done' }, pii));
      await root.collection('orders').doc('active1').collection('private').doc('contacts').set({
        userName: 'สมชาย ใจดี', userPhone: '0812345678'
      });
      await root.collection('orders').doc('active1').collection('tracking').doc('current').set({ lat: 8.41, lng: 99.98 });
      await root.collection('chats').doc('active1').set({ orderId: 'active1', userId: 'cust1', merchantId: 'shop1' });
      await root.collection('chats').doc('done1').set({ orderId: 'done1', userId: 'cust1', merchantId: 'shop1' });
      await root.collection('chats').doc('active1').collection('messages').doc('m1').set({ text: 'ไม่ใส่ผัก', senderId: 'cust1' });
      await root.collection('chats').doc('done1').collection('messages').doc('m1').set({ text: 'เบอร์ 0812345678', senderId: 'cust1' });
      await root.collection('merchants').doc('shop1').collection('orderInbox').doc('active1').set({
        orderId: 'active1', shortId: 'OD-1', customerName: 'สมชาย จ.', note: 'ไม่ใส่ผัก',
        items: [{ name: 'ข้าวแกง', qty: 1, price: 40 }], status: 'searching', safe: true
      });
      await root.collection('merchants').doc('shop1').collection('orderInbox').doc('done1').set({
        orderId: 'done1', shortId: 'OD-2', customerName: 'สมชาย จ.', status: 'done', safe: true
      });
    });

    const shop = rulesEnv.authenticatedContext('shop1').firestore();
    const admin = rulesEnv.authenticatedContext('admin1').firestore();

    await assertFails(shop.collection('orders').doc('active1').get());
    await assertFails(shop.collection('orders').doc('done1').get());
    await assertFails(shop.collection('orders').doc('active1').collection('private').doc('contacts').get());
    await assertFails(shop.collection('orders').doc('active1').collection('tracking').doc('current').get());
    await assertFails(shop.collection('chats').doc('done1').collection('messages').doc('m1').get());

    const inbox = await assertSucceeds(shop.collection('merchants').doc('shop1').collection('orderInbox').doc('active1').get());
    assert.equal(inbox.data().customerName, 'สมชาย จ.');
    assert.equal(inbox.data().note, 'ไม่ใส่ผัก');
    assert.equal(inbox.data().userPhone, undefined);
    assert.equal(inbox.data().address, undefined);
    await assertSucceeds(shop.collection('chats').doc('active1').collection('messages').doc('m1').get());
    await assertSucceeds(shop.collection('merchants').doc('shop1').collection('orderInbox').doc('done1').get());

    const profile = await assertSucceeds(shop.collection('merchants').doc('shop1').collection('private').doc('profile').get());
    assert.equal(profile.data().gpPending, 42);
    assert.equal(profile.data().soundSettings.volume, 'low');
    const hidden = await assertSucceeds(admin.collection('orders').doc('active1').get());
    assert.equal(hidden.data().userPhone, '0812345678');
    assert.equal(hidden.data().address, '99/1 หมู่ 3 ต.ชะอวด');
  } finally {
    await rulesEnv.cleanup();
  }
});
