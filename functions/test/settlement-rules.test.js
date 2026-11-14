'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('settlement chats and slips stay with the payer and admin', {
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
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('users').doc('admin1').set({ role: 'admin', isPending: false });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านข้าว' });
      await root.collection('riders').doc('rider1').set({ verified: true, name: 'สมหมาย' });
      await root.collection('config').doc('payout').set({
        accountName: 'ChauatGo', accountNumber: '1234567890', bankName: 'กสิกรไทย', promptPay: ''
      });
      await root.collection('config').doc('dispatch').set({ mode: 'manual', secretNote: 'internal' });
      await root.collection('orders').doc('ord1').set({
        type: 'food', status: 'done', userId: 'cust1', merchantId: 'shop1', riderId: 'rider1',
        userPhone: '0812345678', address: '99/1 หมู่ 3', fare: 100
      });
    });

    const shop = rulesEnv.authenticatedContext('shop1').firestore();
    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const admin = rulesEnv.authenticatedContext('admin1').firestore();
    const now = new Date();
    const chat = {
      kind: 'shop', partyId: 'shop1', partyName: 'ร้านข้าว', lastMessage: '',
      lastSenderId: 'shop1', lastMessageAt: now, createdAt: now
    };
    await assertSucceeds(shop.collection('settlement_chats').doc('shop_shop1').set(chat));
    await assertSucceeds(shop.collection('settlement_chats').doc('shop_shop1').collection('messages').add({
      senderId: 'shop1', senderRole: 'shop', text: 'ยอด GP ไม่ตรง', createdAt: now
    }));
    await assertFails(rider.collection('settlement_chats').doc('shop_shop1').get());
    await assertFails(customer.collection('settlement_chats').doc('shop_shop1').get());
    await assertFails(rider.collection('settlement_chats').doc('shop_shop1').collection('messages').get());
    await assertSucceeds(admin.collection('settlement_chats').doc('shop_shop1').get());
    await assertSucceeds(admin.collection('settlement_chats').doc('shop_shop1').collection('messages').add({
      senderId: 'admin1', senderRole: 'admin', text: 'ตรวจยอดแล้ว', createdAt: now
    }));
    const ownChat = await shop.collection('settlement_chats').doc('shop_shop1').get();
    const saved = JSON.stringify(ownChat.data());
    assert.equal(saved.includes('0812345678'), false);
    assert.equal(saved.includes('99/1'), false);
    await assertFails(shop.collection('chats').doc('ord1').collection('messages').doc('missing').get());

    const remit = {
      riderId: 'rider1', riderName: 'สมหมาย', amount: 20, dateKey: '2026-11-11', status: 'pending',
      slipUrl: 'https://example.test/slip.jpg', slipPath: 'settlement_slips/riders/rider1/1.jpg',
      note: '', createdAt: now
    };
    const remitId = 'rider_rider1_2026-11-11';
    await assertFails(rider.collection('rider_remittances').doc(remitId).set(remit));
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('rider_remittances').doc(remitId).set(remit);
    });
    await assertFails(shop.collection('rider_remittances').doc(remitId).get());
    await assertFails(customer.collection('rider_remittances').doc(remitId).get());
    await assertSucceeds(admin.collection('rider_remittances').doc(remitId).get());
    await assertFails(admin.collection('rider_remittances').doc(remitId).update({ status: 'verified' }));
    await assertFails(rider.collection('rider_remittances').doc(remitId).update({ status: 'verified', riderPaid: true }));
    await assertFails(rider.collection('orders').doc('ord1').update({ riderPaid: true }));

    await assertSucceeds(shop.collection('config').doc('payout').get());
    await assertSucceeds(rider.collection('config').doc('payout').get());
    await assertFails(customer.collection('config').doc('payout').get());
    await assertFails(shop.collection('config').doc('payout').update({ accountNumber: '999' }));
    const payout = await rider.collection('config').doc('payout').get();
    assert.equal(payout.data().secret, undefined);
    assert.equal(payout.data().accountName, 'ChauatGo');
  } finally {
    await rulesEnv.cleanup();
  }
});
