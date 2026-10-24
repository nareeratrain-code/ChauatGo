const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

function loadFcm(rawGetToken, registration) {
  const sandbox = {
    console: console,
    Promise: Promise,
    CHAUAT_ENV: {},
    navigator: {
      serviceWorker: {
        getRegistration: function () { return Promise.resolve(registration || null); }
      }
    },
    firebase: {
      messaging: function () {
        return { getToken: rawGetToken };
      }
    }
  };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync('fcm-safe.js', 'utf8'), sandbox);
  return sandbox;
}

test('callable getToken without a registration cannot reject the order', async () => {
  let called = 0;
  const sandbox = loadFcm(function () {
    called += 1;
    return Promise.reject(new Error('Messaging: We are unable to register the default service worker. Failed to register a ServiceWorker for scope (\'https://chauat-go-i5ec.vercel.app/firebase-cloud-messaging-push-scope\')'));
  });
  const messaging = sandbox.ChauatFcm.install({});
  // Same shape as firebase-functions-compat 9.22: the rejection is returned, not awaited.
  async function getMessagingToken() {
    if (messaging) {
      try { return messaging.getToken(); }
      catch (e) { return 'sync'; }
    }
  }
  assert.equal(await getMessagingToken(), undefined);
  assert.equal(called, 0);
  assert.equal(fs.readFileSync('fcm-safe.js', 'utf8').includes('firebase-messaging-sw.js'), true);
});

test('an explicit sw.js registration swallows token failures', async () => {
  const reg = { scope: 'https://chauat-go-i5ec.vercel.app/' };
  const sandbox = loadFcm(function (options) {
    assert.equal(options.serviceWorkerRegistration, reg);
    assert.equal(options.vapidKey, 'a-public-vapid-key-value-long-enough');
    return Promise.reject(new Error('use-vapid'));
  }, reg);
  sandbox.CHAUAT_ENV.vapidKey = 'a-public-vapid-key-value-long-enough';
  sandbox.ChauatFcm.install({});
  assert.equal(await sandbox.ChauatFcm.warm({}), undefined);
});

test('food, ride, express, and shopping share one order callable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.equal((html.match(/httpsCallable\('createOrder'\)/g) || []).length, 1);
  assert.ok(html.indexOf('ChauatFcm.warm(firebaseApp)') > html.indexOf("httpsCallable('createOrder')"));
});
