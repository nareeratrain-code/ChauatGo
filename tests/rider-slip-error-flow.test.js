const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('rider.js', 'utf8');

function loadErrorText() {
  const start = source.indexOf('function riderFirebaseErrorText');
  const end = source.indexOf('\n}\n\nfunction openSlipRejectModal', start) + 2;
  const context = {};
  vm.runInNewContext(source.slice(start, end), context);
  return context.riderFirebaseErrorText;
}

test('Rider shop slip: ไม่มีไฟล์ต้องเตือนและไม่เริ่มอัปโหลด', () => {
  const start = source.indexOf('async function submitShopSlip');
  const guard = source.slice(start, source.indexOf("const btn = $('pickup-confirm-btn')", start));
  assert.match(guard, /if \(!pickupSlipBlob\) return showToast\('⚠️ กรุณาแนบสลิปที่จ่ายร้าน'/);
});

test('Rider shop slip: map error เป็นข้อความแก้ไขได้และเปิดปุ่มลองใหม่', () => {
  const errorText = loadErrorText();
  assert.equal(errorText({ code: 'storage/unauthorized' }, 'fallback'), 'ไม่มีสิทธิ์อัปโหลดไฟล์นี้ — ตรวจสอบบัญชีและไฟล์ แล้วลองใหม่');
  assert.equal(errorText({ code: 'permission-denied' }, 'fallback'), 'ไม่มีสิทธิ์ทำรายการนี้ — ตรวจสอบว่าเป็นงานที่มอบหมายให้คุณและสถานะออเดอร์ถูกต้อง');
  assert.equal(errorText({ code: 'failed-precondition' }, 'fallback'), 'สถานะออเดอร์เปลี่ยนแล้ว — รีเฟรชรายการก่อนลองใหม่');
  assert.equal(errorText({ code: 'unavailable' }, 'fallback'), 'เชื่อมต่อระบบไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  assert.equal(errorText({ code: 'not-found' }, 'fallback'), 'ไม่พบออเดอร์นี้แล้ว — รีเฟรชรายการ');
});

test('Rider shop slip: หลังอัปโหลดล้มเหลวคืนปุ่มเพื่อแนบไฟล์ใหม่', () => {
  const start = source.indexOf('async function submitShopSlip');
  const end = source.indexOf('\n}\n\n/* Express, shopping', start) + 2;
  const block = source.slice(start, end);
  assert.match(block, /showToast\(riderFirebaseErrorText\(err, 'อัปโหลดสลิปไม่สำเร็จ'\), 'error'\)/);
  assert.match(block, /btn\.disabled = false/);
  assert.match(block, /btn\.textContent = '🧾 ส่งสลิปให้ลูกค้า'/);
});
