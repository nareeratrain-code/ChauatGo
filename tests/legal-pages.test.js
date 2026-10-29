const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const privacy = fs.readFileSync('privacy.html', 'utf8');
const terms = fs.readFileSync('terms.html', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('privacy page names the data, Firebase storage, retention, and rights', () => {
  assert.match(privacy, /นโยบายความเป็นส่วนตัว/);
  assert.match(privacy, /ชื่อ/);
  assert.match(privacy, /เบอร์โทรศัพท์/);
  assert.match(privacy, /GPS/);
  assert.match(privacy, /แชท/);
  assert.match(privacy, /สลิป/);
  assert.match(privacy, /ประวัติคำสั่งซื้อ/);
  assert.match(privacy, /Firebase/);
  assert.match(privacy, /Cloud Firestore/);
  assert.match(privacy, /Cloud Storage/);
  assert.match(privacy, /ระยะเวลาเก็บ/);
  assert.match(privacy, /เข้าถึง/);
  assert.match(privacy, /ลบ/);
  assert.match(privacy, /ChauatGoDelivery/);
  assert.match(privacy, /mailto:adminchauatgo@gmail.com/);
  assert.equal(privacy.includes('[ชื่อผู้ให้บริการ]'), false);
  assert.equal(privacy.includes('[อีเมลติดต่อ]'), false);
  assert.match(privacy, /href="\/terms"/);
});

test('terms page states the platform rules, fee split, and limits', () => {
  assert.match(terms, /เงื่อนไขการใช้บริการ/);
  assert.match(terms, /แพลตฟอร์ม/);
  assert.match(terms, /ไม่ได้สังกัด ChauatGo/);
  assert.match(terms, /ตรวจเองว่าร้านเปิด/);
  assert.match(terms, /ยังต้องชำระค่าบริการ/);
  assert.match(terms, /จ่ายตรงให้ไรเดอร์/);
  assert.match(terms, /80%/);
  assert.match(terms, /20%/);
  assert.match(terms, /การยกเลิก/);
  assert.match(terms, /ความรับผิด/);
  assert.match(terms, /การใช้งานที่ห้าม/);
  assert.match(terms, /ChauatGoDelivery/);
  assert.match(terms, /mailto:adminchauatgo@gmail.com/);
  assert.equal(terms.includes('[ชื่อผู้ให้บริการ]'), false);
  assert.equal(terms.includes('[อีเมลติดต่อ]'), false);
  assert.match(terms, /href="\/privacy"/);
});

test('clean privacy and terms URLs rewrite to their pages', () => {
  const routes = {};
  (vercel.rewrites || []).forEach((rule) => { routes[rule.source] = rule.destination; });
  assert.equal(routes['/privacy'], '/privacy.html');
  assert.equal(routes['/terms'], '/terms.html');
  assert.match(sw, /function legalPage\(pathname\)/);
  assert.match(sw, /\/privacy\.html/);
  assert.match(sw, /\/terms\.html/);
  assert.equal(sw.includes('chauat-app-v3.9.48'), true);
});

test('the app links privacy and terms from settings, signup, footer, and the shop disclaimer', () => {
  assert.match(index, /href="\/privacy"/);
  assert.match(index, /href="\/terms"/);
  assert.match(index, /class="home-legal"/);
  assert.match(index, /class="auth-legal"/);
  assert.match(index, /id="shop-disclaimer-ack"/);
  const disclaimer = index.slice(index.indexOf('id="shop-disclaimer-ack"'), index.indexOf('id="shop-disclaimer-ack"') + 500);
  assert.match(disclaimer, /href="\/terms"/);
});
