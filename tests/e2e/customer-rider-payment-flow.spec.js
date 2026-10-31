const { test, expect } = require('@playwright/test');

/**
 * Cross-role E2E สำหรับ Firebase Emulator เท่านั้น
 *
 * ลำดับที่ทดสอบ:
 * Customer/Rider login → Rider รับงาน → Customer ยืนยันรายการ
 * → Rider ถ่ายรูปอาหาร → Customer แนบสลิปและยืนยันโอน
 * → Rider แนบสลิปร้าน → เริ่มส่ง
 *
 * ห้ามใช้กับ Production เพราะไฟล์นี้สร้างบัญชีและข้อมูลทดสอบ
 */

const PROJECT_ID = 'chauat-go-b9841';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const API_KEY = 'AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM';
const CUSTOMER_PATH = '/index.html?qa=cross-role&emulator=1';
const RIDER_PATH = '/rider.html?qa=cross-role&emulator=1';

const IMAGE_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
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

async function createEmulatorUser(request, role, sequence) {
  const email = `qa-${role}-${Date.now()}-${sequence}@example.test`;
  const password = 'QaPass123!';
  const response = await request.post(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { data: { email, password, returnSecureToken: true } }
  );
  const body = await response.json();
  if (!response.ok()) throw new Error(`สร้าง ${role} user ไม่สำเร็จ: ${JSON.stringify(body)}`);
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

async function getOrderFromPage(page, orderId, appName) {
  return page.evaluate(async ({ orderId, appName }) => {
    const app = firebase.app(appName);
    const snap = await firebase.firestore(app).collection('orders').doc(orderId).get({ source: 'server' });
    return snap.exists ? snap.data() : null;
  }, { orderId, appName });
}

async function signInCustomer(page, user) {
  await page.evaluate(async ({ email, password }) => {
    await firebase.auth(firebase.app('customer')).signInWithEmailAndPassword(email, password);
  }, user);
  await page.waitForFunction(() => window.currentUser && window.currentUser.uid);
  await page.evaluate(() => window.switchTab('orders'));
  await expect(page.locator('#tab-orders')).toBeVisible();
}

async function signInRider(page, user) {
  await page.evaluate(async ({ email, password }) => {
    await firebase.auth(firebase.app('rider')).signInWithEmailAndPassword(email, password);
  }, user);
  await expect(page.locator('#app')).toBeVisible({ timeout: 15_000 });
}

async function waitForOrderState(page, orderId, appName, predicate, message) {
  const deadline = Date.now() + 15_000;
  let lastOrder = null;
  while (Date.now() < deadline) {
    lastOrder = await getOrderFromPage(page, orderId, appName);
    if (lastOrder && predicate(lastOrder)) return lastOrder;
    await page.waitForTimeout(250);
  }
  throw new Error(`${message} (ล่าสุด: ${JSON.stringify(lastOrder)})`);
}

async function uploadImage(page, selector, name) {
  const input = page.locator(selector);
  await input.setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: IMAGE_1X1
  });
  // Playwright normally emits input/change for setInputFiles. Dispatching
  // change explicitly also reproduces mobile camera/gallery implementations
  // that update the FileList without firing the inline handler consistently.
  await input.dispatchEvent('change');
}

