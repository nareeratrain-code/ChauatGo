const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const rider = fs.readFileSync('rider.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest-customer.json', 'utf8'));
const rules = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const env = fs.readFileSync('functions/.env', 'utf8');

test('customer manifest starts at / and the page links an apple touch icon', () => {
  assert.equal(manifest.start_url, '/');
  assert.match(indexHtml, /manifest-customer\.json/);
  assert.match(indexHtml, /apple-touch-icon/);
  assert.equal(JSON.parse(fs.readFileSync('manifest.json', 'utf8')).start_url, '/admin.html');
});

test('notification clicks follow data.type', () => {
  assert.match(sw, /function notificationPath/);
  assert.match(sw, /near_customer/);
  assert.match(sw, /food_ready/);
  assert.match(indexHtml, /type: 'near_customer'/);
});

test('clients use the order callables and drop the unused fee constants', () => {
  assert.equal(indexHtml.includes("collection('orders').add"), false);
  assert.match(indexHtml, /httpsCallable\('createOrder'\)/);
  assert.match(indexHtml, /function checkoutErrorText/);
  assert.match(indexHtml, /showToast\(checkoutErrorText\(e\), 'error'\)/);
  assert.match(rider, /completeOrder/);
  assert.equal(rider.includes('SERVICE_BASE'), false);
  assert.equal(rider.includes('FREE_KM'), false);
  assert.match(rider, /where\('riderId', '==', null\)/);
});

test('storage rules are wired and App Check stays off', () => {
  assert.equal(firebaseJson.storage.rules, 'storage.rules');
  assert.match(storage, /gp_slips/);
  assert.match(storage, /match \/chats\/\{chatId\}\/images\/\{fileName\}/);
  assert.match(rules, /สิชล/);
  assert.match(rules, /allow create: if false/);
  assert.match(rules, /unchanged\('totalIncome'\)/);
  assert.match(env, /APP_CHECK_ENFORCE=false/);
  assert.equal(env.includes('เหล่าเต๊ง'), false);
});
