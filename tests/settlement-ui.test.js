'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const merchant = fs.readFileSync(path.join(root, 'merchant.js'), 'utf8');
const merchantHtml = fs.readFileSync(path.join(root, 'merchant.html'), 'utf8');
const rider = fs.readFileSync(path.join(root, 'rider.js'), 'utf8');
const riderHtml = fs.readFileSync(path.join(root, 'rider.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');

test('settlement uses the published ChauatGo account instead of a typed placeholder', () => {
  assert.equal(merchant.includes('xxx-x-xxxxx-x'), false);
  assert.equal(merchantHtml.includes('xxx-x-xxxxx-x'), false);
  assert.match(admin, /config\/payout|doc\('payout'\)/);
  assert.match(merchant, /doc\('payout'\)/);
  assert.match(rider, /doc\('payout'\)/);
  assert.match(rules, /match \/config\/payout/);
  assert.match(storage, /match \/payout\/qr\/\{fileName\}/);
});

test('shop GP settlement reuses gp transfers and a separate admin chat', () => {
  assert.match(merchant, /collection\('gp_transfers'\)/);
  assert.match(merchant, /settlement_chats/);
  assert.match(merchant, /senderRole: 'shop'/);
  assert.match(merchantHtml, /gp-settlement/);
  assert.match(rules, /match \/settlement_chats\/\{chatId\}/);
  assert.equal(merchant.includes("senderRole: 'customer'"), false);
});

test('rider remittance keeps the 21:00 card and does not join an order thread', () => {
  assert.match(riderHtml, /ต้องโอนก่อน/);
  assert.match(riderHtml, /21:00/);
  assert.equal(riderHtml.includes('ต้องโอน 3 ทุ่ม'), false);
  assert.match(rider, /PLATFORM_SHARE/);
  assert.match(rider, /rider_remittances/);
  assert.match(rider, /settlement_slips\/riders/);
  assert.match(rider, /รอแอดมินตรวจสอบ/);
  assert.match(rider, /รอปลดล็อก/);
  assert.match(rider, /senderRole: 'rider'/);
  assert.match(rules, /match \/rider_remittances\/\{remittanceId\}/);
  assert.match(storage, /match \/settlement_slips\/riders\/\{uid\}\/\{fileName\}/);
  assert.equal(rider.includes('collection(\'chats\').doc(\'rider_'), false);
});

test('rider remittance submission is server-owned and uses one deterministic daily path', () => {
  assert.match(rider, /submitRiderRemittance/);
  assert.match(rider, /settlement_slips\/riders\/\$\{currentUser\.uid\}\/\$\{dateKey\}\.jpg/);
  assert.equal(rider.includes("collection('rider_remittances').add"), false);
  assert.match(rules, /allow create, update, delete: if false;/);
});

test('admin inbox confirms slips through the existing review callables', () => {
  assert.match(admin, /function settlement\(/);
  assert.match(admin, /reviewGpTransfer/);
  assert.match(admin, /reviewRiderRemittance/);
  assert.match(admin, /settlement_queue/);
  assert.match(admin, /text-shadow: 0 1px 0 #000, 0 0 2px #000|settle-amt/);
});
