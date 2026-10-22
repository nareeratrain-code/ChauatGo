const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const csp = config.headers
  .flatMap((group) => group.headers || [])
  .find((header) => header.key === 'Content-Security-Policy').value;

function directive(name) {
  const part = csp.split(';').map((item) => item.trim()).find((item) => item.startsWith(name + ' '));
  assert.ok(part, 'missing ' + name);
  return part;
}

test('reCAPTCHA and fonts are allowed', () => {
  const script = directive('script-src');
  const style = directive('style-src');
  const font = directive('font-src');
  const connect = directive('connect-src');
  const frame = directive('frame-src');
  ['https://www.google.com', 'https://www.gstatic.com', 'https://www.recaptcha.net', 'https://unpkg.com', 'https://cdn.jsdelivr.net'].forEach((host) => {
    assert.ok(script.includes(host), script);
  });
  assert.ok(style.includes('https://fonts.googleapis.com'));
  assert.ok(font.includes('https://fonts.gstatic.com'));
  ['https://www.google.com', 'https://www.gstatic.com', 'https://www.recaptcha.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].forEach((host) => {
    assert.ok(connect.includes(host), host);
    if (!host.includes('fonts')) assert.ok(frame.includes(host) || frame.includes('https://*.google.com'), host);
  });
});

test('Firebase, maps, functions, and storage hosts stay allowed', () => {
  const connect = directive('connect-src');
  [
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://*.firebasestorage.app',
    'https://*.cloudfunctions.net',
    'https://*.run.app',
    'https://nominatim.openstreetmap.org',
    'https://tile.openstreetmap.org',
    'wss://*.firebaseio.com'
  ].forEach((host) => assert.ok(connect.includes(host), host));
  assert.ok(directive('img-src').includes('https:'));
  assert.ok(directive('script-src').includes('https://unpkg.com'));
  assert.ok(directive('style-src').includes('https://unpkg.com'));
  assert.ok(directive('worker-src').includes('blob:'));
});
