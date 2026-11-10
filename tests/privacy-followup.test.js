const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rules = fs.readFileSync('firestore.rules', 'utf8');
const merchant = fs.readFileSync('merchant.js', 'utf8');
const admin = fs.readFileSync('admin.js', 'utf8');
const appCheck = fs.readFileSync('app-check.js', 'utf8');
const env = fs.readFileSync('functions/.env', 'utf8');
const orders = fs.readFileSync('functions/orders.js', 'utf8');

test('public shops stay listable and finance lives under private/profile', () => {
  assert.match(rules, /allow read: if resource\.data\.get\('verified', false\) == true \|\| isAuth\(\)/);
  assert.match(rules, /match \/private\/\{docId\}/);
  assert.match(rules, /allow read: if isAdmin\(\) \|\| \(isAuth\(\) && myUid\(\) == merchantId\)/);
  assert.match(merchant, /collection\('private'\)\.doc\('profile'\)/);
  assert.match(merchant, /phone: phone/);
  assert.doesNotMatch(merchant.slice(merchant.indexOf("collection('merchants').doc(createdUser.uid).set"), merchant.indexOf("collection('private')")), /gpPending/);
  assert.match(admin, /collection\('private'\)\.doc\('profile'\)/);
  assert.match(orders, /collection\('private'\)\.doc\('profile'\)/);
});

test('a cash customer cannot set the paid flag', () => {
  const paid = rules.slice(rules.indexOf('function customerPaidOk'), rules.indexOf('function expressFarePaidOk'));
  assert.match(paid, /!= 'cash'/);
  assert.match(paid, /customerSlipNotRejected\(\)/);
});

test('App Check enforcement stays off until the operator flips the flag', () => {
  assert.match(env, /APP_CHECK_ENFORCE=false/);
  assert.match(appCheck, /FIREBASE_APPCHECK_DEBUG_TOKEN = true/);
  assert.match(appCheck, /localhost/);
  assert.doesNotMatch(appCheck, /debug token secret/i);
});
