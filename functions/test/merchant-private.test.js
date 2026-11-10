'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergedFinance, pickFinance, mergeHistory } = require('../merchant-private');

test('private finance wins and history is the union of both copies', () => {
  const merged = mergedFinance(
    {
      name: 'ร้าน',
      phone: '081',
      email: 'old@shop.test',
      gpPending: 10,
      gpHistory: [{ transferId: 'a', amount: 10 }, { transferId: 'b', amount: 5 }]
    },
    {
      email: 'new@shop.test',
      gpPending: 40,
      gpHistory: [{ transferId: 'b', amount: 5, status: 'verified' }, { transferId: 'c', amount: 7 }]
    }
  );
  assert.equal(merged.email, 'new@shop.test');
  assert.equal(merged.gpPending, 40);
  assert.equal(merged.name, undefined);
  assert.equal(merged.phone, undefined);
  const ids = merged.gpHistory.map((row) => row.transferId).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(merged.gpHistory.find((row) => row.transferId === 'b').status, 'verified');
});

test('pickFinance ignores the storefront phone', () => {
  const picked = pickFinance({ phone: '081', email: 'a@b.c', gpPaid: 3, name: 'ร้าน' });
  assert.deepEqual(Object.keys(picked).sort(), ['email', 'gpPaid']);
});

test('history without a transfer id is kept', () => {
  const rows = mergeHistory([{ amount: 1 }], [{ transferId: 'a', amount: 2 }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 1);
  assert.equal(rows[1].transferId, 'a');
});
