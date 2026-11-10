const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const customerSource = fs.readFileSync('index.html', 'utf8');
const riderSource = fs.readFileSync('rider.js', 'utf8');
const rulesSource = fs.readFileSync('firestore.rules', 'utf8');

test('Customer Chat แสดง imageUrl จากข้อความทั้งรูปอาหารและ QR', () => {
  const start = customerSource.indexOf('function subscribeChatMessages');
  const end = customerSource.indexOf('\n}\n\nfunction scrollChatToBottom', start) + 2;
  const block = customerSource.slice(start, end);

  assert.match(block, /Array\.isArray\(m\.imageUrls\)/);
  assert.match(block, /media\.map/);
  assert.match(block, /src="' \+ esc\(url\)/);
  assert.match(block, /openLightbox/);
  assert.match(block, /esc\(url\)/);
  assert.match(block, /m\.text \?/);
});

test('Food photo chat ใช้ URL เดิมจาก orders และ QR ใช้ QR URL ของไรเดอร์', () => {
  assert.match(riderSource, /postFoodPaymentChat\(jobId, pickupFoodUrl/);
  assert.match(riderSource, /imageUrls/);
  assert.match(riderSource, /qrImageUrl: ''/);
  assert.match(riderSource, /automationKey: 'food_payment'/);
});

test('Firestore Rules อนุญาตลูกค้าอ่าน Messages ของออเดอร์และรองรับ media fields', () => {
  assert.match(rulesSource, /match \/messages\/\{messageId\}/);
  assert.match(rulesSource, /isOrderParty\(chatId\)/);
  assert.match(rulesSource, /'imageUrl'/);
  assert.match(rulesSource, /'imagePath'/);
  assert.match(rulesSource, /'foodImageUrl', 'qrImageUrl'/);
  assert.match(rulesSource, /messageFrom\(chatId, 'rider', 'riderId'\)/);
});

test('Storage Rules อนุญาตลูกค้าอ่านรูปอาหารจาก orders และ QR ใช้ download URL ที่ส่งในข้อความ', () => {
  assert.match(fs.readFileSync('storage.rules', 'utf8'), /match \/orders\/\{orderId\}\/\{fileName\}/);
  assert.match(fs.readFileSync('storage.rules', 'utf8'), /allow read: if signedIn\(\) && \(isAdmin\(\) \|\| orderParty\(orderId\)\)/);
  assert.match(riderSource, /qrCodeUrl/);
});
