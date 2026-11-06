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

function customerQuoteNotification(before, after, orderId) {
  if (!after || after.type !== 'shopping' || !after.userId || !after.riderId) return null;
  const hasPhoto = typeof after.foodImage === 'string' && after.foodImage.trim().length > 0;
  const foodTotal = Number(after.foodTotal || after.itemsTotal || 0);
  if (!hasPhoto || !Number.isFinite(foodTotal) || foodTotal <= 0) return null;
  const hadQuote = before && typeof before.foodImage === 'string'
    && before.foodImage.trim().length > 0
    && Number(before.foodTotal || before.itemsTotal || 0) > 0;
  if (hadQuote) return null;

  const fare = Number(after.fare || 0);
  const tip = after.paymentMode === 'cash' ? Number(after.cashTip || 5) : 0;
  const total = foodTotal + (Number.isFinite(fare) ? fare : 0) + (Number.isFinite(tip) ? tip : 0);
  const code = after.code ? `ออเดอร์ ${after.code}` : `ออเดอร์ ${orderId}`;
  return {
    title: '📸 ไรเดอร์ส่งรูปสินค้าและราคาแล้ว',
    body: `${code} ยอดสินค้า ฿${foodTotal.toLocaleString('th-TH')} + ค่าบริการ ฿${fare.toLocaleString('th-TH')} = ฿${total.toLocaleString('th-TH')} กรุณาตรวจสอบและยืนยันยอดเพื่อรับ QR Code`,
    data: {
      type: 'customer_quote_ready',
      orderId: String(orderId),
      status: String(after.status || 'picked_up')
    }
  };
}

module.exports = { customerSlipNotification, customerQuoteNotification };
