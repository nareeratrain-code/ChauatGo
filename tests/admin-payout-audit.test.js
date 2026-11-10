'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { filterPayouts, payoutSearchText, summarizeDailyFinance } = require('../admin-payout-utils');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin.css'), 'utf8');

const riderNames = { riderA: 'สมหมาย ใจดี', riderB: 'มานี รักงาน' };
const payouts = [
  {
    id: 'doc-old', payoutId: 'rider_old', payoutKey: 'rider_old', riderId: 'riderA',
    status: 'paid', amount: 12.5, orderIds: ['OD-1001', 'OD-1002'],
    roundLabel: 'รอบเช้า', note: 'โอนผ่าน KBank',
    paidAt: new Date('2026-11-08T09:00:00+07:00')
  },
  {
    id: 'doc-new', payoutId: 'rider_new', payoutKey: 'rider_new', riderId: 'riderB',
    status: 'paid', amount: 30, orderIds: ['OD-2001'],
    roundLabel: 'รอบเย็น', note: 'พร้อมเพย์',
    paidAt: { seconds: Math.floor(new Date('2026-11-10T18:00:00+07:00').getTime() / 1000) }
  },
  {
    id: 'doc-cancelled', riderId: 'riderA', status: 'cancelled', amount: 0,
    orderIds: null, createdAt: new Date('2026-11-09T12:00:00+07:00')
  }
];

test('Admin loads a server payout ledger and exposes all audit filters', () => {
  assert.match(admin, /rider_payouts/);
  assert.match(admin, /store\.payouts/);
  assert.match(admin, /ChauatPayoutAuditUtils\.filterPayouts/);
  for (const key of ['q', 'status', 'rider', 'from', 'to']) {
    assert.match(admin, new RegExp(`data-payout-filter="${key}"`));
  }
  assert.match(admin, /data-view-payout/);
  assert.match(html, /admin-payout-utils\.js/);
});

test('Payout audit detail shows immutable review metadata and order IDs', () => {
  assert.match(admin, /function viewPayoutDetail/);
  assert.match(admin, /payoutId \|\| p\.payoutKey/);
  assert.match(admin, /paidBy/);
  assert.match(admin, /orderIds/);
  assert.match(admin, /roundLabel/);
  assert.match(admin, /data-confirm-payout/);
  assert.match(admin, /createRiderPayout/);
});

test('search matches payout id, rider name, order id, round label, and note case-insensitively', () => {
  assert.deepEqual(filterPayouts(payouts, { query: ' RIDER_NEW ', riderNames }).map(p => p.id), ['doc-new']);
  assert.deepEqual(filterPayouts(payouts, { query: 'สมหมาย', riderNames }).map(p => p.id), ['doc-cancelled', 'doc-old']);
  assert.deepEqual(filterPayouts(payouts, { query: 'od-1002', riderNames }).map(p => p.id), ['doc-old']);
  assert.deepEqual(filterPayouts(payouts, { query: 'รอบเย็น', riderNames }).map(p => p.id), ['doc-new']);
  assert.deepEqual(filterPayouts(payouts, { query: 'kbank', riderNames }).map(p => p.id), ['doc-old']);
  assert.match(payoutSearchText(payouts[0], riderNames), /od-1001/);
});

test('filters by status and exact rider without mixing records', () => {
  assert.deepEqual(filterPayouts(payouts, { status: 'paid', riderNames }).map(p => p.id), ['doc-new', 'doc-old']);
  assert.deepEqual(filterPayouts(payouts, { status: 'cancelled', riderNames }).map(p => p.id), ['doc-cancelled']);
  assert.deepEqual(filterPayouts(payouts, { riderId: 'riderA', riderNames }).map(p => p.id), ['doc-cancelled', 'doc-old']);
  assert.deepEqual(filterPayouts(payouts, { riderId: 'missing', riderNames }), []);
});

test('date range is inclusive at local-day boundaries and uses paidAt before createdAt', () => {
  assert.deepEqual(filterPayouts(payouts, { from: '2026-11-09', to: '2026-11-10', riderNames }).map(p => p.id), ['doc-new', 'doc-cancelled']);
  assert.deepEqual(filterPayouts(payouts, { from: '2026-11-10', to: '2026-11-10', riderNames }).map(p => p.id), ['doc-new']);
});

test('sorts newest first and safely handles empty, null, and legacy records', () => {
  assert.deepEqual(filterPayouts(payouts, { riderNames }).map(p => p.id), ['doc-new', 'doc-cancelled', 'doc-old']);
  assert.deepEqual(filterPayouts(null), []);
  assert.deepEqual(filterPayouts([{}], { query: 'anything' }), []);
  assert.doesNotThrow(() => filterPayouts([{ id: 'legacy', orderIds: undefined }], { status: 'all' }));
});

test('Payout audit has mobile responsive styles', () => {
  assert.match(css, /\.payout-audit-filters/);
  assert.match(css, /\.payout-detail-grid/);
  assert.match(css, /@media \(max-width: 480px\)/);
});

test('daily finance summary reconciles completed orders and payout ledger by local day', () => {
  const orders = [
    { id: 'o1', status: 'done', createdAt: new Date('2026-11-11T09:00:00+07:00'), riderPayoutPaid: false },
    { id: 'o2', status: 'delivered', createdAt: new Date('2026-11-11T16:00:00+07:00'), riderPayoutPaid: true },
    { id: 'o3', status: 'done', createdAt: new Date('2026-11-10T16:00:00+07:00'), riderPayoutPaid: false }
  ];
  const payouts = [
    { id: 'p1', status: 'paid', amount: 2, paidAt: new Date('2026-11-11T20:00:00+07:00') },
    { id: 'p2', status: 'pending', amount: 1, createdAt: new Date('2026-11-11T21:00:00+07:00') },
    { id: 'p3', status: 'paid', amount: 99, paidAt: new Date('2026-11-10T20:00:00+07:00') }
  ];
  const result = summarizeDailyFinance(orders, payouts, {
    date: '2026-11-11',
    getOrderValues: o => ({ fare: 100, food: 200, platformGp: 20, storeGp: 6, riderPayout: o.id === 'o1' ? 2 : 3 })
  });
  assert.equal(result.orderCount, 2);
  assert.equal(result.totalGp, 52);
  assert.equal(result.expectedRiderPayout, 5);
  assert.equal(result.unpaidRiderPayout, 2);
  assert.equal(result.paidPayout, 2);
  assert.equal(result.pendingPayout, 1);
  assert.equal(result.paidPayoutCount, 1);
});

test('Admin dashboard exposes daily finance date control and reconciliation cards', () => {
  assert.match(admin, /สรุปการเงินรายวัน/);
  assert.match(admin, /data-finance-date/);
  assert.match(admin, /summarizeDailyFinance/);
  assert.match(admin, /expectedRiderPayout/);
  assert.match(css, /\.finance-daily-grid/);
});
