const { test, expect } = require('@playwright/test');

const RIDER_PATH = '/rider.html?qa=job-filter';
const LARGE_JOB_COUNT = 1000;

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

function makeJobs(count = LARGE_JOB_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    const food = index % 2 === 0;
    return {
      id: `${food ? 'food' : 'express'}-${index}`,
      type: food ? 'food' : 'express',
      merchantId: food ? `merchant-${index % 20}` : undefined,
      merchantName: food ? `ร้านทดสอบ ${index % 20}` : undefined,
      status: food ? (index % 4 === 0 ? 'ready' : 'cooking') : 'searching',
      title: food ? `ออเดอร์อาหาร ${index}` : `งานส่งด่วน ${index}`,
      userName: `ลูกค้า ${index}`,
      address: `ที่อยู่จำลองเลขที่ ${index}`,
      fare: 35 + (index % 10),
      foodTotal: food ? 80 + (index % 100) : 0,
      paymentMode: 'transfer'
    };
  });
}

async function getState(page) {
  return page.evaluate(() => window.__QA_RIDER_FILTER__.state());
}

test.describe('Rider Job Filter - Performance / Load', () => {
  test('Render งาน 1,000 รายการพร้อมกันได้โดยไม่ทำให้หน้าค้าง', async ({ page }) => {
    await openRiderFilterQA(page);
    const jobs = makeJobs();

    const result = await page.evaluate((items) => {
      const start = performance.now();
      window.__QA_RIDER_FILTER__.setJobs(items);
      return {
        elapsedMs: Math.round(performance.now() - start),
        cards: document.querySelectorAll('#new-jobs-list [data-card-id]').length
      };
    }, jobs);

    expect(result.cards).toBe(LARGE_JOB_COUNT);
    // Guardrail for CI/headless runs; this is not a production SLA.
    expect(result.elapsedMs).toBeLessThan(5_000);
  });

  test('สลับตัวกรองซ้ำ 21 รอบบนข้อมูลจำนวนมากได้ภายในเวลาที่กำหนด', async ({ page }) => {
    await openRiderFilterQA(page);
    await page.evaluate(items => window.__QA_RIDER_FILTER__.setJobs(items), makeJobs());

    const result = await page.evaluate(() => {
      const filters = ['food', 'express', 'all'];
      const start = performance.now();
      for (let i = 0; i < 21; i += 1) {
        window.setJobFilter(filters[i % filters.length]);
      }
      return {
        elapsedMs: Math.round(performance.now() - start),
        finalFilter: window.__QA_RIDER_FILTER__.state().filter,
        finalCount: Number(window.__QA_RIDER_FILTER__.state().newCount)
      };
    });

    expect(result.finalFilter).toBe('all');
    expect(result.finalCount).toBe(LARGE_JOB_COUNT);
    expect(result.elapsedMs).toBeLessThan(5_000);
  });

  test('รับข้อมูลอัปเดตซ้ำ 10 รอบโดยจำนวนการ์ดไม่เพิ่มซ้ำผิดปกติ', async ({ page }) => {
    await openRiderFilterQA(page);
    const jobs = makeJobs();

    const result = await page.evaluate((items) => {
      const start = performance.now();
      for (let i = 0; i < 10; i += 1) {
        window.__QA_RIDER_FILTER__.setJobs(items.map(job => ({
          ...job,
          title: `${job.title} update-${i}`
        })));
      }
      return {
        elapsedMs: Math.round(performance.now() - start),
        cards: document.querySelectorAll('#new-jobs-list [data-card-id]').length,
        uniqueCards: new Set(Array.from(document.querySelectorAll('#new-jobs-list [data-card-id]')).map(el => el.dataset.cardId)).size
      };
    }, jobs);

    expect(result.cards).toBe(LARGE_JOB_COUNT);
    expect(result.uniqueCards).toBe(LARGE_JOB_COUNT);
    expect(result.elapsedMs).toBeLessThan(10_000);
  });
});
