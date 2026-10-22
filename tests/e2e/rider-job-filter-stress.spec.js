const { test, expect } = require('@playwright/test');

test.setTimeout(120_000);

const RIDER_PATH = '/rider.html?qa=job-filter';
const STRESS_JOB_COUNT = 5000;

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

function makeStressJobs(count = STRESS_JOB_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    const food = index % 2 === 0;
    return {
      id: `${food ? 'stress-food' : 'stress-express'}-${index}`,
      type: food ? 'food' : 'express',
      merchantId: food ? `merchant-${index % 100}` : undefined,
      merchantName: food ? `ร้าน Stress ${index % 100}` : undefined,
      status: food ? (index % 3 === 0 ? 'ready' : 'cooking') : 'searching',
      title: food ? `อาหาร Stress ${index}` : `ส่งด่วน Stress ${index}`,
      userName: `ลูกค้า Stress ${index}`,
      address: `ที่อยู่ทดสอบ Stress ${index}`,
      fare: 30 + (index % 20),
      foodTotal: food ? 60 + (index % 200) : 0,
      paymentMode: 'transfer'
    };
  });
}

async function readState(page) {
  return page.evaluate(() => window.__QA_RIDER_FILTER__.state());
}

test.describe('Rider Job Filter - Stress Test 5,000 Jobs', () => {
  test('Render งาน 5,000 รายการและกรองอาหาร/ส่งด่วนได้ครบ', async ({ page }) => {
    await openRiderFilterQA(page);
    const jobs = makeStressJobs();

    const result = await page.evaluate((items) => {
      const start = performance.now();
      window.__QA_RIDER_FILTER__.setJobs(items);
      return {
        elapsedMs: Math.round(performance.now() - start),
        allCards: document.querySelectorAll('#new-jobs-list [data-card-id]').length
      };
    }, jobs);

    console.log(`[stress] render ${result.allCards} jobs: ${result.elapsedMs} ms`);
    expect(result.allCards).toBe(STRESS_JOB_COUNT);
    expect(result.elapsedMs).toBeLessThan(30_000);

    const filterResult = await page.evaluate(() => {
      const start = performance.now();
      window.setJobFilter('food');
      const food = window.__QA_RIDER_FILTER__.state();
      window.setJobFilter('express');
      const express = window.__QA_RIDER_FILTER__.state();
      window.setJobFilter('all');
      return {
        elapsedMs: Math.round(performance.now() - start),
        foodCount: Number(food.newCount),
        expressCount: Number(express.newCount),
        allCount: Number(window.__QA_RIDER_FILTER__.state().newCount)
      };
    });

    console.log(`[stress] filter food/express/all: ${filterResult.elapsedMs} ms`);
    expect(filterResult.foodCount).toBe(2500);
    expect(filterResult.expressCount).toBe(2500);
    expect(filterResult.allCount).toBe(STRESS_JOB_COUNT);
    expect(filterResult.elapsedMs).toBeLessThan(30_000);
  });

  test('รับข้อมูลอัปเดตซ้ำ 3 รอบโดยไม่สร้างการ์ดซ้ำเกิน 5,000 รายการ', async ({ page }) => {
    await openRiderFilterQA(page);
    const jobs = makeStressJobs();

    const result = await page.evaluate((items) => {
      const start = performance.now();
      for (let round = 0; round < 3; round += 1) {
        window.__QA_RIDER_FILTER__.setJobs(items.map(job => ({
          ...job,
          title: `${job.title} update-${round}`
        })));
      }
      const cards = Array.from(document.querySelectorAll('#new-jobs-list [data-card-id]'));
      return {
        elapsedMs: Math.round(performance.now() - start),
        cardCount: cards.length,
        uniqueCardCount: new Set(cards.map(card => card.dataset.cardId)).size
      };
    }, jobs);

    console.log(`[stress] 3 updates, ${result.uniqueCardCount} unique cards: ${result.elapsedMs} ms`);
    expect(result.cardCount).toBe(STRESS_JOB_COUNT);
    expect(result.uniqueCardCount).toBe(STRESS_JOB_COUNT);
    expect(result.elapsedMs).toBeLessThan(60_000);
  });
});
