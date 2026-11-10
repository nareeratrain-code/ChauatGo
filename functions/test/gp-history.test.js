'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { merchantHistoryEntry } = require('../gp-history');

test('merchant history drops slip download URLs', () => {
  const cleaned = merchantHistoryEntry({
    amount: 120,
    slipUrl: 'https://firebasestorage.googleapis.com/v0/b/chauat/o/gp_slips%2Fshop%2Fa.jpg?token=secret',
    slipPath: 'gp_slips/shop/a.jpg',
    transferId: 't1',
    status: 'pending'
  });
  assert.equal(cleaned.amount, 120);
  assert.equal(cleaned.transferId, 't1');
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'slipUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'slipPath'), false);
  assert.equal(merchantHistoryEntry(null), null);
});
