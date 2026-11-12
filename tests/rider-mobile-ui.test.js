const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const html = fs.readFileSync('rider.html', 'utf8');
const css = fs.readFileSync('rider.css', 'utf8');
const js = fs.readFileSync('rider.js', 'utf8');

test('rider phone header is one row and the theme control is not floating', () => {
  const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
  assert.match(header, /id="rider-name"/);
  assert.match(header, /id="trust-badge"/);
  assert.match(header, /id="online-toggle-btn"/);
  assert.match(header, /id="theme-fab"/);
  assert.equal(html.includes('class="theme-fab"'), false);
  assert.match(css, /#app \.app-header \{\s*display: flex;/);
  assert.match(css, /border-radius: 0;/);
  assert.match(css, /\.header-theme \{\s*position: static;/);
});

test('an active job sits above earnings and the money label is not a single clipped word', () => {
  const activeAt = html.indexOf('id="active-job-section"');
  const heroAt = html.indexOf('class="hero-card"');
  assert.ok(activeAt > 0 && activeAt < heroAt);
  assert.match(html, /ต้องโอนก่อน/);
  assert.match(html, /21:00/);
  assert.equal(html.includes('ต้องโอน 3 ทุ่ม'), false);
  assert.match(css, /#app \.hero-amount \{\s*color: #fff;/);
  assert.match(css, /#app \.hero-grid-cell\.warn \.lbl,\s*#app \.hero-grid-cell\.warn \.val \{\s*color: #fff;/);
  assert.equal(css.includes('color: #FF9800;\n  text-shadow: 0 1px 0 #000'), false);
  assert.match(css, /#app\.has-active-job \.hero-grid/);
  assert.match(js, /has-active-job/);
});

test('filters are equal width and the rider chat badge stays off the shop thread', () => {
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow: hidden !important/);
  assert.match(html, /กรองเฉพาะงานใหม่/);
  assert.match(js, /data-chat-badge/);
  assert.match(js, /data\.thread === 'shop'/);
  assert.match(js, /thread: 'rider'/);
});
