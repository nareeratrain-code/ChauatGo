const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const indexSource = fs.readFileSync('index.html', 'utf8');
const riderSource = fs.readFileSync('rider.js', 'utf8');

test('Checkout แสดงคำเตือนเงินสดและค่าบริการพิเศษเมื่อเลือก cash', () => {
  const checkoutStart = indexSource.indexOf('function renderCheckoutModal');
  const checkoutEnd = indexSource.indexOf('function captureFoodCheckoutDraft', checkoutStart);
  const checkout = indexSource.slice(checkoutStart, checkoutEnd);

  assert.match(checkout, /var isCash = selectedPaymentMode === 'cash'/);
  assert.match(checkout, /ค่าบริการพิเศษ \(เงินสด\)/);
  assert.match(checkout, /ไรเดอร์ต้องสำรองจ่ายร้านก่อน/);
  assert.match(checkout, /ค่าบริการพิเศษ ฿5 จะเป็นทิปให้ไรเดอร์/);
  assert.doesNotMatch(checkout, /qrCodeUrl|sendRiderQrPaymentChat/);
});

test('Order Card ซ่อนปุ่มโอนและแสดงให้ลูกค้าจ่ายเงินสดกับไรเดอร์', () => {
  const cardStart = indexSource.indexOf('function renderOrderCard');
  const cardEnd = indexSource.indexOf('function renderOrderTimeline', cardStart);
  const card = indexSource.slice(cardStart, cardEnd);

  assert.match(card, /var isCash = o\.paymentMode === 'cash'/);
  assert.match(card, /isCash && \(o\.status === 'picked_up' \|\| o\.status === 'on_the_way'\)/);
  assert.match(card, /ชำระเงินสดกับไรเดอร์/);
  assert.match(card, /else if \(o\.status === 'picked_up' && !o\.customerPaidAt\)/);
  assert.match(card, /confirmCustomerPaid/);
});

test('Cash Order ไม่สามารถกดยืนยันการโอนเงินได้', () => {
  const fnStart = indexSource.indexOf('window.confirmCustomerPaid = async function');
  const fnEnd = indexSource.indexOf('\n}', fnStart) + 2;
  const fn = indexSource.slice(fnStart, fnEnd);
  assert.match(fn, /cached && cached\.paymentMode === 'cash'/);
  assert.match(fn, /ออเดอร์เงินสด — ชำระเงินสดกับไรเดอร์/);
});

test('Rider QR Chat ไม่ส่งข้อความหรือ QR สำหรับออเดอร์เงินสด', () => {
  const fnStart = riderSource.indexOf('async function sendRiderQrPaymentChat');
  const fnEnd = riderSource.indexOf('\n}\n\nfunction sendAutomatedChatLater', fnStart) + 2;
  const fn = riderSource.slice(fnStart, fnEnd);
  assert.match(fn, /order\.paymentMode === 'cash'\) return false/);
  assert.match(fn, /imageUrl: riderProfile\.qrCodeUrl/);
});
