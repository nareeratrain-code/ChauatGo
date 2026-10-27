const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const source = fs.readFileSync('rider.js', 'utf8');

test('อาหารอัปโหลดครั้งเดียวที่ orders และนำ URL เดิมไปแสดงในแชท', () => {
  const start = source.indexOf('async function submitFoodPhoto');
  const end = source.indexOf('\n}\n\nasync function submitShopSlip', start) + 2;
  const block = source.slice(start, end);

  assert.match(block, /const foodPath = `orders\/\$\{jobId\}\/food_/);
  assert.match(block, /await foodRef\.put\(pickupFoodBlob, \{ contentType: 'image\/jpeg' \}\)/);
  assert.match(block, /await postRiderOrderImageUrl\(jobId, pickupFoodUrl, foodPath\)/);
  assert.doesNotMatch(block, /await postRiderOrderImage\(jobId, pickupFoodBlob\)/);
  assert.match(source, /async function postRiderOrderImageUrl\(orderId, url, imagePath\)/);
});

test('หากสร้างข้อความรูปในแชทไม่สำเร็จ ออเดอร์ยังเดินหน้าด้วยรูปหลักที่อัปโหลดแล้ว', () => {
  const start = source.indexOf('await postRiderOrderImageUrl');
  const block = source.slice(start, start + 420);
  assert.match(block, /catch \(chatErr\)/);
  assert.match(block, /food photo chat message failed/);
  assert.match(block, /await db\.collection\('orders'\)\.doc\(jobId\)\.update/);
});
