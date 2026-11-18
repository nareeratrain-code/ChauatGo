const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('Admin loads the Functions compat SDK before admin.js', () => {
  const functionsSdk = 'firebase-functions-compat.js';
  assert.ok(html.indexOf(functionsSdk) >= 0, 'Functions compat SDK is missing');
  assert.ok(html.indexOf(functionsSdk) < html.indexOf('admin.js'), 'Functions SDK must load before admin.js');
});

test('Admin emulator mode connects Auth, Firestore, Storage, and Functions', () => {
  assert.match(admin, /adminQuery\.get\(['"]emulator['"]\)\s*===\s*['"]1['"]/);
  assert.match(admin, /auth\.useEmulator\(['"]http:\/\/127\.0\.0\.1:9099['"]\)/);
  assert.match(admin, /db\.useEmulator\(['"]127\.0\.0\.1['"],\s*8080\)/);
  assert.match(admin, /storage\.useEmulator\(['"]127\.0\.0\.1['"],\s*9199\)/);
  assert.match(admin, /functionsApi\.useEmulator\(['"]127\.0\.0\.1['"],\s*5001\)/);
});

test('Admin fails closed on localhost unless emulator mode is explicit', () => {
  assert.match(admin, /adminLocalhost\s*&&\s*!useAdminEmulators/);
  assert.match(admin, /Admin Localhost is blocked unless \?emulator=1 is present/);
});

test('Admin disables App Check while using local emulators', () => {
  assert.match(admin, /ChauatAppCheck\.start\(firebaseApp\)/);
  assert.match(admin, /!useAdminEmulators/);
});
