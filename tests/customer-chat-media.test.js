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

  assert.match(block, /var img = m\.imageUrl \?/);
  assert.match(block, /src="' \+ esc\(m\.imageUrl\)/);
  assert.match(block, /openLightbox/);
  assert.match(block, /esc\(m\.imageUrl\)/);
  assert.match(block, /m\.text \?/);
});

test('Food photo chat ใช้ URL เดิมจาก orders และ QR ใช้ QR URL ของไรเดอร์', () => {
  assert.match(riderSource, /postRiderOrderImageUrl\(jobId, pickupFoodUrl, foodPath\)/);
  assert.match(riderSource, /imageUrl: riderProfile\.qrCodeUrl/);
  assert.match(riderSource, /automationKey: key/);
});

test('Firestore Rules อนุญาตลูกค้าอ่าน Messages ของออเดอร์และรองรับ media fields', () => {
  assert.match(rulesSource, /match \/messages\/\{messageId\}/);
  assert.match(rulesSource, /allow read: if isOrderParty\(chatId\)/);
  assert.match(rulesSource, /'imageUrl', 'imagePath'/);
  assert.match(rulesSource, /messageFrom\(chatId, 'rider', 'riderId'\)/);
});

test('Storage Rules อนุญาตลูกค้าอ่านรูปอาหารจาก orders และ QR ใช้ download URL ที่ส่งในข้อความ', () => {
  assert.match(fs.readFileSync('storage.rules', 'utf8'), /match \/orders\/\{orderId\}\/\{fileName\}/);
  assert.match(fs.readFileSync('storage.rules', 'utf8'), /allow read: if signedIn\(\) && \(isAdmin\(\) \|\| orderParty\(orderId\)\)/);
  assert.match(riderSource, /qrCodeUrl/);
});
