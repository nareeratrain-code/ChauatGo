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

test('cash and transfer goods photos both post the ready amount', () => {
  const start = rider.indexOf('function goodsReadyChatText');
  const end = rider.indexOf('async function postGoodsReadyChat');
  const context = {
    foodPayParts: (order) => ({ total: Number(order.total) || 0 }),
    shownTransferDue: (order) => Number(order.total) || 0
  };
  vm.runInNewContext(rider.slice(start, end), context);
  const cash = context.goodsReadyChatText({ paymentMode: 'cash', type: 'shopping', total: 31 });
  assert.match(cash, /อาหาร\/สินค้าพร้อมแล้ว/);
  assert.match(cash, /เงินสด ฿31/);
  assert.equal(cash.includes('โอนยอด'), false);
  const transfer = context.goodsReadyChatText({ paymentMode: 'transfer', type: 'food', total: 140 });
  assert.match(transfer, /กรุณาโอนยอด ฿140 \(รวมค่าบริการ\)/);
  assert.match(rider, /await postGoodsReadyChat\(jobId, pickedJob \|\| pickupJob\)/);
  assert.match(rider, /automationKey: 'goods_ready'/);
});

test('cash buy-for-me can attach the shop slip after the photo, transfer still needs payment', () => {
  assert.match(rules, /resource\.data\.get\('paymentMode', ''\) == 'cash'/);
  assert.match(rules, /buysGoods\(\) && resource\.data\.status == 'picked_up' && resource\.data\.get\('foodImage', ''\) == ''/);
  assert.match(rider, /ไม่ต้องโอนหรือแนบสลิปก่อน/);
});