test.describe('Customer ↔ Rider Payment Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('รับงาน → ยืนยันรายการ → รูปอาหาร → สลิปลูกค้า → สลิปร้าน → เริ่มส่ง', async ({ browser, request }) => {
    test.setTimeout(90_000);
    const customerUser = await createEmulatorUser(request, 'customer', 'customer');
    const riderUser = await createEmulatorUser(request, 'rider', 'rider');
    const orderId = `qa-cross-role-${Date.now()}`;
    const now = new Date();

    await putDocument(request, 'users', customerUser.uid, {
      uid: customerUser.uid,
      role: 'customer',
      name: 'QA Customer',
      email: customerUser.email,
      createdAt: now
    });
    await putDocument(request, 'users', riderUser.uid, {
      uid: riderUser.uid,
      role: 'rider',
      name: 'QA Rider',
      email: riderUser.email,
      createdAt: now
    });
    // Keep an admins/{uid} document present so Rules checks do not emit
    // NOT_FOUND noise. `pending` is intentional: active/super would grant
    // admin privileges through isBossActive().
    await putDocument(request, 'admins', customerUser.uid, {
      uid: customerUser.uid,
      email: customerUser.email,
      displayName: 'QA Customer',
      role: 'pending',
      isPending: true,
      createdAt: now
    });
    await putDocument(request, 'admins', riderUser.uid, {
      uid: riderUser.uid,
      email: riderUser.email,
      displayName: 'QA Rider',
      role: 'pending',
      isPending: true,
      createdAt: now
    });
    await putDocument(request, 'riders', riderUser.uid, {
      riderId: riderUser.uid,
      uid: riderUser.uid,
      name: 'QA Rider',
      email: riderUser.email,
      verified: true,
      status: 'active',
      online: true,
      vehicle: 'motorcycle',
      rating: 5,
      totalRatings: 0,
      totalJobs: 0,
      totalIncome: 0,
      trustScore: 100,
      qrCodeUrl: 'https://example.test/qa-rider-qr.png',
      createdAt: now
    });
    await putDocument(request, 'orders', orderId, {
      code: 'OD-QA-CROSS-01',
      type: 'food',
      status: 'ready',
      userId: customerUser.uid,
      userName: 'QA Customer',
      merchantId: 'qa-merchant',
      merchantName: 'ร้าน QA',
      title: 'ออเดอร์ทดสอบ Cross-Role',
      address: 'จุดทดสอบชะอวด',
      lat: 8.1701,
      lng: 100.2051,
      paymentMode: 'transfer',
      items: [{ name: 'เมนูทดสอบ', qty: 1, price: 120 }],
      itemsTotal: 120,
      foodTotal: 120,
      fare: 20,
      total: 140,
      prepMinutes: 1,
      foodReady: true,
      riderId: null,
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
    });

    await Promise.all([
      customer.goto(CUSTOMER_PATH, { waitUntil: 'domcontentloaded' }),
      rider.goto(RIDER_PATH, { waitUntil: 'domcontentloaded' })
    ]);
    await Promise.all([
      signInCustomer(customer, customerUser),
      signInRider(rider, riderUser)
    ]);

    // Rider เห็นงานใหม่และรับงานผ่านปุ่มจริง
    const acceptButton = rider.locator(`[data-accept="${orderId}"]`);
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });
    await acceptButton.click();
    await waitForOrderState(
      rider,
      orderId,
      'rider',
      (order) => order.status === 'accepted' && order.riderId === riderUser.uid,
      'รอ Rider claimOpenJob เปลี่ยน Order เป็น accepted'
    );

    // Customer เห็น Order เดียวกันและยืนยันรายการ/ยอด
    const confirmButton = customer.locator('button', { hasText: 'ยืนยันรายการและยอด' });
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    customer.once('dialog', async (dialog) => { await dialog.accept(); });
    await confirmButton.click();
    await waitForOrderState(
      customer,
      orderId,
      'customer',
      (order) => order.customerOrderConfirmed === true,
      'รอ Customer ยืนยันรายการและยอด'
    );

    // Rider กดถึงร้าน แล้วแนบรูปอาหารผ่าน input จริง
    await expect(rider.locator(`[data-arrived="${orderId}"]`)).toBeVisible({ timeout: 15_000 });
    await rider.locator(`[data-arrived="${orderId}"]`).click();
    await expect(rider.locator('#pickup-food-gallery')).toBeAttached({ timeout: 10_000 });
    await uploadImage(rider, '#pickup-food-gallery', 'qa-food.png');
    await expect(rider.locator('#pickup-food-preview')).toBeVisible();
    await rider.locator('#pickup-confirm-btn').click();
    await waitForOrderState(
      customer,
      orderId,
      'customer',
      (order) => order.status === 'picked_up' && typeof order.foodImage === 'string',
      'รอ Rider อัปโหลดรูปอาหารและเปลี่ยนสถานะ picked_up'
    );

    // Customer แนบสลิปและกดยืนยันว่าโอนแล้ว
    await expect.poll(
      () => customer.evaluate((id) => {
        const order = (window._cachedOrders || []).find((item) => item.id === id);
        return order ? `${order.status}:${order.userId === window.currentUser?.uid}` : 'missing';
      }, orderId),
      { timeout: 10_000, message: 'Customer UI cache ยังไม่เป็น picked_up หรือไม่ใช่เจ้าของ Order' }
    ).toBe('picked_up:true');
    const customerSlipButton = customer.locator('button', { hasText: 'ถ่ายหรือเลือกสลิป' });
    await expect(customerSlipButton).toBeVisible({ timeout: 15_000 });
    await customerSlipButton.click();
    await expect.poll(
      () => customer.evaluate(() => window.pendingCustomerSlipOrderId),
      { timeout: 5_000, message: 'Customer ยังไม่ได้ผูก Input สลิปกับ Order ที่กำลังทดสอบ' }
    ).toBe(orderId);
    await uploadImage(customer, '#customer-slip-input', 'qa-customer-slip.png');
    await waitForOrderState(
      customer,
      orderId,
      'customer',
      (order) => typeof order.customerSlipUrl === 'string' && !!order.customerSlipUrl,
      'รอ Customer upload customerSlipUrl'
    );
    customer.once('dialog', async (dialog) => { await dialog.accept(); });
    await customer.locator('button', { hasText: 'ยืนยันว่าโอนแล้ว' }).click();
    await waitForOrderState(
      rider,
      orderId,
      'rider',
      (order) => order.status === 'customer_paid' && !!order.customerPaidAt,
      'รอ Rider ได้รับสถานะ customer_paid'
    );

    // Rider แนบสลิปที่จ่ายร้านผ่าน UI จริง
    const shopSlipButton = rider.locator(`[data-slip="${orderId}"]`);
    await expect(shopSlipButton).toBeVisible({ timeout: 15_000 });
    // The customer-paid update can refresh the rider job detail modal. Close
    // it explicitly before clicking the card action so the overlay cannot
    // intercept the real shop-slip interaction.
    await rider.evaluate(() => {
      if (typeof window.closeModal === 'function') window.closeModal();
    });
    await shopSlipButton.click();
    await expect(rider.locator('#pickup-slip-gallery')).toBeAttached({ timeout: 10_000 });
    await uploadImage(rider, '#pickup-slip-gallery', 'qa-shop-slip.png');
    await expect(rider.locator('#pickup-slip-preview')).toBeVisible();
    await rider.locator('#pickup-confirm-btn').click();
    await waitForOrderState(
      rider,
      orderId,
      'rider',
      (order) => typeof order.riderSlipToShop === 'string' && !!order.riderSlipToShop,
      'รอ Rider อัปโหลดสลิปร้าน'
    );

    // กดเริ่มส่งและยืนยันสถานะ Cross-Role สุดท้าย
    await expect(rider.locator(`[data-start-deliver="${orderId}"]`)).toBeVisible({ timeout: 15_000 });
    await rider.locator(`[data-start-deliver="${orderId}"]`).click();
    await waitForOrderState(
      customer,
      orderId,
      'customer',
      (order) => order.status === 'on_the_way',
      'รอ Order เปลี่ยนเป็น on_the_way'
    );
    await expect(customer.locator('#active-orders')).toContainText('กำลังส่ง');

    await customerContext.close();
    await riderContext.close();
  });
});
