'use strict';

const { maskThaiName } = require('./rider-history');

function safeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map((item) => ({
    name: String(item && item.name || '').slice(0, 80),
    qty: Number(item && item.qty) || 0,
    price: Number(item && item.price) || 0
  }));
}

function foodMoney(after, items) {
  const direct = Number(after.itemsTotal || after.foodTotal || 0);
  if (direct) return direct;
  return items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
}

function put(out, key, value) {
  if (value !== undefined && value !== null && value !== '') out[key] = value;
}

// The shop cooks from this row. It is an allowlist, so a phone, address, or
// coordinate on the order cannot be copied in by accident.
function merchantSummary(orderId, after) {
  const items = safeItems(after.items);
  const total = foodMoney(after, items);
  const summary = {
    orderId: orderId,
    shortId: String(after.code || orderId).slice(-6),
    status: after.status || '',
    type: after.type || '',
    customerName: maskThaiName(after.userName) || 'ลูกค้า',
    items: items,
    itemsText: String(after.itemsText || '').slice(0, 500),
    note: String(after.note || '').slice(0, 300),
    paymentMode: after.paymentMode || '',
    foodTotal: total,
    itemsTotal: total,
    safe: true
  };
  put(summary, 'code', after.code);
  put(summary, 'prepMinutes', after.prepMinutes);
  put(summary, 'foodReady', after.foodReady === true ? true : undefined);
  put(summary, 'riderId', after.riderId);
  put(summary, 'userId', after.userId);
  put(summary, 'merchantId', after.merchantId);
  put(summary, 'riderName', after.riderName ? maskThaiName(after.riderName) : '');
  put(summary, 'cancelReason', after.cancelReason);
  if (after.stockIssue && typeof after.stockIssue === 'object') {
    summary.stockIssue = {
      status: String(after.stockIssue.status || ''),
      note: String(after.stockIssue.note || '').slice(0, 300),
      items: safeItems(after.stockIssue.items)
    };
  }
  if (Number(after.refundDue) > 0) summary.refundDue = Number(after.refundDue);
  ['createdAt', 'cookingAt', 'readyAt', 'doneAt', 'deliveredAt', 'cancelledAt', 'shopClosedAt'].forEach((key) => {
    if (after[key]) summary[key] = after[key];
  });
  return summary;
}

async function syncMerchantInbox(db, orderId, before, after) {
  const prevId = before && before.merchantId;
  const nextId = after && after.merchantId;
  if (prevId && prevId !== nextId) {
    await db.collection('merchants').doc(prevId).collection('orderInbox').doc(orderId).delete();
  }
  if (!after || !nextId) {
    if (prevId && !nextId) {
      await db.collection('merchants').doc(prevId).collection('orderInbox').doc(orderId).delete();
    }
    return false;
  }
  await db.collection('merchants').doc(nextId).collection('orderInbox').doc(orderId).set(merchantSummary(orderId, after));
  return true;
}

module.exports = {
  merchantSummary,
  syncMerchantInbox
};
