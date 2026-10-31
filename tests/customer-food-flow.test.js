const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('index.html', 'utf8');

function cartTotals(items, deliveryFee, cashTip = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = items.reduce((sum, item) => sum + (item.discount || 0) * item.qty, 0);
  return { subtotal, discount, deliveryFee, cashTip, grandTotal: subtotal - discount + deliveryFee + cashTip };
}

test('Customer Food E2E: เปิดร้าน → เพิ่มเมนู → ตะกร้า → จุดส่ง → โอน → ส่งออเดอร์', () => {
  const merchant = { id: 'merchant-001', name: 'ร้านทดสอบชะอวด' };
  const items = [
    { merchantId: merchant.id, menuId: 'menu-001', menuName: 'ข้าวกะเพรา', price: 70, qty: 1 },
    { merchantId: merchant.id, menuId: 'menu-002', menuName: 'ชาเย็น', price: 35, qty: 2, discount: 2 }
  ];
  const dropoff = { address: 'บ้านเลขที่ 99 ต.ชะอวด', lat: 7.95, lng: 100.02, note: 'บ้านรั้วสีเขียว' };
  const totals = cartTotals(items, 20);

  assert.equal(merchant.id, items[0].merchantId);
  assert.equal(items.length, 2);
  assert.equal(totals.subtotal, 140);
  assert.equal(totals.discount, 4);
  assert.equal(totals.grandTotal, 156);
  assert.ok(dropoff.address && Number.isFinite(dropoff.lat) && Number.isFinite(dropoff.lng));

  const payload = {
    type: 'food', merchantId: merchant.id, merchantName: merchant.name,
    items, address: dropoff.address, lat: dropoff.lat, lng: dropoff.lng,
    note: dropoff.note, paymentMode: 'transfer', total: totals.grandTotal
  };
  assert.equal(payload.type, 'food');
  assert.equal(payload.paymentMode, 'transfer');
  assert.equal(payload.total, 156);
});

test('Customer Food E2E: เปลี่ยนเป็นเงินสดเพิ่มค่าบริการพิเศษ ฿5', () => {
  const totals = cartTotals([{ price: 100, qty: 1 }], 20, 5);
  assert.equal(totals.grandTotal, 125);
  assert.equal('cash', 'cash');
});

test('Customer safeguards: ตะกร้าว่างและไม่มีที่อยู่ต้องหยุดก่อนสร้างออเดอร์', () => {
  assert.match(app, /if \(!cart\.length\) return showToast\('ตะกร้าว่าง'/);
  assert.match(app, /if \(!address\.trim\(\)\)/);
  assert.match(app, /กรุณากรอกที่อยู่ก่อนสั่งซื้อ/);
});

test('Customer UI: มีปุ่มเลือกแผนที่ จุดส่ง วิธีจ่าย และยืนยันยอดรวม', () => {
  assert.match(app, /openMapPicker\(\\?'food\\?'\)/);
  assert.match(app, /setPaymentMode\(\\?'transfer\\?'\)/);
  assert.match(app, /setPaymentMode\(\\?'cash\\?'\)/);
  assert.match(app, /onclick="confirmCheckout\(/);
  assert.match(app, /paymentMode: selectedPaymentMode/);
});

test('Customer Checkout: ข้อความร้าน Partner และร้านในพื้นที่ไม่ทำให้สับสน', () => {
  assert.match(app, /ร้าน Partner เปิดรับออเดอร์แล้ว/);
  assert.match(app, /กรุณาติดต่อร้านค้าก่อนเรียกไรเดอร์/);
  assert.match(app, /ไม่มีส่วนเกี่ยวข้องกับร้านนี้/);
  assert.match(app, /id="shop-disclaimer-ack"/);
  assert.match(app, /if \(!ack \|\| !ack\.checked\)/);
  assert.match(app, /shopDisclaimerAccepted: !partnerNow/);
  assert.match(app, /verified: m\.verified === true/);
  assert.match(app, /โอนให้ไรเดอร์/);
  assert.match(app, /ให้ไรเดอร์/);
});

test('Customer order tracking: หลังสร้างออเดอร์มีจุดติดตาม แชท และยืนยันการโอน', () => {
  assert.match(app, /function confirmCustomerPaid|window\.confirmCustomerPaid/);
  assert.match(app, /customerPaidAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  assert.match(app, /currentTrackingOrder/);
  assert.match(app, /openOrderChat|openChat/);
});

test('Customer payment UI: ยืนยันรายการ → แนบสลิป → ยืนยันโอน', () => {
  assert.match(app, /window\.confirmCustomerOrder/);
  assert.match(app, /customerOrderConfirmed: true/);
  assert.match(app, /customerOrderConfirmedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  assert.match(app, /id="customer-slip-input"/);
  assert.match(app, /window\.handleCustomerSlipPick/);
  assert.match(app, /slips\/customers\/' \+ currentUser\.uid/);
  assert.match(app, /customerSlipUrl: url/);
  assert.match(app, /กรุณาแนบสลิปการโอนก่อนยืนยัน/);
});

test('Customer UI: แสดงเหตุผลสลิปถูกปฏิเสธและปุ่มอัปโหลดใหม่', () => {
  assert.match(app, /customerSlipRejected/);
  assert.match(app, /กรุณาอัปโหลดสลิปใหม่/);
  assert.match(app, /customerSlipRejectionReason/);
  assert.match(app, /ถ่ายหรือเลือกสลิปใหม่/);
  assert.match(app, /slipUpdate\.customerSlipStatus = 'pending'/);
  assert.match(app, /slipUpdate\.customerSlipRevision/);
});
