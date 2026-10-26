const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const riderSource = fs.readFileSync('rider.js', 'utf8');

function createDbCapture() {
  const messages = [];
  const updates = [];
  const messageRef = {
    async get() { return { exists: false }; },
    async set(value) { messages.push(value); }
  };
  const chatRef = {
    collection(name) {
      assert.equal(name, 'messages');
      return { doc() { return messageRef; } };
    },
    async update(value) { updates.push(value); }
  };
  return {
    messages,
    updates,
    db: {
      collection(name) {
        assert.equal(name, 'chats');
        return { doc(id) {
          assert.equal(id, 'OD-QR-001');
          return chatRef;
        } };
      }
    }
  };
}

function loadQrFunctions() {
  const start = riderSource.indexOf('function riderQrPaymentText');
  const end = riderSource.indexOf('function sendAutomatedChatLater', start);
  assert.ok(start > 0 && end > start, 'QR functions must exist in rider.js');

  const capture = createDbCapture();
  const order = {
    id: 'OD-QR-001',
    type: 'food',
    paymentMode: 'transfer',
    foodTotal: 105,
    fare: 20,
    items: [{ name: 'ข้าว', qty: 1, price: 105 }]
  };
  const context = {
    console,
    currentUser: { uid: 'rider-001' },
    riderProfile: {
      name: 'ไรเดอร์ทดสอบ',
      qrCodeUrl: 'https://firebasestorage.googleapis.com/test-rider-qr.png',
      qrCodePath: 'rider_qr/rider-001/payment-qr.jpg'
    },
    autoChatSent: new Set(),
    db: capture.db,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } } },
    orderForAutoChat: async () => order,
    orderServiceType: (value) => value.type,
    foodPayParts: () => ({ food: 105, fare: 20, tip: 0, total: 125 }),
    foodPayEquation: () => 'ค่าอาหาร ฿105 + ค่าส่ง ฿20 = รวม ฿125',
    ensureRiderChat: async () => ({ riderName: 'ไรเดอร์ทดสอบ' }),
    ...capture
  };
  vm.runInNewContext(riderSource.slice(start, end), context);
  return { context, capture };
}

test('ถึงร้านส่งข้อความเตรียมโอนพร้อม QR ให้ลูกค้า', async () => {
  const { context, capture } = loadQrFunctions();
  await context.sendRiderQrPaymentChat('OD-QR-001', 'shop_arrived');

  assert.equal(capture.messages.length, 1);
  assert.match(capture.messages[0].text, /ไรเดอร์ถึงร้านแล้ว/);
  assert.match(capture.messages[0].text, /QR/);
  assert.equal(capture.messages[0].imageUrl, context.riderProfile.qrCodeUrl);
  assert.equal(capture.messages[0].imagePath, context.riderProfile.qrCodePath);
  assert.equal(capture.messages[0].automationKey, 'shop_arrived_qr');
  assert.equal(capture.updates.length, 1);
});

test('ส่งรูปอาหารส่งยอดโอนจริงพร้อม QR ให้ลูกค้า', async () => {
  const { context, capture } = loadQrFunctions();
  await context.sendRiderQrPaymentChat('OD-QR-001', 'food_payment');

  assert.equal(capture.messages.length, 1);
  assert.match(capture.messages[0].text, /ส่งรูปอาหารจากร้านแล้ว/);
  assert.match(capture.messages[0].text, /ค่าอาหาร ฿105 \+ ค่าส่ง ฿20 = รวม ฿125/);
  assert.equal(capture.messages[0].imageUrl, context.riderProfile.qrCodeUrl);
  assert.equal(capture.messages[0].automationKey, 'food_payment_qr');
});

test('ไม่ส่ง QR กับออเดอร์เงินสดหรือบริการอื่น', async () => {
  const { context, capture } = loadQrFunctions();
  context.orderForAutoChat = async () => ({ type: 'food', paymentMode: 'cash' });
  await context.sendRiderQrPaymentChat('OD-QR-001', 'food_payment');
  assert.equal(capture.messages.length, 0);

  context.orderForAutoChat = async () => ({ type: 'shopping', paymentMode: 'transfer' });
  await context.sendRiderQrPaymentChat('OD-QR-001', 'food_payment');
  assert.equal(capture.messages.length, 0);
});

test('เหตุการณ์ถึงร้านและส่งรูปอาหารมีจุดเรียก QR Chat ครบ', () => {
  assert.match(riderSource.slice(riderSource.indexOf('async function arrivedAtShop'), riderSource.indexOf('function openShopSlip')), /sendRiderQrPaymentChat\(jobId, 'shop_arrived'\)/);
  const photoStart = riderSource.indexOf('async function submitFoodPhoto');
  const slipStart = riderSource.indexOf('async function submitShopSlip');
  const photoBlock = riderSource.slice(photoStart, slipStart);
  assert.match(photoBlock, /sendRiderQrPaymentChat\(jobId, 'food_payment'\)/);
});

test('QR Upload ใช้ PNG และ versioned path เพื่อไม่เปลี่ยน QR เก่าในแชท', () => {
  assert.match(riderSource, /function compressQrImage\(file, maxWidth = 1600\)/);
  assert.match(riderSource, /payment-qr-\$\{Date\.now\(\)\}\.png/);
  assert.match(riderSource, /contentType: 'image\/png'/);
  assert.match(riderSource, /if \(oldPath && oldPath !== newPath\) await storage\.ref\(oldPath\)\.delete/);
  assert.match(riderSource, /if \(newPath\) await storage\.ref\(newPath\)\.delete/);
});
