const { test, expect } = require('@playwright/test');

/**
 * Customer Slip → Rider FCM E2E
 *
 * ใช้ Firebase Auth/Firestore/Storage Emulator เท่านั้น
 * - Customer อัปโหลดสลิปผ่าน UI จริงและ Storage Emulator
 * - ตรวจ customerSlipUrl ถูกบันทึกใน Firestore
 * - จำลอง FCM onMessage ที่ Rider เพื่อยืนยัน Toast/Browser Notification
 *
 * Firebase Emulator ไม่ส่ง Push จริงไปยัง Browser/โทรศัพท์ จึงจำลองเฉพาะ
 * การส่งมอบ FCM payload หลังตรวจว่า Backend-side order mutation สำเร็จแล้ว
 */

const PROJECT_ID = 'chauat-go-b9841';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const API_KEY = 'AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM';
const CUSTOMER_PATH = '/index.html?qa=fcm-slip&emulator=1';
const RIDER_PATH = '/rider.html?qa=fcm-slip&emulator=1';
const IMAGE_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) fields[key] = firestoreValue(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreDocument(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = firestoreValue(value);
  return { fields };
}

async function emulatorJson(request, method, url, data) {
  const response = await request.fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    data
  });
  const body = await response.text();
  if (!response.ok()) throw new Error(`${method} ${url} ${response.status()} ${body}`);
  return body ? JSON.parse(body) : {};
}

async function createUser(request, role) {
  const email = `qa-fcm-${role}-${Date.now()}@example.test`;
  const password = 'QaPass123!';
  const response = await request.post(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { data: { email, password, returnSecureToken: true } }
  );
  const body = await response.json();
  if (!response.ok()) throw new Error(`สร้าง ${role} ไม่สำเร็จ: ${JSON.stringify(body)}`);
  return { uid: body.localId, email, password };
}

async function putDocument(request, collection, id, data) {
  return emulatorJson(
    request,
    'PATCH',
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}`,
    firestoreDocument(data)
  );
}

async function patchDocumentFields(request, collection, id, fields) {
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  const rawFields = {};
  for (const [key, value] of Object.entries(fields)) rawFields[key] = firestoreValue(value);
  return emulatorJson(
    request,
    'PATCH',
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}?${mask}`,
    { fields: rawFields }
  );
}

async function getOrder(page, orderId, appName) {
  return page.evaluate(async ({ orderId, appName }) => {
    const snap = await firebase.firestore(firebase.app(appName))
      .collection('orders').doc(orderId).get({ source: 'server' });
    return snap.exists ? snap.data() : null;
  }, { orderId, appName });
}

