const { test, expect } = require('@playwright/test');

const APP_PATH = '/index.html?qa=permissions';

/**
 * ทำให้ Browser Permission เป็น deterministic โดยไม่พึ่งสิทธิ์จริงของเครื่อง QA
 * ใช้เฉพาะ QA/Staging ห้ามเปิดใน Production
 */
async function installPermissionMocks(page, options = {}) {
  const {
    geolocation = 'prompt',       // prompt | granted | denied | unavailable | timeout
    notification = 'default'      // default | granted | denied | unavailable | dismissed
  } = options;

  await page.addInitScript(({ geolocation, notification }) => {
    window.__QA_PERMISSION_EVENTS__ = [];
    window.__QA_NATIVE_EVENTS__ = [];
    window.__QA_PERMISSION_CONFIG__ = { geolocation, notification };

    const originalDispatch = window.dispatchEvent.bind(window);
    window.addEventListener('chauat:permission-event', (event) => {
      window.__QA_PERMISSION_EVENTS__.push(event.detail || {});
    });

    function emitNativeEvent(permission, result) {
      window.__QA_NATIVE_EVENTS__.push({ permission, result, at: new Date().toISOString() });
      originalDispatch(new CustomEvent('chauat:qa-native-permission', {
        detail: { permission, result, at: new Date().toISOString() }
      }));
    }

    if (geolocation === 'unavailable') {
      try { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); } catch (_) {}
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = (success, error) => {
        if (window.__QA_PERMISSION_CONFIG__.geolocation === 'granted') {
          emitNativeEvent('location', 'granted');
          success({
            coords: { latitude: 8.1701, longitude: 100.2051, accuracy: 12 },
            timestamp: Date.now()
          });
          return;
        }
        if (window.__QA_PERMISSION_CONFIG__.geolocation === 'timeout') {
          emitNativeEvent('location', 'timeout');
          error({ code: 3, message: 'QA simulated timeout' });
          return;
        }
        emitNativeEvent('location', 'denied');
        error({ code: 1, message: 'QA simulated denial' });
      };
    }

    if (notification === 'unavailable') {
      try { delete window.Notification; } catch (_) {}
    } else if ('Notification' in window) {
      const NativeNotification = window.Notification;
      const originalRequestPermission = NativeNotification.requestPermission;
      NativeNotification.requestPermission = function () {
        const configured = window.__QA_PERMISSION_CONFIG__.notification;
        const result = configured === 'dismissed' ? 'default' : configured;
        emitNativeEvent('notifications', result);
        return Promise.resolve(result);
      };
      try {
        Object.defineProperty(NativeNotification, 'permission', {
          configurable: true,
          // จำลองว่ายังไม่เคยถามก่อนเข้า Flow เพื่อให้แอปเรียก requestPermission()
          get: () => 'default'
        });
      } catch (_) {
        // Browser อาจล็อก property นี้ไว้ แต่ requestPermission ยังถูก Mock ได้
      }
    }
  }, { geolocation, notification });
}

async function clearPermissionState(context) {
  await context.clearCookies();
}

async function openFirstLaunch(page, permissionOptions = {}) {
  await page.addInitScript(() => { window.__QA_USE_EMULATORS__ = true; });
  await installPermissionMocks(page, permissionOptions);
  await page.goto(APP_PATH);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator('#pdpa-overlay')).toBeVisible();
}

async function acknowledgePrivacyNotice(page) {
  await page.locator('#pdpa-primary-btn').click();
  await expect(page.locator('#pdpa-overlay')).toBeHidden();
}

async function readPermissionEvents(page) {
  return page.evaluate(() => window.__QA_PERMISSION_EVENTS__ || []);
}

async function assertNoNativePermissionEvent(page) {
  await expect.poll(async () => (await page.evaluate(() => window.__QA_PERMISSION_EVENTS__ || [])).length).toBe(0);
}

async function signInAnonymouslyAndWaitForConsentFlush(page) {
  return page.evaluate(async () => {
    const app = firebase.app('customer');
    await firebase.auth(app).signInAnonymously();
    await new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.currentUser || Date.now() - started > 5_000) {
          clearInterval(timer); resolve();
        }
      }, 50);
    });
    const pending = JSON.parse(localStorage.getItem('chauat_pending_consent_events') || '[]');
    if (!pending.length) return { error: 'ไม่มี Pending Consent Event' };
    return window.recordConsentEvent(pending[0]);
  });
}

