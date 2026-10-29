const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rider = fs.readFileSync('rider.js', 'utf8');

function canLeaveShop(order) {
  if (!order.riderSlipToShop) return false;
  if (order.paymentMode === 'cash') return true;
  return !!order.customerPaidAt || order.status === 'customer_paid';
}

test('Food E2E: รับงาน → ถึงร้าน → ส่งรูป → รอลูกค้าโอน → แนบสลิปร้าน → เริ่มส่ง → ส่งสำเร็จ', () => {
  const order = {
    id: 'OD-FLOW-001', type: 'food', paymentMode: 'transfer',
    status: 'ready', foodImage: '', riderSlipToShop: '', customerPaidAt: null
  };

  assert.equal(order.status, 'ready');
  order.status = 'accepted';
  assert.equal(order.status, 'accepted');

  order.status = 'picked_up';
  order.foodImage = 'https://storage.example/food.jpg';
  assert.equal(Boolean(order.foodImage), true);
  assert.equal(canLeaveShop(order), false, 'ยังออกจากร้านไม่ได้ก่อนลูกค้าโอนและยังไม่มีสลิปร้าน');

  order.customerPaidAt = '2026-10-28T07:30:00Z';
  order.status = 'customer_paid';
  assert.equal(canLeaveShop(order), false, 'ลูกค้าโอนแล้วแต่ยังไม่มีสลิปร้าน ต้องยังเริ่มส่งไม่ได้');

  order.riderSlipToShop = 'https://storage.example/shop-slip.jpg';
  assert.equal(canLeaveShop(order), true, 'มี customerPaidAt และสลิปร้านแล้ว จึงเริ่มส่งได้');

  order.status = 'on_the_way';
  assert.equal(order.status, 'on_the_way');
  order.status = 'done';
  assert.equal(order.status, 'done');
});

test('UI แยกปุ่มรูปอาหารและสลิปร้าน และให้ไรเดอร์ยืนยันว่ารับโอนแล้ว', () => {
  assert.match(rider, /data-food-photo="\$\{esc\(j\.id\)\}"/);
  assert.match(rider, /ลูกค้าโอนแล้ว \/ ได้รับเงินแล้ว/);
  assert.match(rider, /data-paid=/);
  assert.match(rider, /callDispatch\('confirmPaymentReceived'/);
  assert.match(rider, /data-slip="\$\{esc\(j\.id\)\}"/);
  assert.match(rider, /🍽️ ขั้นตอนงานอาหาร/);
  assert.match(rider, /📸 รูปอาหารให้ลูกค้า/);
  assert.match(rider, /🧾 สลิปที่จ่ายร้าน/);
  assert.match(rider, /!cashPickup && !alreadyPaid\) startPaymentTimers/);
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /function moneyFrozen\(\)/);
  assert.match(rules, /unchanged\('fare'\)/);
  assert.match(rules, /unchanged\('total'\)/);
  assert.match(rules, /unchanged\('riderIncome'\)/);
  const app = fs.readFileSync('index.html', 'utf8');
  assert.match(app, /window\.confirmCustomerPaid = async function/);
});

test('Payment Watch อัปเดต allJobs ทันทีเมื่อ Firestore แจ้ง customerPaidAt', () => {
  const watch = rider.slice(rider.indexOf('function startWatchingPayment'), rider.indexOf('function autoStartPaymentWatch'));
  assert.match(watch, /const localJob = allJobs\.find\(job => job\.id === jobId\)/);
  assert.match(watch, /localJob\.customerPaidAt = data\.customerPaidAt/);
  assert.match(watch, /renderJobs\(\)/);
});
