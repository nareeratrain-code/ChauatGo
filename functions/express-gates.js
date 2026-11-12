'use strict';

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function expressMayLeavePickup(order) {
  if (!order || order.type !== 'express') return true;
  return hasText(order.foodImage) && order.customerOrderConfirmed === true;
}

function expressMayFinish(order) {
  if (!order || order.type !== 'express') return { ok: true, reason: '' };
  if (!expressMayLeavePickup(order)) return { ok: false, reason: 'รอลูกค้ายืนยันรูปจุดรับ' };
  if (!hasText(order.deliveryProofUrl)) return { ok: false, reason: 'ถ่ายรูปปลายทางก่อน' };
  if (!order.expressDropoffConfirmedAt) return { ok: false, reason: 'รอลูกค้ายืนยันรับของ' };
  if (order.paymentMode !== 'cash' && !order.customerPaidAt) return { ok: false, reason: 'รอลูกค้าแนบสลิป' };
  return { ok: true, reason: '' };
}

module.exports = { expressMayLeavePickup, expressMayFinish };
