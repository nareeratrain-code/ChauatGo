'use strict';

function hasSlip(value) {
  return !!(value && typeof value.customerSlipUrl === 'string' && value.customerSlipUrl.trim());
}

function customerSlipNotification(before, after, orderId) {
  if (!after || !after.riderId || !hasSlip(after)) return null;
  // Firestore onWrite can run for every subsequent order update. Notify only
  // when the proof changes from absent to present, so riders never get spammed.
  if (hasSlip(before)) return null;

  const code = after.code ? `ออเดอร์ ${after.code}` : `ออเดอร์ ${orderId}`;
  const total = Number(after.total || after.foodTotal || 0);
  const amount = Number.isFinite(total) && total > 0 ? ` ฿${total.toLocaleString('th-TH')}` : '';
  return {
    title: '💸 ลูกค้าโอนเงินแล้ว',
    body: `${code} มีสลิปการโอนแล้ว${amount} — ตรวจสอบสลิปและแนบสลิปที่จ่ายร้านได้เลย`,
    data: {
      type: 'customer_slip_uploaded',
      orderId: String(orderId),
      status: String(after.status || 'picked_up')
    }
  };
}

module.exports = { customerSlipNotification };