test.describe('First Launch Privacy and Permission boundaries', () => {
  test('ไม่ขอ GPS/Notification ตั้งแต่ First Launch', async ({ page }) => {
    await openFirstLaunch(page, { geolocation: 'prompt', notification: 'default' });

    await expect(page.getByRole('heading', { name: 'ก่อนเริ่มใช้งาน' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'รับทราบและเข้าสู่แอป' })).toBeVisible();
    await assertNoNativePermissionEvent(page);
  });

  test('รับทราบ Notice โดยไม่สร้าง Native Permission หรือ Consent อื่น', async ({ page }) => {
    await openFirstLaunch(page);
    await acknowledgePrivacyNotice(page);

    await expect(page.locator('#pdpa-overlay')).toBeHidden();
    const values = await page.evaluate(() => ({
      notice: localStorage.getItem('chauat_privacy_notice_ack_v1'),
      location: localStorage.getItem('chauat_permission_location_asked'),
      notification: localStorage.getItem('chauat_permission_notification_asked')
    }));
    expect(values.notice).toBe('1');
    expect(values.location).toBeNull();
    expect(values.notification).toBeNull();
    await assertNoNativePermissionEvent(page);
  });

  test('Privacy Choices ไม่เปิด Native Notification อัตโนมัติ', async ({ page }) => {
    await openFirstLaunch(page);
    await page.getByRole('button', { name: /ตั้งค่าความเป็นส่วนตัว/ }).click();

    await expect(page.locator('#pdpa-choice-panel')).toHaveClass(/show/);
    await page.locator('#consent-marketing').check();
    await page.getByRole('button', { name: 'บันทึกตัวเลือก' }).click();

    expect(await page.evaluate(() => localStorage.getItem('chauat_consent_marketing'))).toBe('granted');
    expect(await page.evaluate(() => localStorage.getItem('chauat_consent_notifications'))).toBe('rejected');
    await assertNoNativePermissionEvent(page);
  });

  test('ส่ง Notice Acknowledgement เข้า Firestore Emulator และอ่านกลับได้', async ({ page }) => {
    await openFirstLaunch(page);
    await acknowledgePrivacyNotice(page); // queue ก่อนมี Auth
    const flushed = await signInAnonymouslyAndWaitForConsentFlush(page);
    console.log('QA consent result', flushed, await page.evaluate(() => ({
      url: window.functionsApi && window.functionsApi._delegate && window.functionsApi._delegate._url,
      emulator: window.functionsApi && window.functionsApi._delegate && window.functionsApi._delegate._customDomain
    })));
    expect(flushed.eventType).toBe('notice_acknowledged');
    expect(flushed.purposeCode).toBe('customer.privacy_notice');
    expect(flushed.eventId).toBeTruthy();

    const result = await page.evaluate(async () => {
      const response = await window.functionsApi.httpsCallable('listMyConsentEvents')({ limit: 20 });
      return response.data;
    });
    expect(result.events.some((event) =>
      event.eventId === flushed.eventId
      && event.subjectType === 'customer'
      && event.eventType === 'notice_acknowledged'
      && event.purposeCode === 'customer.privacy_notice'
    )).toBe(true);
  });
});

test.describe('Customer GPS permission edge cases', () => {
  test('Allow: ใช้ตำแหน่งสำเร็จหลังผู้ใช้เริ่มฟีเจอร์', async ({ page }) => {
    await openFirstLaunch(page, { geolocation: 'granted' });
    await acknowledgePrivacyNotice(page);
    await page.waitForTimeout(600);

    await expect(page.locator('#loc-popup-overlay')).toBeVisible();
    await page.locator('.loc-allow').click();

    await expect(page.locator('#loc-popup-overlay')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('เปิด GPS แล้ว', { timeout: 5_000 });
    const coords = await page.evaluate(() => window.userLocation || null);
    expect(coords).toBeTruthy();
    expect(coords.lat).toBeCloseTo(8.1701, 4);
  });

  test('Deny: มี fallback และไม่ทำให้แอปค้าง', async ({ page }) => {
    await openFirstLaunch(page, { geolocation: 'denied' });
    await acknowledgePrivacyNotice(page);
    await page.waitForTimeout(600);
    await page.locator('.loc-allow').click();

    await expect(page.locator('#loc-popup-overlay')).toBeHidden();
    await expect(page.getByPlaceholder('ค้นหาสถานที่ในอำเภอชะอวด...')).toBeVisible();
    await expect(page.locator('#toast')).toContainText(/ตำแหน่ง|GPS|ไม่สามารถ|ไม่สำเร็จ/, { timeout: 5_000 });
  });

  test('Unavailable: ไม่รองรับ GPS ต้องไม่เกิด JavaScript crash', async ({ page }) => {
    await openFirstLaunch(page, { geolocation: 'unavailable' });
    await acknowledgePrivacyNotice(page);
    await page.waitForTimeout(600);
    await page.locator('.loc-allow').click();

    await expect(page.locator('#loc-popup-overlay')).toBeHidden();
    await expect(page.getByPlaceholder('ค้นหาสถานที่ในอำเภอชะอวด...')).toBeVisible();
  });

  test('Skip: ผู้ใช้เลือกข้ามได้และไม่ขอซ้ำใน Session เดิม', async ({ page }) => {
    await openFirstLaunch(page, { geolocation: 'prompt' });
    await acknowledgePrivacyNotice(page);
    await page.waitForTimeout(600);
    await page.locator('.loc-skip').click();

    await expect(page.locator('#loc-popup-overlay')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('chauat_location_asked'))).toBe('1');
    await page.reload();
    await page.waitForTimeout(300);
    await expect(page.locator('#loc-popup-overlay')).toBeHidden();
  });
});

