'use strict';

function hasPaidAt(value) {
  return !!(value && value.customerPaidAt);
}

function customerSlipNotification(before, after, orderId) {
  if (!after || !after.riderId || !hasPaidAt(after)) return null;
  // A slip upload is not payment. Notify only when the customer confirms,
  // or the rider records the transfer, which is when customerPaidAt appears.
  if (hasPaidAt(before)) return null;

  const code = after.code ? `ออเดอร์ ${after.code}` : `ออเดอร์ ${orderId}`;
  const total = Number(after.total || after.foodTotal || 0);
  const amount = Number.isFinite(total) && total > 0 ? ` ฿${total.toLocaleString('th-TH')}` : '';
  return {
    title: '💸 ลูกค้าโอนเงินแล้ว',
    body: `${code} ยืนยันการโอนแล้ว${amount} — ตรวจสอบสลิปและแนบสลิปที่จ่ายร้านได้เลย`,
    data: {
      type: 'customer_paid',
      orderId: String(orderId),
      status: String(after.status || 'customer_paid')
    }
  };
}

module.exports = { customerSlipNotification };
