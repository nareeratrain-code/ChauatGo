const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const rider = fs.readFileSync('rider.js', 'utf8');
const customer = fs.readFileSync('index.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

function loadFoodPhotoMessage() {
  const start = rider.indexOf('function foodPayEquation');
  const end = rider.indexOf('function autoChatText', start);
  const context = {
    foodPayParts: (order) => ({
      food: Number(order.foodTotal || order.itemsTotal) || 0,
      fare: Number(order.fare) || 0,
      tip: order.paymentMode === 'cash' ? Number(order.cashTip || 5) : 0,
      cash: order.paymentMode === 'cash',
      total: (Number(order.foodTotal || order.itemsTotal) || 0) + (Number(order.fare) || 0) + (order.paymentMode === 'cash' ? Number(order.cashTip || 5) : 0)
    }),
    bahtText: (n) => '฿' + n
  };
  vm.runInNewContext(rider.slice(start, end), context);
  return context.foodPhotoMessage;
}

test('Cash Shopping Flow: ลูกค้าเลือกเงินสดตั้งแต่ก่อนโพสต์', () => {
  assert.match(customer, /id="shop-pay-cash"/);
  assert.match(customer, /paymentMode: selectedPaymentMode === 'cash' \? 'cash' : 'transfer'/);
  assert.match(customer, /จ่ายตอนรับของ/);
});

test('Shopping quote Rule allows foodTotal/itemsTotal rider adjustment but freezes other money fields', () => {
  assert.match(rules, /function goodsQuoteMoneyFrozen\(\)/);
  assert.match(rules, /function riderGoodsQuoteOk\(\) \{\s*return goodsQuoteMoneyFrozen\(\)/);
  const quoteRule = rules.slice(rules.indexOf('function goodsQuoteMoneyFrozen'), rules.indexOf('function identityFrozen'));
  assert.doesNotMatch(quoteRule, /'foodTotal'/);
  assert.doesNotMatch(quoteRule, /'itemsTotal'/);
  assert.match(quoteRule, /'fare'/);
  assert.match(quoteRule, /'chargedTotal'/);
});

test('Cash Shopping Flow: ไรเดอร์ส่งรูปสินค้าและราคาจริงก่อนบิล', () => {
  assert.match(rider, /id="pickup-goods-total"/);
  assert.match(rider, /photoPatch\.foodTotal = Math\.round\(shoppingPrice \* 100\) \/ 100/);
  assert.match(rider, /ส่งรูปสินค้าและราคาให้ลูกค้า/);
  assert.match(rider, /ระบบจะแจ้งยอดเงินสดที่ต้องชำระตอนรับสินค้า/);

  const message = loadFoodPhotoMessage()({
    type: 'shopping', paymentMode: 'cash', foodTotal: 125, fare: 32, cashTip: 5
  });
  assert.match(message, /เตรียมเงินสดจ่ายไรเดอร์ตอนรับสินค้า\/ของใช้/);
  assert.match(message, /ค่าสินค้า ฿125/);
  assert.match(message, /รวม ฿162/);
  assert.doesNotMatch(message, /QR/);
});

test('Cash Shopping Flow: ลูกค้ายืนยันรับสินค้าและชำระเงินสดโดยไม่ต้องแนบสลิป', () => {
  assert.match(customer, /รับสินค้าและชำระเงินสด/);
  assert.match(customer, /ได้รับสินค้าและชำระเงินสดให้ไรเดอร์แล้ว/);
  assert.match(customer, /if \(!cashPayment && cached && !cached\.customerSlipUrl\)/);
  assert.match(rules, /resource\.data\.get\('paymentMode', ''\) == 'cash' \|\| customerSlipNotRejected\(\)/);
});

test('Cash Shopping Flow: ไรเดอร์เห็นคำเตือนสำรองจ่ายและทิปก่อนรับงาน', () => {
  assert.match(rider, /paymentMode: data\.paymentMode \|\| 'transfer'/);
  assert.match(rider, /งานนี้ชำระเงินสด/);
  assert.match(rider, /ไรเดอร์ต้องสำรองค่าสินค้าให้ร้านก่อน/);
  assert.match(rider, /มีทิปให้ไรเดอร์/);
});

test('Cash Shopping Flow: ใช้บิลร้านแทนสลิปโอนและแสดงสถานะออกจากร้าน', () => {
  assert.match(rider, /if \(order\.type === 'shopping' && order\.paymentMode === 'cash'\) return !!\(order\.shopBillUrl \|\| orderHasShopSlip\(order\)\)/);
  assert.match(rider, /กำลังเริ่มออกเดินทางจากร้านไปบ้านลูกค้า/);
  assert.match(rider, /บันทึกรูปและบิลร้านแล้ว — ไรเดอร์สำรองจ่าย/);
  assert.match(rider, /fin\.isCash && fin\.tip > 0/);
});
