'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  notifyAdminsOfRemittance,
  shouldNotifyFinalizedRemittance
} = require('../admin-notifications');

function source(path, data, updates) {
  return {
    id: path.split('/').pop(),
    ref: {
      async update(patch) {
        updates.push({ path, patch });
      }
    },
    data: () => data
  };
}

function dbFromSources(sources) {
  return {
    collection(name) {
      return {
        where() {
          return {
            async get() {
              return { docs: sources[name] || [] };
            }
          };
        }
      };
    }
  };
}

test('notifyAdminsOfRemittance sends to unique admin tokens', async () => {
  const updates = [];
  const admin = source('admins/admin1', { role: 'active', fcmTokens: ['a', 'b'] }, updates);
  const duplicate = source('users/admin1', { role: 'admin', fcmTokens: ['b', 'c'] }, updates);
  const calls = [];
  const messaging = {
    async sendEachForMulticast(message) {
      calls.push(message);
      return {
        successCount: 3,
        failureCount: 0,
        responses: [{ success: true }, { success: true }, { success: true }]
      };
    }
  };

  const result = await notifyAdminsOfRemittance(
    dbFromSources({ admins: [admin], users: [duplicate] }),
    { remittanceId: 'rider1_2026-11-21', riderId: 'rider1', dateKey: '2026-11-21', amountSubmitted: 42 },
    { messaging }
  );

  assert.equal(result.status, 'sent');
  assert.equal(result.tokenCount, 3);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tokens.sort(), ['a', 'b', 'c']);
  assert.equal(calls[0].data.remittanceId, 'rider1_2026-11-21');
  assert.equal(updates.length, 0);
});

test('notifyAdminsOfRemittance removes invalid tokens without failing the submission', async () => {
  const updates = [];
  const admin = source('admins/admin1', { role: 'active', fcmTokens: ['bad', 'good'] }, updates);
  const messaging = {
    async sendEachForMulticast() {
      return {
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: true }
        ]
      };
    }
  };

  const result = await notifyAdminsOfRemittance(
    dbFromSources({ admins: [admin], users: [] }),
    { remittanceId: 'rider1_2026-11-21', riderId: 'rider1', dateKey: '2026-11-21', amount: 42 },
    { messaging }
  );

  assert.equal(result.status, 'partial_failure');
  assert.equal(result.invalidTokenCount, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].patch.fcmTokens.elements, ['bad']);
});

test('notifyAdminsOfRemittance returns no_tokens when no admin device is registered', async () => {
  const result = await notifyAdminsOfRemittance(
    dbFromSources({ admins: [], users: [] }),
    { remittanceId: 'rider1_2026-11-21' },
    { messaging: { async sendEachForMulticast() { throw new Error('must not send'); } } }
  );

  assert.equal(result.status, 'no_tokens');
  assert.equal(result.successCount, 0);
});

test('repeated finalize is idempotent and does not send FCM twice', async () => {
  const finalizeResults = [
    { alreadyFinalized: false, status: 'pending' },
    { alreadyFinalized: true, status: 'pending' }
  ];
  let notificationCalls = 0;

  for (const result of finalizeResults) {
    if (!shouldNotifyFinalizedRemittance(result)) continue;
    notificationCalls += 1;
  }

  assert.equal(notificationCalls, 1);
  assert.equal(shouldNotifyFinalizedRemittance(finalizeResults[0]), true);
  assert.equal(shouldNotifyFinalizedRemittance(finalizeResults[1]), false);
});

test('finalize notification guard rejects missing or malformed results', () => {
  assert.equal(shouldNotifyFinalizedRemittance(null), false);
  assert.equal(shouldNotifyFinalizedRemittance({}), false);
  assert.equal(shouldNotifyFinalizedRemittance({ alreadyFinalized: true }), false);
  assert.equal(shouldNotifyFinalizedRemittance({ alreadyFinalized: 1 }), false);
});
