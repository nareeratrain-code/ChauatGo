'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const END_JOB_REASONS = [
  'ของหมด',
  'ซื้อไม่ได้',
  'ติดต่อลูกค้าไม่ได้',
  'ลูกค้าไม่รับของ',
  'ลูกค้าไม่ขึ้นรถ',
  'ลูกค้าไม่โอนเงินภายใน 15 นาที'
];

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function goodsBought(order) {
  if (!order) return false;
  return hasText(order.foodImage) || hasText(order.shopBillUrl) || hasText(order.riderSlipToShop) || hasText(order.riderSlipUrl);
}

function beforeServiceCutoff(order) {
  if (!order) return false;
  if (['done', 'delivered', 'cancelled', 'shop_closed', 'on_the_way', 'customer_paid'].indexOf(order.status) !== -1) {
    return false;
  }
  if (order.type === 'express') return order.customerOrderConfirmed !== true;
  if (order.type === 'ride' || (order.type === 'food' && order.partnerShop === true)) {
    return order.status !== 'picked_up';
  }
  if (order.type === 'shopping' || order.type === 'food') return !goodsBought(order);
  return order.status !== 'picked_up';
}

function redispatchStatus(order) {
  if (order && order.type === 'food' && order.partnerShop === true) {
    if (order.foodReady === true || order.readyAt || order.status === 'ready') return 'ready';
    return 'cooking';
  }
  return 'searching';
}

function cleanReason(reason) {
  return String(reason || '').trim().slice(0, 300);
}

function isEndJobReason(reason) {
  return END_JOB_REASONS.indexOf(cleanReason(reason)) !== -1;
}

function cancelRefundDue(order) {
  if (!order || !order.customerPaidAt || order.paymentMode === 'cash') return 0;
  const total = Number(order.total);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

async function postPlainChat(db, chatId, order, text, sender) {
  const ref = db.collection('chats').doc(chatId);
  const snap = await ref.get();
  const shop = chatId.slice(-6) === '__shop';
  const preview = String(text || '').slice(0, 140);
  if (!snap.exists) {
    await ref.set({
      orderId: order.id || chatId.replace(/__shop$/, ''),
      thread: shop ? 'shop' : 'rider',
      userId: order.userId || '',
      userName: order.userName || '',
      riderId: shop ? '' : (sender.id || ''),
      riderName: shop ? '' : (sender.name || ''),
      merchantId: order.merchantId || '',
      merchantName: order.merchantName || '',
      lastMessage: preview,
      lastSenderId: sender.id || '',
      lastMessageAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp()
    });
  } else {
    await ref.set({
      lastMessage: preview,
      lastSenderId: sender.id || '',
      lastMessageAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await ref.collection('messages').add({
    text: text,
    senderId: sender.id || '',
    senderRole: sender.role || 'rider',
    senderName: sender.name || '',
    systemMessage: true,
    createdAt: FieldValue.serverTimestamp()
  });
}

async function redispatchFromRider(db, dispatch, riderId, orderId, reason) {
  const text = cleanReason(reason);
  if (text.length < 1) {
    const err = new Error('เหตุผลต้องมี 1–300 ตัวอักษร');
    err.code = 'invalid-argument';
    throw err;
  }
  if (isEndJobReason(text)) {
    const err = new Error('เหตุผลนี้เป็นการจบงาน ไม่ใช่การหาไรเดอร์ใหม่');
    err.code = 'failed-precondition';
    throw err;
  }
  const orderRef = db.collection('orders').doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    const err = new Error('ไม่พบออเดอร์');
    err.code = 'not-found';
    throw err;
  }
  const order = snap.data() || {};
  if (order.riderId !== riderId) {
    const err = new Error('งานนี้ไม่ใช่ของคุณ');
    err.code = 'permission-denied';
    throw err;
  }
  if (!beforeServiceCutoff(order)) {
    const err = new Error('เลยจุดที่หาไรเดอร์ใหม่ได้แล้ว');
    err.code = 'failed-precondition';
    throw err;
  }
  const nextStatus = redispatchStatus(order);
  if (dispatch && dispatch.closePendingOffers) {
    await dispatch.closePendingOffers(db, orderRef, 'released');
  }
  await orderRef.update({
    riderId: FieldValue.delete(),
    riderName: FieldValue.delete(),
    riderPhone: FieldValue.delete(),
    riderQrCodeUrl: FieldValue.delete(),
    riderQrCodePath: FieldValue.delete(),
    status: nextStatus,
    dispatchState: 'seeking',
    dispatchOfferId: FieldValue.delete(),
    dispatchOfferRiderId: FieldValue.delete(),
    dispatchOfferExpiresAt: FieldValue.delete(),
    dispatchManualReason: FieldValue.delete(),
    lastReleasedRiderId: riderId,
    dispatchUpdatedAt: FieldValue.serverTimestamp()
  });
  const code = order.code || orderId.slice(-6);
  await postPlainChat(db, orderId, Object.assign({ id: orderId }, order), 
    'กำลังหาไรเดอร์คนใหม่\nออเดอร์ ' + code + '\nเหตุผล: ' + text,
    { id: riderId, role: 'rider', name: order.riderName || 'ไรเดอร์' }
  );
  return { ok: true, status: nextStatus };
}

module.exports = {
  END_JOB_REASONS,
  goodsBought,
  beforeServiceCutoff,
  redispatchStatus,
  cleanReason,
  isEndJobReason,
  cancelRefundDue,
  redispatchFromRider
};
