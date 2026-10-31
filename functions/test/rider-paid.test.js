'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Orders = require('../orders');

const FORBIDDEN = 'เหล่าเต๊ง';

test('rider confirms a transfer was received', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'chauat-go-b9841' });
  const db = getFirestore();

  const base = {
    type: 'express',
    parcelType: 'food',
    title: 'ส่งด่วน • อาหาร',
    paymentMode: 'transfer',
    riderId: 'rider-pay',
    riderName: 'ไรเดอร์ทดสอบ',
    userId: 'cust-pay',
    fare: 35,
    total: 35,
    code: 'OD-TEST',
    merchantName: 'ร้านทดสอบ',
    dispatchState: 'assigned'
  };
  assert.equal(JSON.stringify(base).includes(FORBIDDEN), false);

  await db.collection('orders').doc('ord-pay-wait').set(Object.assign({}, base, { status: 'picked_up' }));
  const first = await Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-wait');
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  assert.equal(first.status, 'customer_paid');
  const paid = (await db.collection('orders').doc('ord-pay-wait').get()).data();
  assert.equal(paid.status, 'customer_paid');
  assert.equal(paid.customerPaid, true);
  assert.ok(paid.customerPaidAt);
  assert.equal(paid.paidConfirmedBy, 'rider');
  assert.equal(paid.fare, 35);
  assert.equal(paid.total, 35);
  assert.equal(paid.riderIncome, undefined);
  const msg = await db.collection('chats').doc('ord-pay-wait').collection('messages').doc('auto_payment_received').get();
  assert.equal(msg.exists, true);
  assert.match(msg.data().text, /ได้รับเงินโอน ฿35/);
  assert.match(msg.data().text, /กำลังออกไปส่ง/);
  assert.equal(msg.data().senderRole, 'rider');
  assert.equal(msg.data().automated, true);
  const again = await Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-wait');
  assert.equal(again.already, true);
  assert.equal(again.status, 'customer_paid');

  await assert.rejects(
    () => Orders.confirmPaymentReceived(db, 'other-rider', 'ord-pay-wait'),
    (err) => err && err.message === 'not-yours'
  );

  await db.collection('orders').doc('ord-pay-early').set(Object.assign({}, base, { status: 'accepted' }));
  const early = await Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-early');
  assert.equal(early.already, false);
  assert.equal(early.status, 'accepted');
  const earlyDoc = (await db.collection('orders').doc('ord-pay-early').get()).data();
  assert.equal(earlyDoc.status, 'accepted');
  assert.equal(earlyDoc.customerPaid, true);
  assert.ok(earlyDoc.customerPaidAt);
  assert.equal(earlyDoc.fare, 35);
  assert.equal(earlyDoc.total, 35);
  const earlyMsg = await db.collection('chats').doc('ord-pay-early').collection('messages').doc('auto_payment_received').get();
  assert.match(earlyMsg.data().text, /จะรับของแล้วออกส่ง/);

  await db.collection('orders').doc('ord-pay-early').update({ status: 'picked_up' });
  const afterPickup = await Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-early');
  assert.equal(afterPickup.already, false);
  assert.equal(afterPickup.status, 'customer_paid');
  const moved = (await db.collection('orders').doc('ord-pay-early').get()).data();
  assert.equal(moved.status, 'customer_paid');
  assert.equal(moved.fare, 35);
  assert.equal(moved.total, 35);
  const still = await db.collection('chats').doc('ord-pay-early').collection('messages').doc('auto_payment_received').get();
  assert.match(still.data().text, /จะรับของแล้วออกส่ง/);
  assert.equal((still.data().text.match(/ได้รับเงินโอน/g) || []).length, 1);

  await db.collection('orders').doc('ord-pay-cash').set(Object.assign({}, base, {
    status: 'picked_up',
    paymentMode: 'cash',
    cashTip: 5
  }));
  await assert.rejects(
    () => Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-cash'),
    (err) => err && err.code === 'failed-precondition' && /เงินสด/.test(err.message)
  );
  const cashDoc = (await db.collection('orders').doc('ord-pay-cash').get()).data();
  assert.equal(cashDoc.status, 'picked_up');
  assert.equal(cashDoc.customerPaidAt, undefined);
  assert.equal(cashDoc.fare, 35);

  await db.collection('orders').doc('ord-pay-way').set(Object.assign({}, base, { status: 'on_the_way' }));
  await assert.rejects(
    () => Orders.confirmPaymentReceived(db, 'rider-pay', 'ord-pay-way'),
    (err) => err && err.code === 'failed-precondition'
  );
  const wayDoc = (await db.collection('orders').doc('ord-pay-way').get()).data();
  assert.equal(wayDoc.status, 'on_the_way');
  assert.equal(wayDoc.fare, 35);
  assert.equal(wayDoc.customerPaidAt, undefined);
});
