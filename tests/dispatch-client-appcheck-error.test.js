'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'dispatch-client.js'),
  'utf8'
);

function loadClient({ fetchImpl, appCheckToken = 'app-check-token' } = {}) {
  const calls = [];
  const self = {
    location: { hostname: 'chauatgo.example' },
    ChauatAppCheck: {
      token: async () => appCheckToken
    }
  };
  const auth = {
    currentUser: {
      getIdToken: async () => 'firebase-auth-token'
    }
  };
  const context = {
    self,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
    Promise,
    console
  };

  vm.runInNewContext(source, context, { filename: 'dispatch-client.js' });
  return { client: self.ChauatFn, auth, calls };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body == null ? '' : JSON.stringify(body)
  };
}

test('callFunction sends Firebase Auth and App Check headers on a successful callable request', async () => {
  const { client, auth, calls } = loadClient({
    fetchImpl: async () => response(200, { result: { ok: true } })
  });

  const result = await client.callFunction('reviewRiderRemittance', { action: 'verify' }, auth);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://asia-southeast1-chauat-go-b9841.cloudfunctions.net/reviewRiderRemittance');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer firebase-auth-token');
  assert.equal(calls[0].options.headers['X-Firebase-AppCheck'], 'app-check-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { data: { action: 'verify' } });
});

test('callFunction preserves a JSON App Check rejection returned by the callable handler', async () => {
  const { client, auth } = loadClient({
    fetchImpl: async () => response(401, {
      error: {
        status: 'UNAUTHENTICATED',
        message: 'แอปไม่ผ่านการตรวจสอบ'
      }
    })
  });

  await assert.rejects(
    client.callFunction('submitRiderRemittance', { dateKey: '2026-11-18' }, auth),
    (err) => {
      assert.equal(err.message, 'แอปไม่ผ่านการตรวจสอบ');
      assert.equal(err.status, 401);
      return true;
    }
  );
});

test('callFunction currently classifies an empty native 403 as an invoker/configuration error', async () => {
  const { client, auth } = loadClient({
    // Native enforceAppCheck can reject before the handler and return no readable
    // Callable body/CORS headers to the browser.
    fetchImpl: async () => response(403, null)
  });

  await assert.rejects(
    client.callFunction('createRiderPayout', { riderId: 'r1', orderIds: ['o1'] }, auth),
    (err) => {
      assert.equal(err.status, 403);
      assert.match(err.message, /Cloud Run invoker/);
      return true;
    }
  );
});

test('callFunction keeps a JSON permission error distinct from an empty native 403', async () => {
  const { client, auth } = loadClient({
    fetchImpl: async () => response(403, {
      error: {
        status: 'PERMISSION_DENIED',
        message: 'เฉพาะแอดมินการเงิน'
      }
    })
  });

  await assert.rejects(
    client.callFunction('reviewGpTransfer', { transferId: 'gp1', action: 'verify' }, auth),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.message, 'เฉพาะแอดมินการเงิน');
      return true;
    }
  );
});

test('callFunction converts browser Failed to fetch into a retryable connectivity error', async () => {
  const { client, auth } = loadClient({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    }
  });

  await assert.rejects(
    client.callFunction('syncMySettlement', {}, auth),
    (err) => {
      assert.match(err.message, /ติดต่อระบบจ่ายงานไม่ได้/);
      assert.match(err.message, /ตรวจเน็ต/);
      return true;
    }
  );
});

test('callFunction does not call the endpoint without an authenticated user', async () => {
  const { client } = loadClient({
    fetchImpl: async () => response(200, { result: {} })
  });

  await assert.rejects(
    client.callFunction('syncMySettlement', {}, { currentUser: null }),
    (err) => {
      assert.equal(err.message, 'ต้องเข้าสู่ระบบ');
      return true;
    }
  );
});
