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
  test('แสดงตัวกรอง 3 ตัวเลือกและเลือกทั้งหมดเป็นค่าเริ่มต้น', async ({ page }) => {
    await openRiderFilterQA(page);

    await expect(page.locator('#job-filter-bar')).toBeVisible();
    await expect(page.locator('[data-job-filter="all"]')).toHaveText('ทั้งหมด');
    await expect(page.locator('[data-job-filter="food"]')).toContainText('ส่งอาหาร');
    await expect(page.locator('[data-job-filter="express"]')).toContainText('ส่งด่วน');
    await expect(page.locator('[data-job-filter="all"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-job-filter="food"]')).toHaveAttribute('aria-selected', 'false');
  });

  test('กรองอาหาร Partner และร้านที่มี merchantId ได้ถูกต้อง', async ({ page }) => {
    await openRiderFilterQA(page);
    await setJobs(page, [
      { id: 'food-1', type: 'food', status: 'cooking', merchantId: 'merchant-1', title: 'อาหาร 1' },
      { id: 'food-2', type: 'food', status: 'ready', merchantId: 'merchant-2', title: 'อาหาร 2' },
      { id: 'food-3', status: 'cooking', merchantId: 'merchant-3', title: 'อาหารไม่มี type' },
      { id: 'express-1', type: 'express', status: 'searching', title: 'ส่งด่วน 1' },
      { id: 'shopping-1', type: 'shopping', status: 'searching', title: 'ฝากซื้อ 1' }
    ]);

    await page.locator('[data-job-filter="food"]').click();
    const foodState = await readFilterState(page);
    expect(foodState.filter).toBe('food');
    expect(foodState.newIds).toEqual(expect.arrayContaining(['food-1', 'food-2', 'food-3']));
    expect(foodState.newIds).toHaveLength(3);
    expect(foodState.newCount).toBe('3');

    await page.locator('[data-job-filter="express"]').click();
    const expressState = await readFilterState(page);
    expect(expressState.filter).toBe('express');
    expect(expressState.newIds).toEqual(expect.arrayContaining(['express-1', 'shopping-1']));
    expect(expressState.newIds).toHaveLength(2);
    expect(expressState.newCount).toBe('2');
  });

  test('กรองเฉพาะงานใหม่ แต่งานที่กำลังทำและงานเสร็จยังแสดงตามประเภทที่เลือก', async ({ page }) => {
    await openRiderFilterQA(page);
    await setJobs(page, [
      { id: 'active-food', type: 'food', status: 'on_the_way', riderId: 'qa-rider', merchantId: 'merchant-1', title: 'อาหารกำลังส่ง' },
      { id: 'active-express', type: 'express', status: 'on_the_way', riderId: 'qa-rider', title: 'ส่งด่วนกำลังส่ง' }
    ]);

    await page.evaluate(() => {
      const now = new Date();
      window.__QA_RIDER_FILTER__.setHistory([
        { id: 'done-food', type: 'food', merchantId: 'merchant-2', status: 'done', doneAt: now, title: 'อาหารเสร็จ' },
        { id: 'done-express', type: 'express', status: 'done', doneAt: now, title: 'ส่งด่วนเสร็จ' }
      ]);
    });

    await page.locator('[data-job-filter="food"]').click();
    let state = await readFilterState(page);
    expect(state.activeIds).toEqual(['active-food', 'active-express']);
    expect(state.activeCount).toBe('2');
    expect(state.doneIds).toEqual(['done-food']);
    expect(state.doneCount).toBe('1');

    await page.locator('[data-job-filter="express"]').click();
    state = await readFilterState(page);
    expect(state.activeIds).toEqual(['active-food', 'active-express']);
    expect(state.activeCount).toBe('2');
    expect(state.doneIds).toEqual(['done-express']);
    expect(state.doneCount).toBe('1');
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
