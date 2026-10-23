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

async function setJobs(page, jobs) {
  await page.evaluate((items) => {
    const now = Date.now();
    window.__QA_RIDER_FILTER__.setJobs(items.map((job, index) => ({
      createdAt: new Date(now - index * 60_000),
      ...job
    })));
  }, jobs);
}

async function readFilterState(page) {
  return page.evaluate(() => window.__QA_RIDER_FILTER__.state());
}

test.describe('Rider Job Filter', () => {
  test('แสดงตัวกรองห้าประเภทและเลือกทั้งหมดเป็นค่าเริ่มต้น', async ({ page }) => {
    await openRiderFilterQA(page);

    await expect(page.locator('#job-filter-bar')).toBeVisible();
    await expect(page.locator('[data-job-filter="all"]')).toHaveText('ทั้งหมด');
    await expect(page.locator('[data-job-filter="food"]')).toContainText('ส่งอาหาร');
    await expect(page.locator('[data-job-filter="express"]')).toContainText('ส่งด่วน');
    await expect(page.locator('[data-job-filter="ride"]')).toContainText('เรียกรถ');
    await expect(page.locator('[data-job-filter="shopping"]')).toContainText('ฝากซื้อ');
    await expect(page.locator('[data-job-filter="all"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-job-filter="food"]')).toHaveAttribute('aria-selected', 'false');
  });

  test('กรองงานใหม่ตาม order.type และไม่ใช้ merchantId', async ({ page }) => {
    await openRiderFilterQA(page);
    await setJobs(page, [
      { id: 'food-1', type: 'food', status: 'cooking', title: 'อาหารไม่มีร้าน' },
      { id: 'food-2', type: 'food', status: 'ready', merchantId: 'merchant-2', title: 'อาหาร 2' },
      { id: 'shop-id-only', status: 'cooking', merchantId: 'merchant-3', title: 'มีร้านแต่ไม่มี type' },
      { id: 'express-with-shop', type: 'express', status: 'searching', merchantId: 'merchant-9', title: 'ส่งด่วนที่มีร้าน' },
      { id: 'ride-1', type: 'ride', status: 'searching', title: 'เรียกรถ 1' },
      { id: 'shopping-1', type: 'shopping', status: 'searching', merchantId: 'merchant-4', title: 'ฝากซื้อ 1' }
    ]);

    await page.locator('[data-job-filter="food"]').click();
    const foodState = await readFilterState(page);
    expect(foodState.filter).toBe('food');
    expect(foodState.newIds).toEqual(['food-1', 'food-2']);
    expect(foodState.newCount).toBe('2');

    await page.locator('[data-job-filter="express"]').click();
    const expressState = await readFilterState(page);
    expect(expressState.newIds).toEqual(['express-with-shop']);
    expect(expressState.newCount).toBe('1');

    await page.locator('[data-job-filter="ride"]').click();
    const rideState = await readFilterState(page);
    expect(rideState.newIds).toEqual(['ride-1']);

    await page.locator('[data-job-filter="shopping"]').click();
    const shoppingState = await readFilterState(page);
    expect(shoppingState.newIds).toEqual(['shopping-1']);

    await page.locator('[data-job-filter="all"]').click();
    const allState = await readFilterState(page);
    expect(allState.newIds).toEqual(expect.arrayContaining([
      'food-1', 'food-2', 'shop-id-only', 'express-with-shop', 'ride-1', 'shopping-1'
    ]));
    expect(allState.newCount).toBe('6');
  });

  test('งานที่กำลังทำและงานเสร็จวันนี้ไม่ถูกตัวกรองซ่อน', async ({ page }) => {
    await openRiderFilterQA(page);
    await setJobs(page, [
      { id: 'active-food', type: 'food', status: 'on_the_way', riderId: 'qa-rider', merchantId: 'merchant-1', title: 'อาหารกำลังส่ง' },
      { id: 'active-express', type: 'express', status: 'on_the_way', riderId: 'qa-rider', title: 'ส่งด่วนกำลังส่ง' },
      { id: 'new-ride', type: 'ride', status: 'searching', title: 'เรียกรถใหม่' }
    ]);

    await page.evaluate(() => {
      const now = new Date();
      window.__QA_RIDER_FILTER__.setHistory([
        { id: 'done-food', type: 'food', merchantId: 'merchant-2', status: 'done', doneAt: now, title: 'อาหารเสร็จ' },
        { id: 'done-express', type: 'express', status: 'done', doneAt: now, title: 'ส่งด่วนเสร็จ' },
        { id: 'cancelled-ride', type: 'ride', status: 'cancelled', cancelledAt: now, title: 'เรียกรถยกเลิก' }
      ]);
    });

    await page.locator('[data-job-filter="food"]').click();
    let state = await readFilterState(page);
    expect(state.activeIds).toEqual(['active-food', 'active-express']);
    expect(state.activeCount).toBe('2');
    expect(state.newIds).toEqual([]);
    expect(state.doneIds).toEqual(['done-food', 'done-express', 'cancelled-ride']);
    expect(state.doneCount).toBe('3');

    await page.locator('[data-job-filter="ride"]').click();
    state = await readFilterState(page);
    expect(state.newIds).toEqual(['new-ride']);
    expect(state.activeIds).toEqual(['active-food', 'active-express']);
    expect(state.doneIds).toEqual(['done-food', 'done-express', 'cancelled-ride']);
    expect(state.doneCount).toBe('3');
  });

  test('ปุ่มตัวกรองอัปเดต aria-selected และกลับมาที่ทั้งหมดได้', async ({ page }) => {
    await openRiderFilterQA(page);

    await page.locator('[data-job-filter="express"]').click();
    await expect(page.locator('[data-job-filter="express"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-job-filter="all"]')).toHaveAttribute('aria-selected', 'false');

    await page.locator('[data-job-filter="all"]').click();
    await expect(page.locator('[data-job-filter="all"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-job-filter="express"]')).toHaveAttribute('aria-selected', 'false');
  });
});
