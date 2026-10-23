const { test, expect } = require('@playwright/test');

const RIDER_PATH = '/rider.html?qa=job-filter';

async function openRiderFilterQA(page) {
  await page.goto(RIDER_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__QA_RIDER_FILTER__, null, { timeout: 15_000 });
  await page.evaluate(() => {
    document.getElementById('login-screen')?.style.setProperty('display', 'none', 'important');
    document.getElementById('app')?.style.setProperty('display', 'block', 'important');
    document.getElementById('job-filter-bar')?.style.setProperty('display', 'flex', 'important');
  });
  await expect(page.locator('#job-filter-bar')).toBeVisible();
}

async function state(page) {
  return page.evaluate(() => window.__QA_RIDER_FILTER__.state());
}

test.describe('Rider Job Filter - Negative Tests', () => {
  test('เมื่อโหลดงานล้มเหลว หน้ายังทำงานและรายการถูกเคลียร์อย่างปลอดภัย', async ({ page }) => {
    await openRiderFilterQA(page);

    await page.evaluate(() => {
      window.__QA_RIDER_FILTER__.setJobs([
        { id: 'before-error', type: 'express', status: 'searching', title: 'งานก่อนเกิดข้อผิดพลาด' }
      ]);
      window.__QA_RIDER_FILTER__.setLoadError('Firestore unavailable');
    });

    const result = await state(page);
    expect(result.loadError).toBe('Firestore unavailable');
    expect(result.newIds).toEqual([]);
    expect(result.activeIds).toEqual([]);
    expect(result.doneIds).toEqual([]);
    expect(result.newCount).toBe('0');
    await expect(page.locator('#job-filter-bar')).toBeVisible();
    await expect(page.locator('[data-job-filter="food"]')).toBeEnabled();
  });

  test('เมื่อข้อมูลตอบกลับเป็น null หรือไม่ใช่ Array หน้าต้องไม่ล่ม', async ({ page }) => {
    await openRiderFilterQA(page);

    for (const invalidValue of [null, undefined, {}, 'invalid-payload']) {
      await page.evaluate((value) => window.__QA_RIDER_FILTER__.setJobs(value), invalidValue);
      const result = await state(page);
      expect(result.newIds).toEqual([]);
      expect(result.newCount).toBe('0');
      await expect(page.locator('#job-filter-bar')).toBeVisible();
    }
  });

  test('เมื่อรายการงานมีข้อมูลไม่ครบหรือ type แปลก ระบบไม่โยน Exception', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => {
      const msg = error.message || '';
      // App Check reCAPTCHA cannot complete in the local test browser.
      if (/cancelled|recaptcha|appcheck/i.test(msg)) return;
      pageErrors.push(msg);
    });
    await openRiderFilterQA(page);

    await page.evaluate(() => window.__QA_RIDER_FILTER__.setJobs([
      {},
      { id: 'missing-status' },
      { id: 'unknown-type', type: 'unknown', status: 'searching' },
      { id: 'missing-id', type: 'express', status: 'searching' },
      { id: 'food-no-name', type: 'food', status: 'cooking', merchantId: 'merchant-1' }
    ]));

    await page.locator('[data-job-filter="food"]').click();
    const foodResult = await state(page);
    expect(foodResult.newIds).toEqual(['food-no-name']);

    await page.locator('[data-job-filter="express"]').click();
    const expressResult = await state(page);
    expect(expressResult.newIds).toEqual(['missing-id']);

    await page.locator('[data-job-filter="all"]').click();
    const allResult = await state(page);
    expect(allResult.newIds).toEqual(expect.arrayContaining(['unknown-type', 'missing-id', 'food-no-name']));
    expect(pageErrors).toEqual([]);
  });

  test('เมื่อกดตัวกรองถี่ ๆ ระหว่างข้อมูลว่าง หน้าไม่ค้างและสถานะยังถูกต้อง', async ({ page }) => {
    await openRiderFilterQA(page);
    await page.evaluate(() => window.__QA_RIDER_FILTER__.setLoadError('network timeout'));

    await page.locator('[data-job-filter="food"]').click();
    await page.locator('[data-job-filter="express"]').click();
    await page.locator('[data-job-filter="all"]').click();
    await page.locator('[data-job-filter="food"]').click();

    const result = await state(page);
    expect(result.filter).toBe('food');
    expect(result.loadError).toBe('network timeout');
    expect(result.newCount).toBe('0');
    await expect(page.locator('[data-job-filter="food"]')).toHaveAttribute('aria-selected', 'true');
  });
});
