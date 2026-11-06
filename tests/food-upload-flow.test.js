const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const source = fs.readFileSync('rider.js', 'utf8');

test('อาหารอัปโหลดครั้งเดียวที่ orders และนำ URL เดิมไปแสดงในแชท', () => {
  const start = source.indexOf('async function submitFoodPhoto');
  const end = source.indexOf('\n}\n\nasync function submitShopSlip', start) + 2;
  const block = source.slice(start, end);

  assert.match(block, /const foodPath = `chats\/\$\{jobId\}\/riders\/\$\{currentUser\.uid\}\/food_/);
  assert.equal((source.match(/chats\/\$\{jobId\}\/riders\/\$\{currentUser\.uid\}\/food_/g) || []).length, 2);
  assert.match(source, /chats\/\$\{orderId\}\/riders\/\$\{currentUser\.uid\}/);
  assert.match(block, /await foodRef\.put\(pickupFoodBlob, \{ contentType: 'image\/jpeg' \}\)/);
  assert.match(block, /await postFoodPaymentChat\(jobId, pickupFoodUrl/);
  assert.doesNotMatch(block, /await postRiderOrderImage\(jobId, pickupFoodBlob\)/);
  assert.match(source, /async function postRiderOrderImageUrl\(orderId, url, imagePath, note = ''\)/);
});

test('สลิปที่ไรเดอร์โอนจ่ายร้านมี Note กำกับในข้อความ Chat', () => {
  assert.match(source, /\.\.\.\(note \? \{ text: note \} : \{\}\)/);
  assert.match(source, /🧾 สลิปโอนจ่ายร้านค้า — ไรเดอร์ชำระค่าสินค้าให้ร้านค้าแล้วครับ\/ค่ะ/);
  assert.match(source, /lastMessage: note \|\| '📷 รูปภาพ'/);
});

test('หากสร้างข้อความรูปในแชทไม่สำเร็จ ออเดอร์ยังเดินหน้าด้วยรูปหลักที่อัปโหลดแล้ว', () => {
  const start = source.indexOf('await postFoodPaymentChat');
  const block = source.slice(start, start + 900);
  assert.match(block, /catch \(readyErr\)/);
  assert.match(block, /food payment chat/);
  assert.match(source, /await db\.collection\('orders'\)\.doc\(jobId\)\.update/);
});

test('Shopping photo guide: มีช่องราคาสินค้าและส่งรูปได้ก่อนแนบบิลร้าน', () => {
  const start = source.indexOf('function openPayGuide');
  const end = source.indexOf('\nfunction openShopSlip', start);
  const block = source.slice(start, end);
  assert.match(block, /job\.type === 'shopping'/);
  assert.match(block, /id="pickup-goods-total"/);
  assert.match(block, /pickupBillBlob = null/);
  assert.match(source, /job && job\.type === 'shopping' && !\(Number\(\$\('pickup-goods-total'\)\?\.value\) > 0\)/);
});

test('ถึงร้านแล้วต้องคงแผงถ่ายรูปและกรอกราคาไว้ในแชท แม้สถานะยังเป็น accepted', () => {
  assert.match(source, /let pickupGuideOrderIds = new Set\(\)/);
  assert.match(source, /pickupGuideOrderIds\.add\(jobId\)/);
  assert.match(source, /const pickupArrived = pickupGuideOrderIds\.has\(job\.id\) \|\| job\.pickupArrived === true/);
  assert.match(source, /pickupArrived \|\| \['picked_up', 'customer_paid'\]\.includes\(job\.status\)/);
});

test('GPS ถึงร้านของงานฝากซื้อเปิดขั้นตอนถ่ายรูปและกรอกราคาอัตโนมัติ', () => {
  assert.match(source, /if \(orderBuysGoods\(job\) && job\.type === 'shopping'\)/);
  assert.match(source, /openPayGuide\(job\.id, 'food'\)/);
});

test('เปิดแชทหลังข้อความถึงร้านต้องมีปุ่มกล้อง คลังภาพ และช่องราคาสินค้า', () => {
  assert.match(source, /if \(goods && pickupArrived && !job\.foodImage\)/);
  assert.match(source, /id="pickup-food-camera"/);
  assert.match(source, /id="pickup-food-gallery"/);
  assert.match(source, /id="pickup-goods-total"/);
  assert.match(source, /key === 'shop_arrived'/);
});
