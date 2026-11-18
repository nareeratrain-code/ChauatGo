'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const index = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const payout = fs.readFileSync(path.join(root, 'functions', 'payout.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const client = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');

test('financial callable endpoints require auth, mandatory App Check, and admin role', () => {
  for (const fn of ['createRiderPayout', 'reviewGpTransfer', 'reviewRiderRemittance']) {
    const start = index.indexOf(`exports.${fn}`);
    const end = index.indexOf('\n});', start);
    const body = index.slice(start, end);
    assert.match(body, /if \(!req\.auth\)/);
    assert.match(body, /guardRequiredAppCheck\(req/);
    assert.match(body, /callerIsAdmin\(db, req\.auth\)/);
  }
});
test('rider remittance submission requires auth and mandatory App Check but not admin role', () => {
  const start = index.indexOf('exports.submitRiderRemittance');
  const end = index.indexOf('\n});', start);
  const body = index.slice(start, end);
  assert.match(body, /if \(!req\.auth\)/);
  assert.match(body, /guardRequiredAppCheck\(req, 'submitRiderRemittance'\)/);
  assert.match(body, /riderRemittanceId\(uid, due\.dateKey\)/);
  assert.match(body, /db\.runTransaction\(async \(tx\)/);
  assert.match(body, /tx\.create\(remittanceRef/);
  assert.match(body, /isFirebaseStorageUrlForPath\(slipUrl, slipPath\)/);
});

test('rider remittance submit and review recalculate orders from transaction snapshots', () => {
  const submitStart = index.indexOf('exports.submitRiderRemittance');
  const submitEnd = index.indexOf('\n});', submitStart);
  const submitBody = index.slice(submitStart, submitEnd);
  assert.match(submitBody, /const orderTxSnap = await tx\.get\(db\.collection\('orders'\)/);
  assert.match(submitBody, /const txDue = riderDailyDue\(txJobs, now\.toMillis\(\)\)/);
  assert.match(submitBody, /riderTxSnap\.data\(\)\.verified !== true/);

  const reviewStart = index.indexOf('exports.reviewRiderRemittance');
  const reviewEnd = index.indexOf('\n});', reviewStart);
  const reviewBody = index.slice(reviewStart, reviewEnd);
  assert.match(reviewBody, /const orderSnap = await tx\.get\(db\.collection\('orders'\)/);
  assert.match(reviewBody, /const jobs = orderSnap\.docs\.map/);
  assert.match(reviewBody, /const plan = riderReviewPlan\(remittance, jobs, action\)/);
  assert.equal(reviewBody.includes('const preview = await ref.get()'), false);
  assert.equal(reviewBody.includes("db.collection('orders').where('riderId', '==', riderIdPreview)"), false);
});

test('Rider payout is atomic and cannot be created or edited by the browser', () => {
  assert.match(index, /db\.runTransaction\(async \(tx\)/);
  assert.match(index, /tx\.create\(payoutRef/);
  assert.match(index, /riderPayoutPaid: true/);
  assert.match(rules, /match \/rider_payouts\/{payoutId}/);
  assert.match(rules, /allow create, update, delete: if false/);
  assert.doesNotMatch(client, /collection\(['"]rider_payouts['"]\)\.(add|doc)/);
});

test('Payout API validates bounded identifiers and never trusts client money fields', () => {
  assert.match(index, /normalizeOrderIds\(data\.orderIds\)/);
  assert.match(index, /calculatePayoutOrders\(orders, riderId\)/);
  assert.match(payout, /gpRider/);
  assert.match(index, /note\.length > 300/);
  assert.match(index, /roundLabel\.length > 80/);
});
