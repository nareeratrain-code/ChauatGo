'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { filterPayouts, payoutSearchText } = require('../admin-payout-utils');

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
