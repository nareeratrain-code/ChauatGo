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

const SHOPPING_STOCKOUT_FEE = 20;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function shoppingRiderArrived(order) {
  if (!order) return false;
  if (order.shopArrivedAt || order.pickedUpAt) return true;
  return ['picked_up', 'customer_paid', 'on_the_way'].indexOf(order.status) !== -1;
}

function shoppingStockoutPlan(order, reason) {
  const text = cleanReason(reason);
  if (!order || order.type !== 'shopping' || (text !== 'ของหมด' && text !== 'ซื้อไม่ได้')) {
    return { apply: false, beforeArrival: false };
  }
  if (!shoppingRiderArrived(order)) return { apply: false, beforeArrival: true };
  const paidTransfer = !!(order.customerPaidAt && order.paymentMode !== 'cash');
  const already = round2(order.total);
  return {
    apply: true,
    beforeArrival: false,
    fare: SHOPPING_STOCKOUT_FEE,
    total: SHOPPING_STOCKOUT_FEE,
    foodTotal: 0,
    itemsTotal: 0,
    cashTip: 0,
    refundDue: paidTransfer ? Math.max(0, round2(already - SHOPPING_STOCKOUT_FEE)) : 0,
    riderIncome: 16,
    riderOwe: 4,
    finishNow: order.paymentMode === 'cash' || paidTransfer,
    waitForSlip: order.paymentMode !== 'cash' && !order.customerPaidAt
  };
}

function shoppingStockoutText(plan) {
  if (!plan || !plan.apply) return '';
  if (plan.waitForSlip) {
    return 'ของหมดหรือซื้อไม่ได้หลังไรเดอร์ถึงร้าน\nค่าบริการเริ่มต้น ฿20 ให้ไรเดอร์ สำหรับเวลาและค่าน้ำมัน\nของที่ไม่ได้ซื้อไม่คิดเงิน\nกรุณาโอน ฿20 แล้วแนบสลิปในแชทนี้';
  }
  if (plan.refundDue > 0) {
    return 'ของหมดหรือซื้อไม่ได้หลังไรเดอร์ถึงร้าน\nคงค่าบริการเริ่มต้น ฿20\nต้องคืนเงิน ฿' + plan.refundDue;
  }
  return 'ของหมดหรือซื้อไม่ได้หลังไรเดอร์ถึงร้าน\nเก็บเงินสดค่าบริการเริ่มต้น ฿20 ให้ไรเดอร์\nของที่ไม่ได้ซื้อไม่คิดเงิน';
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
  const body = {
    text: text,
    senderId: sender.id || '',
    senderRole: sender.role || 'rider',
    senderName: sender.name || '',
    systemMessage: true,
    createdAt: FieldValue.serverTimestamp()
  };
  if (sender.automationKey) {
    body.automated = true;
    body.automationKey = sender.automationKey;
  }
  await ref.collection('messages').add(body);
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

async function reportShoppingStockout(db, riderId, orderId, reason) {
  const text = cleanReason(reason);
  if (text !== 'ของหมด' && text !== 'ซื้อไม่ได้') {
    const err = new Error('ใช้ได้เมื่อของหมดหรือซื้อไม่ได้');
    err.code = 'invalid-argument';
    throw err;
  }
  const orderRef = db.collection('orders').doc(String(orderId || ''));
  const riderRef = db.collection('riders').doc(riderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    const err = new Error('ไม่พบออเดอร์');
    err.code = 'not-found';
    throw err;
  }
  const order = snap.data() || {};
  const decided = shoppingStockoutPlan(order, text);
  if (order.riderId !== riderId || order.type !== 'shopping') {
    const err = new Error('งานนี้ไม่ใช่งานฝากซื้อของคุณ');
    err.code = 'permission-denied';
    throw err;
  }
  if (!decided.apply) {
    const err = new Error('ยังไม่ถึงร้าน จึงยังไม่คิดค่าบริการ 20 บาท');
    err.code = 'failed-precondition';
    throw err;
  }
  const riderSnap = await riderRef.get();
  const rider = riderSnap.exists ? (riderSnap.data() || {}) : {};
  const patch = {
    fare: decided.fare,
    total: decided.total,
    foodTotal: 0,
    itemsTotal: 0,
    cashTip: 0,
    chargedTotal: decided.total,
    refundDue: decided.refundDue,
    shoppingStockoutFee: true,
    shoppingStockoutAt: FieldValue.serverTimestamp(),
    cancelReason: text,
    cancelledBy: 'rider',
    riderOwe: decided.riderOwe,
    riderIncome: decided.finishNow ? decided.riderIncome : 0,
    riderPaid: false,
    customerNotice: shoppingStockoutText(decided)
  };
  if (decided.finishNow) {
    patch.status = 'done';
    patch.doneAt = FieldValue.serverTimestamp();
    patch.shoppingStockoutSettled = true;
  } else {
    patch.status = order.status === 'on_the_way' || order.status === 'customer_paid' ? order.status : 'picked_up';
    patch.shoppingStockoutSettled = false;
    if (rider.qrCodeUrl) {
      patch.riderQrCodeUrl = rider.qrCodeUrl;
      patch.riderQrCodePath = rider.qrCodePath || '';
    }
  }
  await orderRef.update(patch);
  if (decided.finishNow) {
    await riderRef.set({
      totalJobs: FieldValue.increment(1),
      totalIncome: FieldValue.increment(decided.riderIncome)
    }, { merge: true });
  }
  await postPlainChat(db, String(orderId), Object.assign({ id: orderId }, order), shoppingStockoutText(decided), {
    id: riderId,
    role: 'rider',
    name: rider.name || order.riderName || 'ไรเดอร์',
    automationKey: 'shopping_stockout'
  });
  return { ok: true, fare: decided.fare, refundDue: decided.refundDue, finishNow: decided.finishNow };
}

async function finalizeShoppingStockout(db, before, after, orderId) {
  if (!after || after.shoppingStockoutFee !== true || after.shoppingStockoutSettled === true) return false;
  if (after.paymentMode === 'cash' || !after.customerPaidAt) return false;
  if (before && before.customerPaidAt && before.shoppingStockoutSettled === true) return false;
  const orderRef = db.collection('orders').doc(orderId);
  await orderRef.set({
    status: 'done',
    doneAt: FieldValue.serverTimestamp(),
    fare: SHOPPING_STOCKOUT_FEE,
    total: SHOPPING_STOCKOUT_FEE,
    riderIncome: 16,
    riderOwe: 4,
    riderPaid: false,
    shoppingStockoutSettled: true
  }, { merge: true });
  if (after.riderId) {
    await db.collection('riders').doc(after.riderId).set({
      totalJobs: FieldValue.increment(1),
      totalIncome: FieldValue.increment(16)
    }, { merge: true });
  }
  return true;
}

module.exports = {
  END_JOB_REASONS,
  SHOPPING_STOCKOUT_FEE,
  goodsBought,
  beforeServiceCutoff,
  redispatchStatus,
  cleanReason,
  isEndJobReason,
  cancelRefundDue,
  shoppingRiderArrived,
  shoppingStockoutPlan,
  shoppingStockoutText,
  redispatchFromRider,
  reportShoppingStockout,
  finalizeShoppingStockout
};
