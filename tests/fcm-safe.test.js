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

test('disarm patches messaging-internal, the instance httpsCallable calls', async () => {
  let called = 0;
  const internal = {
    getToken: function () {
      called += 1;
      return Promise.reject(new Error("Messaging: We are unable to register the default service worker. Failed to register a ServiceWorker for scope ('https://chauat-go-i5ec.vercel.app/firebase-cloud-messaging-push-scope') with script ('https://chauat-go-i5ec.vercel.app/firebase-messaging-sw.js'): A bad HTTP response code (404) was received when fetching the script. (messaging/failed-service-worker-registration)."));
    }
  };
  const app = {
    _delegate: {
      container: {
        getProvider: function (name) {
          assert.equal(name, 'messaging-internal');
          return {
            getImmediate: function () { return null; },
            get: function () { return Promise.resolve(internal); }
          };
        }
      }
    }
  };
  const sandbox = loadFcm(function () { throw new Error('public getToken unused'); });
  sandbox.ChauatFcm.disarm(app);
  await new Promise((resolve) => setTimeout(resolve, 0));
  async function getMessagingToken() {
    try { return internal.getToken(); }
    catch (e) { return 'sync'; }
  }
  assert.equal(await getMessagingToken(), undefined);
  assert.equal(called, 0);
  assert.equal(internal.__chauatSafe, true);
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

test('food, ride, express, and shopping share one messaging-free order post', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.equal(html.includes("httpsCallable('createOrder')"), false);
  assert.equal((html.match(/function createServerOrder/g) || []).length, 1);
  assert.equal((html.match(/await createServerOrder\(/g) || []).length, 5);
  assert.equal((html.match(/await postCreateOrder\(body\)/g) || []).length, 1);
  assert.ok(html.includes("'.cloudfunctions.net/createOrder'"));
  assert.ok(html.includes("var region = 'asia-southeast1'"));
  assert.ok(html.indexOf('ChauatFcm.warm(firebaseApp)') > html.indexOf('await postCreateOrder(body)'));
  assert.ok(html.includes('if (!retried && messagingSwError(err)) return createServerOrder(payload, true)'));
  assert.equal(html.includes('firebase.messaging(firebaseApp)'), false);
  assert.equal(html.includes('ChauatFcm.install(firebaseApp)'), false);
  const orderStart = html.indexOf('async function createServerOrder');
  const orderEnd = html.indexOf('/* ⭐ v3.9.0: confirmCheckout');
  const orderFn = html.slice(orderStart, orderEnd);
  assert.equal(orderFn.includes('httpsCallable('), false);
  assert.equal(orderFn.includes('firebase.messaging'), false);
});

test('default FCM worker is real JavaScript and does not take over the page', () => {
  const sw = fs.readFileSync('firebase-messaging-sw.js', 'utf8');
  const appSw = fs.readFileSync('sw.js', 'utf8');
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.match(sw, /importScripts\('https:\/\/www\.gstatic\.com\/firebasejs\/9\.22\.0\/firebase-messaging-compat\.js'\)/);
  assert.match(sw, /firebase\.messaging\(\)\.onBackgroundMessage/);
  assert.equal(sw.includes('clients.claim'), false);
  assert.equal(sw.includes('skipWaiting'), false);
  assert.equal(sw.includes('caches.'), false);
  assert.equal(sw.includes("addEventListener('fetch'"), false);
  assert.match(appSw, /\/firebase-messaging-sw\.js/);
  assert.match(appSw, /chauat-app-v3\.9\.37/);
  const header = vercel.headers.find((item) => item.source === '/firebase-messaging-sw.js');
  assert.ok(header);
  const contentType = header.headers.find((item) => item.key === 'Content-Type');
  assert.match(contentType.value, /application\/javascript/);
});
