'use strict';

const crypto = require('crypto');

const MAX_ORDER_IDS = 100;
const MAX_ID_LENGTH = 150;

function normalizeId(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}ไม่ถูกต้อง`);
  const id = value.trim();
  if (!id || id.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f/]/.test(id)) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return id;
}

function normalizeOrderIds(orderIds) {
  if (!Array.isArray(orderIds)) throw new Error('ต้องระบุรายการออเดอร์');
  const ids = [...new Set(orderIds.map(id => normalizeId(id, 'รหัสออเดอร์')))].filter(Boolean);
  if (!ids.length) throw new Error('ไม่พบออเดอร์ที่พร้อมโอน');
  if (ids.length > MAX_ORDER_IDS) throw new Error('โอนได้ครั้งละไม่เกิน 100 ออเดอร์');
  return ids.sort();
}

function buildPayoutId(riderId, orderIds) {
  const ids = normalizeOrderIds(orderIds);
  const rider = normalizeId(riderId, 'รหัสไรเดอร์');
  const digest = crypto.createHash('sha256').update(`${rider}|${ids.join('|')}`).digest('hex').slice(0, 32);
  return `rider_${digest}`;
}

function calculatePayoutOrders(orders, riderId) {
  const rider = normalizeId(riderId, 'รหัสไรเดอร์');
  if (!Array.isArray(orders) || !orders.length) throw new Error('ไม่พบออเดอร์ที่พร้อมโอน');

  let amount = 0;
  const orderIds = [];
  for (const order of orders) {
    if (!order || order.riderId !== rider) throw new Error('ออเดอร์ไม่ตรงกับไรเดอร์');
    if (!['done', 'delivered'].includes(order.status)) throw new Error('ออเดอร์ยังไม่เสร็จสมบูรณ์');
    if (order.riderPayoutPaid === true) throw new Error('มีออเดอร์ถูกโอนไปแล้ว');
    // gpRider is server-calculated by completeOrder. Do not calculate money from
    // client-controlled foodTotal here; missing values require manual review.
    if (typeof order.gpRider !== 'number' || !Number.isFinite(order.gpRider) || order.gpRider <= 0) {
      throw new Error('ออเดอร์ขาดยอด GP ไรเดอร์สำหรับตรวจสอบ');
    }
    const value = Math.round((order.gpRider + Number.EPSILON) * 100) / 100;
    amount = Math.round((amount + value + Number.EPSILON) * 100) / 100;
    orderIds.push(normalizeId(order.id, 'รหัสออเดอร์'));
  }
  return { riderId: rider, orderIds: orderIds.sort(), amount };
}

module.exports = { MAX_ORDER_IDS, MAX_ID_LENGTH, normalizeId, normalizeOrderIds, buildPayoutId, calculatePayoutOrders };
