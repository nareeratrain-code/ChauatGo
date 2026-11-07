const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const rider = fs.readFileSync('rider.js', 'utf8');
const customer = fs.readFileSync('index.html', 'utf8');

test('accept posts a chat summary and the customer confirms it in chat', () => {
  assert.match(rider, /function paySummaryText\(order\)/);
  assert.match(rider, /automationKey: 'pay_summary'/);
  assert.match(rider, /กรุณากดยืนยัน/);
  assert.match(rider, /postPaySummaryLater\(jobId\)/);
  assert.match(rider, /postPaySummaryLater\(o\.orderId\)/);
  assert.match(customer, /automationKey === 'pay_summary'/);
  assert.match(customer, /onclick="confirmCustomerOrder/);
  assert.match(customer, />ยืนยัน</);
  assert.match(customer, /customerOrderConfirmed/);
});

test('partner food keeps Manus QR and slip fields, and adds the wait-for-photo note', () => {
  assert.match(rider, /กรุณาโอนหลังจากเห็นรูปอาหาร\/สินค้าแล้วเท่านั้น/);
  assert.match(rider, /อาหาร\/สินค้าพร้อมแล้ว กรุณาโอนยอด /);
  // Ride/Express now also posts the rider QR when reaching pickup; food still
  // waits for the photo/price step before asking the customer to transfer.
  assert.match(rider, /sendRiderQrPaymentChat\(jobId, 'shop_arrived'\)/);
  assert.match(rider, /postFoodPaymentChat\(jobId, pickupFoodUrl/);
  assert.match(rider, /imageUrls/);
  assert.match(customer, /function postConfirmPayNote/);
  assert.match(customer, /automationKey: hasGoodsPhoto \? 'food_photo_confirmed' : 'confirm_qr'/);
  assert.match(customer, /order\.riderQrCodeUrl/);
  assert.match(customer, /slips\/customers\//);
  assert.match(customer, /customerSlipStatus = 'pending'/);
  assert.match(rider, /customerSlipStatus: 'rejected'/);
  assert.match(rider, /callDispatch\('confirmPaymentReceived'/);
});

test('photo and shop slip move into chat and express still skips them', () => {
  assert.match(rider, /function openPayGuide\(jobId, stage\)/);
  assert.match(rider, /id="pickup-food-gallery"/);
  assert.match(rider, /id="pickup-slip-gallery"/);
  assert.match(rider, /รอลูกค้าส่งสลิป หรือกดยืนยันว่ารับเงินแล้ว/);
  const arrived = rider.slice(rider.indexOf('async function arrivedAtShop'), rider.indexOf('function paySummaryText'));
  assert.match(arrived, /if \(orderBuysGoods\(job\)\)/);
  assert.match(arrived, /openPayGuide\(jobId, 'food'\)/);
  assert.equal(arrived.includes('openPickupModal(jobId, job)'), false);
  assert.match(rider, /กำลังออกไปส่งสินค้า/);
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /function customerSlipNotRejected\(\)/);
  assert.match(rules, /customerSlipNotRejected\(\)/);
  assert.match(rules, /buysGoods\(\)[\s\S]{0,180}customerPaidAt/);
});