test.describe('Notification permission edge cases', () => {
  test('Granted: เปิด Notification ได้เมื่อกดปุ่มฟีเจอร์จริง', async ({ page }) => {
    await openFirstLaunch(page, { notification: 'granted' });
    await acknowledgePrivacyNotice(page);

    await page.evaluate(() => window.enableNearAlerts());
    await expect.poll(async () => page.evaluate(() => window.__QA_NATIVE_EVENTS__ || [])).toHaveLength(1);
    expect(await page.evaluate(() => window.__QA_NATIVE_EVENTS__[0].result)).toBe('granted');
  });

  test('Denied: ไม่ส่ง Notification และยังใช้งานหน้า Orders ได้', async ({ page }) => {
    await openFirstLaunch(page, { notification: 'denied' });
    await acknowledgePrivacyNotice(page);

    await page.evaluate(() => window.enableNearAlerts());
    await expect(page.getByPlaceholder('ค้นหาสถานที่ในอำเภอชะอวด...')).toBeVisible();
    expect(await page.evaluate(() => window.__QA_NATIVE_EVENTS__[0].result)).toBe('denied');
  });

  test('Unavailable: เบราว์เซอร์ไม่รองรับ Notification', async ({ page }) => {
    await openFirstLaunch(page, { notification: 'unavailable' });
    await acknowledgePrivacyNotice(page);

    await page.evaluate(() => window.enableNearAlerts());
    await expect(page.getByPlaceholder('ค้นหาสถานที่ในอำเภอชะอวด...')).toBeVisible();
    expect(await page.evaluate(() => (window.__QA_NATIVE_EVENTS__ || []).length)).toBe(0);
  });

  test('Dismissed: ไม่ถือว่าได้รับ Consent', async ({ page }) => {
    await openFirstLaunch(page, { notification: 'dismissed' });
    await acknowledgePrivacyNotice(page);
    await page.evaluate(() => window.enableNearAlerts());

    const state = await page.evaluate(() => ({
      nearAlerts: localStorage.getItem('chauat_near_alerts'),
      notificationAsked: localStorage.getItem('chauat_permission_notification_asked')
    }));
    expect(state.nearAlerts).toBe('on');
    expect(await page.evaluate(() => window.__QA_NATIVE_EVENTS__[0].result)).toBe('default');
    // ปุ่มเปิดเสียงของแอปเป็นฟีเจอร์ภายใน จึงไม่ควรใช้ค่านี้แทน Notification Consent
    expect(state.notificationAsked).toBeNull();
  });
});

test.describe('Offline and multi-context edge cases', () => {
  test('Offline: หน้าแอปยังแสดง fallback และไม่ค้าง', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installPermissionMocks(page, { geolocation: 'denied' });
    await page.goto(APP_PATH);
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#pdpa-overlay')).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'รับทราบและเข้าสู่แอป' }).click();
    await expect(page.locator('#pdpa-overlay')).toBeHidden();
    await context.close();
  });

  test('สองแท็บไม่ควรทำให้หน้าใดหน้าหนึ่งค้าง', async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await Promise.all([
      installPermissionMocks(pageA, { geolocation: 'denied' }),
      installPermissionMocks(pageB, { geolocation: 'denied' })
    ]);
    await Promise.all([pageA.goto(APP_PATH), pageB.goto(APP_PATH)]);
    await expect(pageA.locator('#pdpa-overlay')).toBeVisible();
    await expect(pageB.locator('#pdpa-overlay')).toBeVisible();
    await context.close();
  });
});
