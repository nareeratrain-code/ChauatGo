'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('each role can cancel only up to its service cutoff', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rulesEnv = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') }
  });
  const stamp = () => new Date();
  try {
    await rulesEnv.clearFirestore();
    await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await root.collection('users').doc('shop1').set({ role: 'merchant' });
      await root.collection('users').doc('cust1').set({ role: 'user' });
      await root.collection('users').doc('rider1').set({ role: 'rider' });
      await root.collection('merchants').doc('shop1').set({ verified: true, name: 'ร้านข้าว' });
      await root.collection('riders').doc('rider1').set({ verified: true, riderId: 'rider1' });
      const base = { userId: 'cust1', merchantId: 'shop1', riderId: 'rider1', paymentMode: 'cash', total: 50, fare: 20 };
      await root.collection('orders').doc('ready-food').set(Object.assign({}, base, {
        type: 'food', partnerShop: true, status: 'accepted', foodReady: true, foodTotal: 30, itemsTotal: 30
      }));
      await root.collection('orders').doc('picked-food').set(Object.assign({}, base, {
        type: 'food', partnerShop: true, status: 'picked_up', paymentMode: 'transfer', customerPaidAt: new Date(), total: 90
      }));
      await root.collection('orders').doc('express-open').set({
        type: 'express', status: 'picked_up', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'transfer', total: 40, customerOrderConfirmed: false
      });
      await root.collection('orders').doc('express-held').set({
        type: 'express', status: 'on_the_way', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'cash', total: 40, customerOrderConfirmed: true
      });
      await root.collection('orders').doc('ride-open').set({
        type: 'ride', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '', paymentMode: 'cash', total: 40
      });
      await root.collection('orders').doc('ride-in').set({
        type: 'ride', status: 'picked_up', userId: 'cust1', riderId: 'rider1', merchantId: '', paymentMode: 'cash', total: 40
      });
      await root.collection('orders').doc('shop-open').set({
        type: 'shopping', status: 'accepted', userId: 'cust1', riderId: 'rider1', merchantId: '', paymentMode: 'cash', total: 40
      });
      await root.collection('orders').doc('shop-bought').set({
        type: 'shopping', status: 'picked_up', userId: 'cust1', riderId: 'rider1', merchantId: '',
        paymentMode: 'transfer', customerPaidAt: new Date(), total: 80, foodImage: 'https://example.com/item.jpg'
      });
    });
    const shop = rulesEnv.authenticatedContext('shop1').firestore();
    const customer = rulesEnv.authenticatedContext('cust1').firestore();
    const rider = rulesEnv.authenticatedContext('rider1').firestore();
    const cancel = (by, reason, extra) => Object.assign({
      status: 'cancelled',
      cancelledAt: stamp(),
      cancelledBy: by,
      cancelReason: reason,
      refundDue: 0
    }, extra || {});
    await assertSucceeds(shop.collection('orders').doc('ready-food').update({
      stockIssue: { status: 'pending', items: [{ name: 'หมู', qty: 1, price: 70 }], note: 'หมูหมด' }
    }));
    await assertSucceeds(customer.collection('orders').doc('ready-food').update(cancel('customer', 'เปลี่ยนใจ')));
    await assertFails(customer.collection('orders').doc('picked-food').update(cancel('customer', 'เปลี่ยนใจ')));
    await assertFails(shop.collection('orders').doc('picked-food').update(cancel('merchant', 'ครัวเต็ม')));
    await assertFails(rider.collection('orders').doc('picked-food').update(cancel('rider', 'ลูกค้าไม่รับของ', { refundDue: 0 })));
    await assertSucceeds(rider.collection('orders').doc('picked-food').update(cancel('rider', 'ลูกค้าไม่รับของ', { refundDue: 90 })));
    await assertSucceeds(customer.collection('orders').doc('express-open').update(cancel('customer', 'รอนาน')));
    await assertFails(customer.collection('orders').doc('express-held').update(cancel('customer', 'รอนาน')));
    await assertFails(rider.collection('orders').doc('express-held').update(cancel('rider', 'ลูกค้าไม่รับของ')));
    await assertSucceeds(rider.collection('orders').doc('express-held').update(cancel('rider', 'ลูกค้าไม่รับของ', {
      expressReturnedAt: stamp()
    })));
    await assertSucceeds(customer.collection('orders').doc('ride-open').update(cancel('customer', 'ที่อยู่ผิด')));
    await assertFails(customer.collection('orders').doc('ride-in').update(cancel('customer', 'เปลี่ยนใจ')));
    await assertFails(rider.collection('orders').doc('ride-open').update(cancel('rider', 'รถเสีย')));
    await assertSucceeds(rider.collection('orders').doc('ride-in').update(cancel('rider', 'ลูกค้าไม่ขึ้นรถ')));
    await assertSucceeds(customer.collection('orders').doc('shop-open').update(cancel('customer', 'สั่งผิด')));
    await assertFails(customer.collection('orders').doc('shop-bought').update(cancel('customer', 'เปลี่ยนใจ')));
    await assertFails(rider.collection('orders').doc('shop-bought').update(cancel('rider', 'ของหมด', { refundDue: 80 })));
  } finally {
    await rulesEnv.cleanup();
  }
});
