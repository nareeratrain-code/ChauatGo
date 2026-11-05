const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const rider = fs.readFileSync('rider.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

test('opening the customer chat does not wipe the goods-photo draft', () => {
  const openChat = rider.slice(rider.indexOf('async function openChatWithCustomer'), rider.indexOf('async function openChatRoom'));
  assert.match(openChat, /closeModal\(\{ keepPickup: true \}\)/);
  const closeModal = rider.slice(rider.indexOf('function closeModal'), rider.indexOf('function handleRiderQrFile'));
  assert.match(closeModal, /if \(opts && opts\.keepPickup\) return/);
  assert.match(closeModal, /pickupOrderId = null/);
});

test('cash and transfer food photos both use the single payment message', () => {
  const start = rider.indexOf('function foodPhotoMessage');
  const end = rider.indexOf('function autoChatText', start);
  const context = {
    foodPayParts: (order) => ({
      food: Number(order.foodTotal) || 0,
      fare: Number(order.fare) || 0,
      tip: 0,
      cash: order.paymentMode === 'cash',
      total: Number(order.foodTotal || 0) + Number(order.fare || 0)
    }),
    foodPayEquation: (parts) => `ค่าอาหาร ฿${parts.food} + ค่าส่ง ฿${parts.fare} = รวม ฿${parts.total}`,
    bahtText: (n) => '฿' + n
  };
  vm.runInNewContext(rider.slice(start, end), context);
  const cash = context.foodPhotoMessage({ paymentMode: 'cash', type: 'food', foodTotal: 31, fare: 0 });
  assert.match(cash, /ไรเดอร์ถ่ายรูปอาหารจากร้านแล้ว/);
  assert.match(cash, /กรุณาเตรียมเงินสดจ่ายไรเดอร์/);
  assert.equal(cash.includes('โอนยอด'), false);
  const transfer = context.foodPhotoMessage({ paymentMode: 'transfer', type: 'food', foodTotal: 140, fare: 0 });
  assert.match(transfer, /กรุณาโอนเงินให้ไรเดอร์ตามยอดนี้/);
  assert.match(rider, /await postFoodPaymentChat\(jobId, pickupFoodUrl/);
  assert.match(rider, /automationKey: 'food_payment'/);
});

test('cash buy-for-me can attach the shop slip after the photo, transfer still needs payment', () => {
  assert.match(rules, /resource\.data\.get\('paymentMode', ''\) == 'cash'/);
  assert.match(rules, /buysGoods\(\) && resource\.data\.status == 'picked_up' && resource\.data\.get\('foodImage', ''\) == ''/);
  assert.match(rider, /ไม่ต้องโอนหรือแนบสลิปก่อน/);
});
