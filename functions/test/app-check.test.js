'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appCheckStatus, assertAppCheck, enforceFromEnv } = require('../app-check');

test('missing token is not ok', () => {
  assert.equal(appCheckStatus(null), false);
  assert.equal(appCheckStatus({}), false);
  assert.equal(appCheckStatus({ app: null }), false);
  assert.equal(appCheckStatus({ app: {} }), false);
});

test('valid app id is ok', () => {
  assert.equal(appCheckStatus({ app: { appId: '1:282197694521:web:0528c22747a0c04bd815e8' } }), true);
});

test('soft mode logs a missing token and does not throw', () => {
  const lines = [];
  const log = { info() {}, warn(msg) { lines.push(msg); } };
  assert.equal(assertAppCheck({}, 'acceptDispatchOffer', false, log), false);
  assert.match(lines[0], /\[appcheck\] missing acceptDispatchOffer enforce=false/);
});

test('soft mode logs a valid token', () => {
  const lines = [];
  const log = { info(msg) { lines.push(msg); }, warn() {} };
  const req = { app: { appId: '1:1:web:abc' } };
  assert.equal(assertAppCheck(req, 'skipDispatchOffer', false, log), true);
  assert.match(lines[0], /\[appcheck\] ok skipDispatchOffer 1:1:web:abc/);
});

test('enforce mode rejects a missing token', () => {
  assert.throws(
    () => assertAppCheck({}, 'manualAssignRider', true, { info() {}, warn() {} }),
    (err) => err && err.code === 'app-check'
  );
});

test('enforce flag is on only for the string true', () => {
  assert.equal(enforceFromEnv({}), false);
  assert.equal(enforceFromEnv({ APP_CHECK_ENFORCE: 'false' }), false);
  assert.equal(enforceFromEnv({ APP_CHECK_ENFORCE: '1' }), false);
  assert.equal(enforceFromEnv({ APP_CHECK_ENFORCE: 'true' }), true);
});