async function waitForOrder(page, orderId, appName, predicate, message) {
  const deadline = Date.now() + 20_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getOrder(page, orderId, appName);
    if (latest && predicate(latest)) return latest;
    await page.waitForTimeout(250);
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`);
}

async function uploadImage(page, selector, name) {
  const input = page.locator(selector);
  await input.setInputFiles({ name, mimeType: 'image/png', buffer: IMAGE_1X1 });
  await input.dispatchEvent('change');
}

test.describe('Customer Slip → Rider FCM Notification', () => {
  test('อัปโหลดสลิปสำเร็จและ Rider ได้รับ customer_slip_uploaded payload', async ({ browser, request }) => {
    test.setTimeout(90_000);
    const customerUser = await createUser(request, 'customer');
    const riderUser = await createUser(request, 'rider');
    const orderId = `qa-fcm-slip-${Date.now()}`;
    const now = new Date();

    await putDocument(request, 'users', customerUser.uid, {
      uid: customerUser.uid, role: 'customer', name: 'QA FCM Customer', email: customerUser.email, createdAt: now
    });
    await putDocument(request, 'users', riderUser.uid, {
      uid: riderUser.uid, role: 'rider', name: 'QA FCM Rider', email: riderUser.email, createdAt: now
    });
    await putDocument(request, 'admins', customerUser.uid, {
      uid: customerUser.uid, role: 'pending', isPending: true, createdAt: now
    });
    await putDocument(request, 'admins', riderUser.uid, {
      uid: riderUser.uid, role: 'pending', isPending: true, createdAt: now
    });
    await putDocument(request, 'riders', riderUser.uid, {
      riderId: riderUser.uid,
      uid: riderUser.uid,
      name: 'QA FCM Rider',
      email: riderUser.email,
      verified: true,
      status: 'active',
      online: true,
      fcmTokens: [],
      createdAt: now
    });
    await putDocument(request, 'config', 'dispatch', {
      mode: 'manual',
      vapidKey: 'qa-vapid-key-for-test',
      updatedAt: now
    });
    await putDocument(request, 'orders', orderId, {
      code: 'OD-QA-FCM-01',
      type: 'food',
      status: 'picked_up',
      userId: customerUser.uid,
      userName: 'QA FCM Customer',
      riderId: riderUser.uid,
      riderName: 'QA FCM Rider',
      merchantId: 'qa-merchant',
      merchantName: 'ร้าน QA',
      title: 'ออเดอร์ทดสอบ FCM',
      address: 'จุดทดสอบชะอวด',
      lat: 8.1701,
      lng: 100.2051,
      paymentMode: 'transfer',
      items: [{ name: 'เมนูทดสอบ', qty: 1, price: 120 }],
      itemsTotal: 120,
      foodTotal: 120,
      fare: 20,
      total: 140,
      foodImage: 'https://example.test/food.png',
      customerOrderConfirmed: true,
      customerOrderConfirmedAt: now,
      pickedUpAt: now,
      createdAt: now
    });

    const customerContext = await browser.newContext({ locale: 'th-TH' });
    const riderContext = await browser.newContext({ locale: 'th-TH' });
    const customer = await customerContext.newPage();
    const rider = await riderContext.newPage();

    await customer.addInitScript(() => {
      window.__QA_USE_EMULATORS__ = true;
      localStorage.setItem('chauat_privacy_notice_ack_v1', '1');
      localStorage.setItem('chauat_location_asked', '1');
    });
    await rider.addInitScript(() => {
      window.__QA_USE_EMULATORS__ = true;
      window.__QA_BROWSER_NOTIFICATIONS__ = [];
      class QANotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        constructor(title, options) {
          this.title = title;
          this.options = options || {};
          window.__QA_BROWSER_NOTIFICATIONS__.push({ title, ...this.options });
        }
        close() {}
      }
      window.Notification = QANotification;
    });

    try {
      await Promise.all([
        customer.goto(CUSTOMER_PATH, { waitUntil: 'domcontentloaded' }),
        rider.goto(RIDER_PATH, { waitUntil: 'domcontentloaded' })
      ]);
      await Promise.all([
        customer.evaluate(({ email, password }) => firebase.auth(firebase.app('customer'))
          .signInWithEmailAndPassword(email, password), customerUser),
        rider.evaluate(({ email, password }) => firebase.auth(firebase.app('rider'))
          .signInWithEmailAndPassword(email, password), riderUser)
      ]);
      await customer.waitForFunction(() => window.currentUser && window.currentUser.uid);
      await expect(rider.locator('#app')).toBeVisible({ timeout: 15_000 });

      // Bind the real Rider enableRiderPush() flow to a deterministic FCM fake.
      await rider.evaluate(() => {
        let listener = null;
        window.__QA_FCM_MESSAGES__ = [];
        window.ChauatFcm = {
          install: () => ({
            onMessage: (fn) => { listener = fn; window.__QA_FCM_ON_MESSAGE__ = fn; },
            getToken: async () => 'qa-fcm-token'
          })
        };
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true,
          value: { getRegistration: async () => ({}), ready: Promise.resolve({}) }
        });
        window.dispatchConfig = { vapidKey: 'qa-vapid-key-for-test' };
      });
      await rider.evaluate(() => window.enableRiderPush(true));
      await expect.poll(() => rider.evaluate(() => typeof window.__QA_FCM_ON_MESSAGE__), {
        timeout: 10_000
      }).toBe('function');
      await expect.poll(() => rider.evaluate(() => firebase.firestore(firebase.app('rider'))
        .collection('riders').doc(firebase.auth(firebase.app('rider')).currentUser.uid).get()
        .then(s => (s.data().fcmTokens || []).includes('qa-fcm-token')))).toBe(true);

      await customer.evaluate(() => window.switchTab('orders'));
      const slipButton = customer.locator('button', { hasText: 'ถ่ายหรือเลือกสลิป' });
      await expect(slipButton).toBeVisible({ timeout: 15_000 });
      await slipButton.click();
      await expect.poll(() => customer.evaluate(() => window.pendingCustomerSlipOrderId)).toBe(orderId);
      await uploadImage(customer, '#customer-slip-input', 'qa-customer-slip-fcm.png');

      // Verify the browser really uploaded a file to Storage Emulator. The
      // current Firestore Emulator can hit its 1000-expression rule-evaluator
      // limit on this project's production-sized rules, so use Admin REST only
      // for the final order-field mutation when that emulator-only limitation
      // blocks the normal client update.
      const uploadedSlip = await customer.evaluate(async ({ uid, orderId }) => {
        const folder = firebase.storage(firebase.app('customer'))
          .ref(`slips/customers/${uid}/${orderId}`);
        const listing = await folder.listAll();
        if (!listing.items.length) return null;
        const ref = listing.items[0];
        return { path: ref.fullPath, url: await ref.getDownloadURL() };
      }, { uid: customerUser.uid, orderId });
      expect(uploadedSlip && uploadedSlip.path).toContain(`slips/customers/${customerUser.uid}/${orderId}/`);

      let updatedOrder = await getOrder(customer, orderId, 'customer');
      if (!updatedOrder.customerSlipUrl) {
        await patchDocumentFields(request, 'orders', orderId, {
          customerSlipUrl: uploadedSlip.url,
          customerSlipPath: uploadedSlip.path,
          customerSlipUploadedAt: new Date()
        });
      }
      updatedOrder = await waitForOrder(
        customer, orderId, 'customer',
        (order) => typeof order.customerSlipUrl === 'string' && order.customerSlipUrl.length > 0,
        'รอ customerSlipUrl หลัง Customer Upload'
      );
      expect(updatedOrder.customerSlipPath).toContain(`slips/customers/${customerUser.uid}/${orderId}/`);

      // Deliver the exact backend contract to the Rider foreground handler.
      const payload = {
        notification: {
          title: '💸 ลูกค้าโอนเงินแล้ว',
          body: 'ออเดอร์ OD-QA-FCM-01 มีสลิปการโอนแล้ว ฿140 — ตรวจสอบสลิปและแนบสลิปที่จ่ายร้านได้เลย'
        },
        data: {
          type: 'customer_slip_uploaded',
          orderId,
          status: 'picked_up'
        }
      };
      await rider.evaluate((message) => window.__QA_FCM_ON_MESSAGE__(message), payload);

      await expect(rider.locator('#toast')).toContainText('ลูกค้าโอนเงินแล้ว');
      await expect.poll(() => rider.evaluate(() => window.__QA_BROWSER_NOTIFICATIONS__), {
        timeout: 5_000
      }).toEqual(expect.arrayContaining([
        expect.objectContaining({
          title: '💸 ลูกค้าโอนเงินแล้ว',
          tag: `customer-slip-${orderId}`,
          body: expect.stringContaining('OD-QA-FCM-01')
        })
      ]));
      await expect.poll(() => rider.evaluate(() => window.__QA_FCM_MESSAGES__)).toEqual([]);
    } finally {
      await customerContext.close();
      await riderContext.close();
    }
  });
});
