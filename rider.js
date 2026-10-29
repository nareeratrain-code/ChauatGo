/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO RIDER — v3.9.1
   Full-featured Production JavaScript
   
   ✅ v3.9.1: รองรับ status "ready" + "searching"
   ✅ v3.9.1: ถ่ายรูปอาหาร + สลิปบังคับ
   ✅ v3.9.1: รอ customer_paid ก่อนเริ่มส่ง
   ✅ v3.9.1: Timeout 5/15 นาที
   ✅ v3.9.1: Chat + GPS + Sound
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   1. FIREBASE CONFIG
   ═══════════════════════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM",
  authDomain: "chauat-go-b9841.firebaseapp.com",
  projectId: "chauat-go-b9841",
  storageBucket: "chauat-go-b9841.firebasestorage.app",
  messagingSenderId: "282197694521",
  appId: "1:282197694521:web:0528c22747a0c04bd815e8"
};

const riderDevQuery = new URLSearchParams(window.location.search);
const riderDevHost = window.location.hostname || '';
const riderPrivateHost = riderDevHost === 'localhost'
  || riderDevHost === '127.0.0.1'
  || /^10\./.test(riderDevHost)
  || /^192\.168\./.test(riderDevHost)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(riderDevHost);
const useRiderEmulators = riderDevQuery.get('emulator') === '1' && riderPrivateHost;
const riderEmulatorHost = riderPrivateHost && riderDevHost !== 'localhost' && riderDevHost !== '127.0.0.1'
  ? riderDevHost : '127.0.0.1';
const firebaseApp = firebase.apps.find(a => a.name === 'rider') || firebase.initializeApp(firebaseConfig, 'rider');
if (window.ChauatAppCheck && !useRiderEmulators) ChauatAppCheck.start(firebaseApp);
const auth = firebase.auth(firebaseApp);
const db = firebase.firestore(firebaseApp);
const storage = firebase.storage(firebaseApp);
if (useRiderEmulators) {
  auth.useEmulator('http://' + riderEmulatorHost + ':9099');
  db.useEmulator(riderEmulatorHost, 8080);
  storage.useEmulator(riderEmulatorHost, 9199);
  console.warn('[ChauatGo DEV] Rider connected to Firebase Emulators at ' + riderEmulatorHost);
}
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

console.log('%c🛵 Chauat Go Rider v3.9.1', 'color:#FF6B35;font-weight:900;font-size:14px');

/* ═══════════════════════════════════════════════════════════════════
   2. GLOBAL STATE
   ═══════════════════════════════════════════════════════════════════ */
let currentUser = null;
let riderProfile = null;
var allJobs = [];
let allHistory = [];
let riderJobMap = null;
let myProfileUnsub = null;
let myJobsUnsub = null;
let myHistoryUnsub = null;
let activeChatId = null;
let activeChatUnsub = null;
let activeChatPartnerPhone = null;
let activeChatPartnerName = null;
let newJobPopupId = null;
let seenJobIds = new Set();
let audioCtx = null;
let gpsWatchId = null;
let gpsUploadTimer = null;
let lastGpsUpload = 0;
let dispatchUnsub = null;
let offerUnsub = null;
let openUnsubs = [];
let myActiveUnsub = null;
let dispatchConfig = { mode: 'manual' };
let openJobs = [];
let activeMine = [];
let currentOffer = null;
let offerTick = null;
let acceptingOffer = false;
const hiddenOfferIds = new Set();
const offerDeadlines = new Map();
let isOnline = false;
let jobFilter = 'all';
let currentHistoryFilter = 'all';
let cameraFile = null;
let nearNotifiedOrderIds = new Set();
let arrivedShopNotifiedOrderIds = new Set();
let arrivedCustomerNotifiedOrderIds = new Set();
const autoChatSent = new Set();
let isSigningUp = false;
let authEpoch = 0;
let activeChatCallRole = 'customer';

if (window.ChauatCall) {
  ChauatCall.boot({
    role: 'rider',
    getDb: function () { return db; },
    getUid: function () { return currentUser ? currentUser.uid : ''; },
    onChange: function () { if (currentUser) renderJobs(); }
  });
}

/* อาหาร: รับได้หลังร้านรับ (cooking/ready) เท่านั้น
   เรียกรถ/ส่งด่วน/ฝากซื้อ: ไม่มีร้าน รับจาก searching ได้ */
const RIDER_CLAIM_STATUSES = ['cooking', 'ready'];
const RIDER_OPEN_STATUSES = ['searching', 'pending', 'cooking', 'ready'];
// picked_up counts. "รอลูกค้าโอนเงิน" is this status on a transfer order:
// goods are in hand, delivery has not started. done/delivered do not count.
const RIDER_ACTIVE_STATUSES = ['accepted', 'picked_up', 'customer_paid', 'on_the_way'];

function orderNeedsKitchen(j) {
  return !!(j && j.type === 'food' && j.partnerShop === true);
}

function orderFoodReady(j) {
  return !!(j && (j.foodReady || j.readyAt || j.status === 'ready'));
}

function orderHasShopSlip(order) {
  return String((order && (order.riderSlipToShop || order.riderSlipUrl)) || '').trim().length > 0;
}

/* Food leaves the shop only after the shop-payment slip is on the order.
   Transfer still waits for the customer's payment. Cash is collected on delivery. */
function canLeaveShop(order) {
  if (!order) return false;
  if (orderNeedsKitchen(order) && !orderHasShopSlip(order)) return false;
  if (order.paymentMode === 'cash') return true;
  return !!(order.customerPaidAt || order.status === 'customer_paid');
}

/* Transfer can be confirmed by the assigned rider before pickup or while
   the card is waiting. Cash is collected on delivery, so it has no button. */
function riderMayConfirmPay(j) {
  if (!j || orderIsCash(j) || !j.riderId) return false;
  if (j.customerPaidAt || j.status === 'customer_paid') return false;
  return j.status === 'accepted' || j.status === 'ready' || j.status === 'picked_up';
}

function payReceivedButton(id) {
  return `<button type="button" class="jc-primary-btn jc-green" data-paid="${esc(id)}">💳 ลูกค้าโอนแล้ว / ได้รับเงินแล้ว</button>`;
}

function dispatchMode() {
  return dispatchConfig && dispatchConfig.mode === 'auto' ? 'auto' : 'manual';
}

function riderMayClaim(j) {
  if (dispatchMode() === 'auto') return false;
  if (!j || j.riderId) return false;
  if (orderNeedsKitchen(j)) return RIDER_CLAIM_STATUSES.includes(j.status);
  return RIDER_OPEN_STATUSES.includes(j.status);
}
let foodReadySeen = null;

/* ⭐ v3.9.1: Timers */
let paymentTimeout5 = null;
let paymentTimeout15 = null;

/* ⭐ v3.9.1: Modal upload state */
let pickupFoodBlob = null;
let pickupSlipBlob = null;
let pickupFoodUrl = null;
let pickupSlipUrl = null;
let pickupOrderId = null;

/* ═══════════════════════════════════════════════════════════════════
   3. CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */
const RIDER_SHARE = 0.80;
const PLATFORM_SHARE = 0.20;
const CASH_TIP = 5;
const ARRIVAL_RADIUS_M = 300;
const NEAR_CUSTOMER_RADIUS_M = 300;
const CUSTOMER_ARRIVAL_RADIUS_M = 50;
const AUTO_CHAT_BY_TYPE = {
  food: {
    accepted: 'สวัสดีครับ/ค่ะ ลูกค้า 🙏\nไรเดอร์รับงานแล้ว และกำลังเดินทางไปที่ร้านเพื่อรับอาหารของลูกค้าครับ/ค่ะ\nกรุณารอรับสายจากไรเดอร์ด้วยนะครับ/ค่ะ',
    shop_arrived: '📍 ไรเดอร์ถึงร้านแล้วครับ/ค่ะ\nกำลังถ่ายรูปอาหารเพื่อส่งให้ลูกค้าตรวจสอบครับ/ค่ะ',
    on_the_way: '🚀 ไรเดอร์รับอาหารจากร้านแล้ว และกำลังนำอาหารไปส่งครับ/ค่ะ\nกรุณากดเปิดเสียงแจ้งเตือนไว้ เมื่อไรเดอร์ใกล้ถึงจะมีข้อความแจ้งครับ/ค่ะ',
    near_customer: '🔔 ไรเดอร์อยู่ห่างจากจุดส่งอาหารประมาณ 300 เมตรแล้วครับ/ค่ะ\nกรุณาเตรียมรับอาหารนะครับ/ค่ะ',
    arrived_customer: '📍 ไรเดอร์ถึงจุดส่งอาหารแล้วครับ/ค่ะ\nกรุณารับสายหรือออกมารับอาหารด้วยนะครับ/ค่ะ',
    delivered: '✅ ส่งอาหารเรียบร้อยแล้วครับ/ค่ะ\nขอบคุณที่ใช้บริการ Chauat Go ก่อนจบงานกรุณากดให้คะแนนความพึงพอใจและประเมินการบริการของไรเดอร์ด้วยนะครับ/ค่ะ ⭐',
    shop_slip: '🧾 ไรเดอร์โอนค่าอาหารให้ร้านแล้วครับ/ค่ะ\nนี่คือสลิปที่โอนให้ร้านครับ/ค่ะ'
  },
  express: {
    accepted: 'สวัสดีครับ/ค่ะ ลูกค้า 🙏\nไรเดอร์รับงานส่งด่วนแล้ว และกำลังเดินทางไปรับพัสดุครับ/ค่ะ\nกรุณารอรับสายจากไรเดอร์ด้วยนะครับ/ค่ะ',
    shop_arrived: '📍 ไรเดอร์ถึงจุดรับพัสดุแล้วครับ/ค่ะ\nกำลังรับของ และจะเดินทางไปส่งตามปลายทางครับ/ค่ะ',
    picked_up: '✅ ไรเดอร์รับพัสดุแล้วครับ/ค่ะ\nกำลังเดินทางไปส่งตามปลายทางครับ/ค่ะ',
    on_the_way: '🚀 ไรเดอร์กำลังนำพัสดุไปส่งครับ/ค่ะ\nกรุณากดเปิดเสียงแจ้งเตือนไว้ เมื่อไรเดอร์ใกล้ถึงจะมีข้อความแจ้งครับ/ค่ะ',
    near_customer: '🔔 ไรเดอร์อยู่ห่างจากจุดส่งพัสดุประมาณ 300 เมตรแล้วครับ/ค่ะ\nกรุณาเตรียมรับของนะครับ/ค่ะ',
    arrived_customer: '📍 ไรเดอร์ถึงจุดส่งพัสดุแล้วครับ/ค่ะ\nกรุณารับสายหรือออกมารับพัสดุด้วยนะครับ/ค่ะ',
    delivered: '✅ ส่งพัสดุเรียบร้อยแล้วครับ/ค่ะ\nขอบคุณที่ใช้บริการ Chauat Go ก่อนจบงานกรุณากดให้คะแนนความพึงพอใจและประเมินการบริการของไรเดอร์ด้วยนะครับ/ค่ะ ⭐'
  },
  shopping: {
    accepted: 'สวัสดีครับ/ค่ะ ลูกค้า 🙏\nไรเดอร์รับงานแล้ว และกำลังเดินทางไปยังร้านหรือสถานที่ที่ลูกค้าปักหมุดไว้เพื่อซื้อของให้ครับ/ค่ะ\nกรุณารอรับสายจากไรเดอร์ด้วยนะครับ/ค่ะ',
    shop_arrived: '📍 ไรเดอร์ถึงร้านหรือสถานที่ที่ปักหมุดแล้วครับ/ค่ะ\nกรุณาเตรียมรับสาย เพื่อยืนยันรายการฝากซื้อ และเตรียมโอนเงินค่าอาหารหรือค่าสินค้าให้ไรเดอร์ครับ/ค่ะ',
    picked_up: '✅ ไรเดอร์ซื้อของตามรายการฝากซื้อเรียบร้อยแล้วครับ/ค่ะ\nกำลังเดินทางไปส่งตามที่อยู่ลูกค้าครับ/ค่ะ',
    on_the_way: '🚀 ไรเดอร์กำลังนำของฝากซื้อไปส่งครับ/ค่ะ\nกรุณากดเปิดเสียงแจ้งเตือนไว้ เมื่อไรเดอร์ใกล้ถึงจะมีข้อความแจ้งครับ/ค่ะ',
    near_customer: '🔔 ไรเดอร์อยู่ห่างจากจุดส่งของฝากซื้อประมาณ 300 เมตรแล้วครับ/ค่ะ\nกรุณาเตรียมรับของนะครับ/ค่ะ',
    arrived_customer: '📍 ไรเดอร์ถึงจุดส่งของฝากซื้อแล้วครับ/ค่ะ\nกรุณารับสายหรือออกมารับของด้วยนะครับ/ค่ะ',
    delivered: '✅ ส่งของฝากซื้อเรียบร้อยแล้วครับ/ค่ะ\nขอบคุณที่ใช้บริการ Chauat Go ก่อนจบงานกรุณากดให้คะแนนความพึงพอใจและประเมินการบริการของไรเดอร์ด้วยนะครับ/ค่ะ ⭐'
  },
  ride: {
    accepted: 'สวัสดีครับ/ค่ะ ลูกค้า 🙏\nไรเดอร์รับงานเรียกรถแล้ว และกำลังเดินทางไปรับลูกค้าครับ/ค่ะ\nกรุณารอรับสายจากไรเดอร์ด้วยนะครับ/ค่ะ',
    shop_arrived: '📍 ไรเดอร์ถึงจุดรับแล้วครับ/ค่ะ\nกรุณาเตรียมออกมาพบไรเดอร์นะครับ/ค่ะ',
    picked_up: '✅ ไรเดอร์รับลูกค้าแล้ว และกำลังเดินทางไปยังปลายทางครับ/ค่ะ',
    on_the_way: '🚀 ไรเดอร์กำลังเดินทางไปยังปลายทางครับ/ค่ะ',
    near_customer: '🔔 ไรเดอร์ใกล้ถึงปลายทางแล้วครับ/ค่ะ',
    arrived_customer: '📍 ไรเดอร์ถึงปลายทางแล้วครับ/ค่ะ',
    delivered: '✅ ถึงปลายทางเรียบร้อยแล้วครับ/ค่ะ\nขอบคุณที่ใช้บริการ Chauat Go ก่อนจบงานกรุณากดให้คะแนนความพึงพอใจและประเมินการบริการของไรเดอร์ด้วยนะครับ/ค่ะ ⭐'
  }
};

function orderServiceType(order) {
  const type = String((order && order.type) || '').trim();
  if (type === 'food' || type === 'express' || type === 'shopping' || type === 'ride') return type;
  return 'food';
}

function bahtText(n) {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) return '฿0';
  return '฿' + (Math.abs(v % 1) < 1e-9 ? String(Math.round(v)) : v.toFixed(2));
}

function foodAmountOf(order) {
  if (!order) return 0;
  if (order.foodTotal != null && order.foodTotal !== '') {
    const n = Number(order.foodTotal);
    if (Number.isFinite(n)) return n;
  }
  if (order.itemsTotal != null && order.itemsTotal !== '') {
    const n = Number(order.itemsTotal);
    if (Number.isFinite(n)) return n;
  }
  if (!Array.isArray(order.items)) return 0;
  return order.items.reduce((sum, item) => {
    const price = Number(item && (item.price != null ? item.price : item.originalPrice) || 0);
    const qty = Number(item && item.qty || 0);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
    return sum + price * qty;
  }, 0);
}

function foodPayParts(order) {
  const food = foodAmountOf(order);
  const fareRaw = Number(order && order.fare || 0);
  const fare = Number.isFinite(fareRaw) ? fareRaw : 0;
  const cash = !!(order && order.paymentMode === 'cash');
  let tip = 0;
  if (cash) {
    tip = order.cashTip != null ? Number(order.cashTip) || 0 : CASH_TIP;
  }
  if (!Number.isFinite(tip)) tip = 0;
  return {
    cash,
    food,
    fare,
    tip,
    total: Math.round((food + fare + tip) * 100) / 100
  };
}

function foodPayEquation(parts) {
  const food = 'ค่าอาหาร ' + bahtText(parts.food);
  const fare = 'ค่าส่ง ' + bahtText(parts.fare);
  const tip = parts.tip > 0 ? ' + ค่าบริการเงินสด ' + bahtText(parts.tip) : '';
  return food + ' + ' + fare + tip + ' = รวม ' + bahtText(parts.total);
}

function foodPhotoMessage(order) {
  const parts = foodPayParts(order);
  const amounts = foodPayEquation(parts);
  if (parts.cash) {
    return '📸 ไรเดอร์ถ่ายรูปอาหารจากร้านแล้วครับ/ค่ะ\nกรุณาเตรียมเงินสดจ่ายไรเดอร์ตอนรับอาหารครับ/ค่ะ\n' + amounts;
  }
  return '📸 ไรเดอร์ถ่ายรูปอาหารจากร้านแล้วครับ/ค่ะ\nกรุณาโอนเงินให้ไรเดอร์ตามยอดนี้ครับ/ค่ะ\n' + amounts;
}

function autoChatText(order, key) {
  const type = orderServiceType(order);
  if (type === 'food' && (key === 'food_photo' || key === 'picked_up')) return foodPhotoMessage(order);
  const pack = AUTO_CHAT_BY_TYPE[type];
  return (pack && pack[key]) || '';
}
const MAX_SLIP_SIZE = 5 * 1024 * 1024;
const PAYMENT_TIMEOUT_5MIN = 5 * 60 * 1000;
const PAYMENT_TIMEOUT_15MIN = 15 * 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════
   4. HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const toDate = (t) => {
  if (!t) return null;
  const d = t.toDate ? t.toDate() : new Date(t);
  return isNaN(d) ? null : d;
};

const fmtTime = (t) => { const d = toDate(t); return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'; };
const fmtDate = (t) => { const d = toDate(t); return d ? d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'; };
const fmtDateTime = (t) => `${fmtDate(t)} ${fmtTime(t)}`;

const timeAgo = (t) => {
  const d = toDate(t);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'เมื่อกี้';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(diff / 86400)} วันที่แล้ว`;
};

const isToday = (t) => { const d = toDate(t); return d ? d.toDateString() === new Date().toDateString() : false; };

const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/* ═══════════════════════════════════════════════════════════════════
   5. THEME
   ═══════════════════════════════════════════════════════════════════ */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chauat_rider_theme', next);
  const fab = $('theme-fab');
  if (fab) fab.textContent = next === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#0F1419' : '#FF6B35';
  showToast(next === 'dark' ? '🌙 โหมดมืด' : '☀️ โหมดสว่าง', 'info');
}

function initTheme() {
  const theme = localStorage.getItem('chauat_rider_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const fab = $('theme-fab');
  if (fab) fab.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ═══════════════════════════════════════════════════════════════════
   6. SPLASH
   ═══════════════════════════════════════════════════════════════════ */
function runSplash() {
  const bar = $('splash-bar');
  if (!bar) { dismissSplash(); return; }
  const safetyTimer = setTimeout(dismissSplash, 3000);
  let progress = 0;
  const interval = setInterval(() => {
    progress += 15 + Math.random() * 15;
    if (progress >= 100) {
      progress = 100;
      clearInterval(interval);
      clearTimeout(safetyTimer);
      setTimeout(dismissSplash, 300);
    }
    bar.style.width = progress + '%';
  }, 150);
}

function dismissSplash() {
  const splash = $('splash-screen');
  if (!splash) return;
  splash.classList.add('hidden');
  setTimeout(() => {
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
  }, 600);
}

/* ═══════════════════════════════════════════════════════════════════
   7. TOAST & SOUND
   ═══════════════════════════════════════════════════════════════════ */
function showToast(msg, type = 'success', duration = 3000) {
  const t = $('toast');
  if (!t) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  t.textContent = (icons[type] || '') + ' ' + msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, duration);
}

const SOUND_PREFS_KEY = 'chauat_rider_alert_sound';
const ALERT_TONES = {
  bell: { label: 'กระดิ่ง', wave: 'triangle', peak: 0.22, steps: [[880, 0.16], [1175, 0.16], [1568, 0.24]] },
  chime: { label: 'เสียงติ๊ง', wave: 'triangle', peak: 0.2, steps: [[523, 0.13], [659, 0.13], [784, 0.13], [1047, 0.22]] },
  urgent: { label: 'เร่งด่วน', wave: 'square', peak: 0.1, steps: [[784, 0.1], [988, 0.1], [784, 0.1], [1175, 0.18]] },
  knock: { label: 'เคาะประตู', wave: 'square', peak: 0.14, steps: [[196, 0.09], [0, 0.07], [164, 0.1], [0, 0.08], [247, 0.14]] }
};
let alertGain = null;
let alertTimer = null;
let alertUntil = 0;
let alertJobId = null;
let audioUnlocked = false;

function loadSoundPrefs() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(SOUND_PREFS_KEY) || '{}') || {}; } catch (e) {}
  const volume = Math.max(0, Math.min(100, Number(raw.volume)));
  return {
    on: raw.on !== false,
    tone: ALERT_TONES[raw.tone] ? raw.tone : 'bell',
    volume: Number.isFinite(volume) ? volume : 80
  };
}

function saveSoundPrefs(prefs) {
  const next = {
    on: !!prefs.on,
    tone: ALERT_TONES[prefs.tone] ? prefs.tone : 'bell',
    volume: Math.max(0, Math.min(100, Number(prefs.volume) || 0))
  };
  localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(next));
  applySoundGain();
  syncSoundSettingsUI();
  return next;
}

function ensureAudioGraph(fromGesture) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    if (!fromGesture) return null;
    try { audioCtx = new Ctx(); }
    catch (e) { return null; }
  }
  if (!alertGain && audioCtx) {
    alertGain = audioCtx.createGain();
    alertGain.connect(audioCtx.destination);
  }
  applySoundGain();
  return audioCtx;
}

function applySoundGain() {
  if (!audioCtx || !alertGain) return;
  const prefs = loadSoundPrefs();
  const level = Math.max(0, Math.min(1, prefs.volume / 100));
  const now = audioCtx.currentTime || 0;
  alertGain.gain.cancelScheduledValues(now);
  alertGain.gain.setValueAtTime(level, now);
}

function showSoundBanner(show) {
  const el = $('sound-unlock-banner');
  if (!el) return;
  el.classList.toggle('show', !!show);
}

function updateRiderSoundStatus(icon, text, ready) {
  const iconEl = $('rider-sound-icon');
  const textEl = $('rider-sound-text');
  const card = $('rider-sound-status');
  if (iconEl) iconEl.textContent = icon || '🔔';
  if (textEl) textEl.textContent = text || '';
  if (card) {
    card.style.background = ready ? '#EFF8F1' : '#FFF8E7';
    card.style.borderColor = ready ? '#CDE8D2' : '#F4D58A';
    card.style.color = ready ? '#1F5A2A' : '#765400';
  }
}

function unlockRiderAudio() {
  const ctx = ensureAudioGraph(true);
  if (!ctx) {
    showSoundBanner(true);
    return Promise.resolve(false);
  }
  let resume = Promise.resolve();
  if (ctx.state === 'suspended') {
    try { resume = ctx.resume() || Promise.resolve(); }
    catch (e) { resume = Promise.resolve(); }
  }
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(alertGain || ctx.destination);
    src.start(0);
  } catch (e) {}
  return Promise.resolve(resume).then(() => {
    audioUnlocked = ctx.state === 'running';
    showSoundBanner(!audioUnlocked);
    updateRiderSoundStatus(audioUnlocked ? '🔊' : '🔔', audioUnlocked ? 'เปิดเสียงแจ้งเตือนแล้ว • พร้อมรับงานใหม่' : 'แตะหน้าจอหนึ่งครั้งเพื่อเปิดเสียงแจ้งเตือนงานใหม่', audioUnlocked);
    if (audioUnlocked && alertJobId && Date.now() < alertUntil && !alertTimer) {
      const id = alertJobId;
      const remain = alertUntil;
      beginAlertLoop(id, remain);
    }
    return audioUnlocked;
  }).catch(() => {
    audioUnlocked = false;
    showSoundBanner(true);
    return false;
  });
}

function bindAudioUnlock() {
  const onGesture = () => { unlockRiderAudio(); };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('touchend', onGesture, true);
}

function playTone(freqs, interval = 0.15, duration = 0.18, volume = 0.35) {
  const ctx = ensureAudioGraph(false);
  if (!ctx || ctx.state !== 'running' || !alertGain) return;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(alertGain);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, ctx.currentTime + i * interval);
    const start = ctx.currentTime + i * interval;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.start(start);
    osc.stop(start + duration);
  });
}

function vibrateJob() {
  try {
    if (navigator.vibrate) navigator.vibrate([180, 90, 180, 90, 280]);
  } catch (e) {}
}

function playAlertBurst(toneId) {
  const ctx = ensureAudioGraph(false);
  if (!ctx || ctx.state !== 'running' || !alertGain) return false;
  const prefs = loadSoundPrefs();
  if (!prefs.on || prefs.volume <= 0) return false;
  applySoundGain();
  const tone = ALERT_TONES[toneId] || ALERT_TONES[prefs.tone] || ALERT_TONES.bell;
  let t = ctx.currentTime + 0.02;
  tone.steps.forEach(([freq, dur]) => {
    if (freq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(freq, t);
      osc.connect(gain);
      gain.connect(alertGain);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(tone.peak, t + Math.min(0.03, dur * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    t += dur;
  });
  return true;
}

function beginAlertLoop(jobId, until) {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = null;
  alertJobId = jobId || null;
  alertUntil = until;
  const tick = () => {
    alertTimer = null;
    if (!alertJobId || Date.now() >= alertUntil) {
      stopRepeatingAlert();
      return;
    }
    const live = loadSoundPrefs();
    if (!live.on || live.volume <= 0) {
      stopRepeatingAlert();
      return;
    }
    playAlertBurst(live.tone);
    vibrateJob();
    alertTimer = setTimeout(tick, 1500);
  };
  const prefs = loadSoundPrefs();
  if (prefs.on && prefs.volume > 0) playAlertBurst(prefs.tone);
  vibrateJob();
  alertTimer = setTimeout(tick, 1500);
}

function startRepeatingAlert(jobId) {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = null;
  const until = Date.now() + 20000;
  alertJobId = jobId || 'alert';
  alertUntil = until;
  const prefs = loadSoundPrefs();
  const ctx = ensureAudioGraph(false);
  const ready = !!(ctx && ctx.state === 'running' && audioUnlocked);
  if (!prefs.on || prefs.volume <= 0) {
    updateRiderSoundStatus('🔕', 'มีงานใหม่ แต่เสียงถูกปิดอยู่ • เปิดเสียงในเมนูไรเดอร์', false);
    vibrateJob();
    showSoundBanner(false);
    return;
  }
  if (!ready) {
    updateRiderSoundStatus('🔔', 'มีงานใหม่ • แตะปุ่มด้านบนเพื่อเปิดเสียงแจ้งเตือน', false);
    showSoundBanner(true);
    vibrateJob();
    return;
  }
  updateRiderSoundStatus('🚨', 'มีงานใหม่ • กำลังส่งเสียงและสั่นแจ้งเตือน', true);
  showSoundBanner(false);
  beginAlertLoop(alertJobId, until);
}

function startOfferAlert(offerId, expiresAtMs) {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = null;
  const until = Math.max(Date.now() + 1000, Number(expiresAtMs) || (Date.now() + 20000));
  alertJobId = offerId || 'offer';
  alertUntil = until;
  const prefs = loadSoundPrefs();
  const ctx = ensureAudioGraph(false);
  const ready = !!(ctx && ctx.state === 'running' && audioUnlocked);
  if (!prefs.on || prefs.volume <= 0) {
    vibrateJob();
    showSoundBanner(false);
    return;
  }
  if (!ready) {
    showSoundBanner(true);
    vibrateJob();
    return;
  }
  showSoundBanner(false);
  beginAlertLoop(alertJobId, until);
}

function stopRepeatingAlert() {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = null;
  alertJobId = null;
  alertUntil = 0;
  const prefs = loadSoundPrefs();
  updateRiderSoundStatus(
    !prefs.on || prefs.volume <= 0 ? '🔕' : (audioUnlocked ? '🔊' : '🔔'),
    !prefs.on || prefs.volume <= 0 ? 'เสียงแจ้งเตือนปิดอยู่ • เปิดได้จากเมนูไรเดอร์' : (audioUnlocked ? 'เปิดเสียงแจ้งเตือนแล้ว • พร้อมรับงานใหม่' : 'แตะหน้าจอหนึ่งครั้งเพื่อเปิดเสียงแจ้งเตือนงานใหม่'),
    !!(prefs.on && prefs.volume > 0 && audioUnlocked)
  );
}

function acknowledgeAlert(jobId) {
  if (!alertJobId) return;
  if (!jobId || alertJobId === jobId || alertJobId === 'alert') stopRepeatingAlert();
}

function soundNewJob() {
  playAlertBurst(loadSoundPrefs().tone);
  vibrateJob();
}

function testRiderSound() {
  unlockRiderAudio().then((ok) => {
    if (!ok) {
      showToast('ยังเปิดเสียงไม่ได้ ลองแตะอีกครั้ง', 'warning');
      return;
    }
    const prefs = loadSoundPrefs();
    if (!prefs.on) showToast('เสียงแจ้งเตือนปิดอยู่', 'info');
    if (!playAlertBurst(prefs.tone)) showToast('เปิดเสียงและเพิ่มความดังก่อน', 'warning');
  });
}

function syncSoundSettingsUI() {
  const prefs = loadSoundPrefs();
  const on = $('sound-enabled');
  const vol = $('sound-volume');
  const volLabel = $('sound-volume-label');
  if (on) on.checked = prefs.on;
  if (vol) vol.value = String(prefs.volume);
  if (volLabel) volLabel.textContent = prefs.volume + '%';
  document.querySelectorAll('[data-sound-tone]').forEach((btn) => {
    btn.classList.toggle('on', btn.getAttribute('data-sound-tone') === prefs.tone);
  });
  updateRiderSoundStatus(
    !prefs.on || prefs.volume <= 0 ? '🔕' : (audioUnlocked ? '🔊' : '🔔'),
    !prefs.on || prefs.volume <= 0 ? 'เสียงแจ้งเตือนปิดอยู่ • เปิดได้จากเมนูไรเดอร์' : (audioUnlocked ? 'เปิดเสียงแจ้งเตือนแล้ว • พร้อมรับงานใหม่' : 'แตะหน้าจอหนึ่งครั้งเพื่อเปิดเสียงแจ้งเตือนงานใหม่'),
    !!(prefs.on && prefs.volume > 0 && audioUnlocked)
  );
}

function onSoundEnabledChange(checked) {
  const prefs = loadSoundPrefs();
  prefs.on = !!checked;
  saveSoundPrefs(prefs);
}

function onSoundVolumeInput(value) {
  const prefs = loadSoundPrefs();
  prefs.volume = Number(value);
  saveSoundPrefs(prefs);
}

function chooseAlertTone(tone) {
  const prefs = loadSoundPrefs();
  prefs.tone = tone;
  saveSoundPrefs(prefs);
  unlockRiderAudio().then(() => playAlertBurst(tone));
}

function soundArrivedShop() {
  playTone([1046, 1318], 0.12, 0.15, 0.35);
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

function soundNearCustomer() {
  playTone([1046, 1318, 1046], 0.08, 0.1, 0.45);
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
}

function soundNewChat() {
  playTone([880], 0, 0.1, 0.25);
  if (navigator.vibrate) navigator.vibrate(50);
}

function soundPaymentReceived() {
  playTone([1046, 1318, 1568, 1318], 0.12, 0.15, 0.5);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

/* ═══════════════════════════════════════════════════════════════════
   8. IMAGE COMPRESS
   ═══════════════════════════════════════════════════════════════════ */
function compressImage(file, maxWidth = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

function compressQrImage(file, maxWidth = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height;
        if (!width || !height) return reject(new Error('รูป QR ไม่มีขนาดที่ใช้งานได้'));
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('ไม่สามารถเตรียมพื้นที่รูป QR ได้'));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('สร้างไฟล์ QR ไม่สำเร็จ')), 'image/png');
      };
      img.onerror = () => reject(new Error('อ่านรูป QR ไม่สำเร็จ'));
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ QR ไม่สำเร็จ'));
  });
}

/* ═══════════════════════════════════════════════════════════════════
   9. FINANCE
   ═══════════════════════════════════════════════════════════════════ */
function orderIsCash(order) {
  return !!(order && order.paymentMode === 'cash');
}

function orderLabel(o) {
  const code = String((o && o.code) || '').trim();
  if (code) return code;
  const id = String((o && o.id) || '');
  return id.slice(-6).toUpperCase();
}

function calcOrderFinance(order) {
  const fare = Number(order.fare || 0);
  const isCash = orderIsCash(order);
  const tip = order.cashTip != null ? Number(order.cashTip) || 0 : (isCash ? CASH_TIP : 0);
  const riderShare = Math.round(fare * RIDER_SHARE * 100) / 100;
  const platformShare = Math.round(fare * PLATFORM_SHARE * 100) / 100;
  const totalRider = riderShare + tip;
  const foodAmount = Number(order.foodTotal || order.itemsTotal || 0);
  return {
    fare, tip, riderShare, platformShare, totalRider, foodAmount,
    isCash, totalCustomerPay: fare + foodAmount + tip
  };
}

/* ═══════════════════════════════════════════════════════════════════
   10. AUTH
   ═══════════════════════════════════════════════════════════════════ */
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login')?.classList.toggle('active', isLogin);
  $('tab-signup')?.classList.toggle('active', !isLogin);
  const lf = $('form-login');
  const sf = $('form-signup');
  if (lf) lf.style.display = isLogin ? 'block' : 'none';
  if (sf) sf.style.display = isLogin ? 'none' : 'block';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('btn-login');
  const email = $('login-email').value.trim().toLowerCase();
  const pw = $('login-password').value;
  if (!email || !pw) return showToast('กรอกอีเมลและรหัสผ่าน', 'error');

  btn.disabled = true;
  btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';

  try {
    await auth.signInWithEmailAndPassword(email, pw);
    showToast('✅ เข้าสู่ระบบสำเร็จ');
    const notice = $('login-error');
    if (notice) { notice.classList.remove('ok'); notice.textContent = ''; }
  } catch (err) {
    const msg = {
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบอีเมลนี้',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป',
      'auth/network-request-failed': 'ไม่มีการเชื่อมต่อ'
    }[err.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    const notice = $('login-error');
    if (notice) { notice.classList.remove('ok'); notice.textContent = msg; }
    showToast(msg, 'error');
    btn.disabled = false;
    btn.textContent = '🔓 เข้าสู่ระบบ';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('btn-signup');
  const name = $('su-name').value.trim();
  const phone = $('su-phone').value.trim();
  const vehicle = $('su-vehicle').value;
  const plate = $('su-plate').value.trim();
  const email = $('su-email').value.trim().toLowerCase();
  const pw = $('su-password').value;
  const pw2 = $('su-password2').value;

  if (!name) return showToast('กรอกชื่อ', 'error');
  if (phone.replace(/\D/g, '').length < 9) return showToast('เบอร์ไม่ถูกต้อง', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('อีเมลไม่ถูกต้อง', 'error');
  if (pw.length < 6) return showToast('รหัสผ่าน 6+ ตัว', 'error');
  if (pw !== pw2) return showToast('รหัสไม่ตรงกัน', 'error');
  if (!$('pdpa-consent').checked) return showToast('กรุณายอมรับ PDPA', 'error');

  btn.disabled = true;
  btn.textContent = '⏳ กำลังสมัคร...';
  isSigningUp = true;
  let createdUser = null;

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: name });

    await db.collection('riders').doc(createdUser.uid).set({
      riderId: createdUser.uid,
      name, phone, email, vehicle, plate,
      verified: false, status: 'inactive',
      rating: 0, totalRatings: 0, totalJobs: 0, totalIncome: 0,
      trustScore: 100, gpsConsent: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('users').doc(createdUser.uid).set({
      role: 'rider', name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const notice = $('login-error');
    if (notice) {
      notice.classList.add('ok');
      notice.textContent = '✅ สมัครสำเร็จ รอแอดมินอนุมัติ — เข้าสู่ระบบด้วยอีเมลนี้ได้เลย';
    }
    switchAuthTab('login');
    const loginEmail = $('login-email');
    if (loginEmail) loginEmail.value = email;
    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ');
    try { await auth.signOut(); } catch (e) {}
  } catch (err) {
    console.error('❌ Signup error:', err.code, err.message);
    if (createdUser) { try { await createdUser.delete(); } catch (e) {} }
    showToast('สมัครไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
  isSigningUp = false;
  btn.disabled = false;
  btn.textContent = '✅ สมัครเป็นไรเดอร์';
}

async function handleForgotPassword() {
  const email = $('login-email').value.trim();
  if (!email) return showToast('กรอกอีเมลก่อน', 'error');
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว');
  } catch (err) { showToast('ส่งไม่สำเร็จ: ' + err.message, 'error'); }
}

async function handleLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeSheet();
  if (myProfileUnsub) myProfileUnsub();
  stopJobSubs();
  stopDispatchSubs();
  if (myHistoryUnsub) myHistoryUnsub();
  if (activeChatUnsub) activeChatUnsub();
  isOnline = false;
  stopGPS();
  if (gpsUploadTimer) { clearInterval(gpsUploadTimer); gpsUploadTimer = null; }
  await markGpsOffline();
  clearPaymentTimers();
  allJobs = [];
  openJobs = [];
  activeMine = [];
  allHistory = [];
  seenJobIds.clear();
  foodReadySeen = null;
  nearNotifiedOrderIds.clear();
  arrivedShopNotifiedOrderIds.clear();
  arrivedCustomerNotifiedOrderIds.clear();
  autoChatSent.clear();
  if (window.ChauatCall) ChauatCall.reset();
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   11. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  const epoch = ++authEpoch;
  if (qaFilterHookEnabled()) {
    currentUser = { uid: 'qa-rider' };
    riderProfile = { uid: 'qa-rider', verified: true, status: 'active', name: 'QA Rider' };
    isOnline = true;
    $('login-screen').style.setProperty('display', 'none', 'important');
    $('app').style.setProperty('display', 'block', 'important');
    return;
  }
  if (isSigningUp) return;

  if (myProfileUnsub) myProfileUnsub();
  stopJobSubs();
  stopDispatchSubs();
  if (myHistoryUnsub) myHistoryUnsub();

  const stale = () => epoch !== authEpoch || isSigningUp;

  if (!user) {
    if (stale()) return;
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    return;
  }

  currentUser = user;

  try {
    let userDoc = null;
    let riderDoc = null;
    let readError = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (stale()) return;
      try {
        const src = attempt === 1 ? 'default' : 'server';
        userDoc = await db.collection('users').doc(user.uid).get({ source: src });
        riderDoc = await db.collection('riders').doc(user.uid).get({ source: src });
        readError = null;
      } catch (e) { readError = e; }
      if (userDoc?.exists && riderDoc?.exists) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 400));
    }
    if (stale()) return;
    if (readError && !(userDoc && userDoc.exists && riderDoc && riderDoc.exists)) {
      showToast('อ่านข้อมูลบัญชีไม่สำเร็จ — ลองใหม่อีกครั้ง', 'error');
      return;
    }
    if (!userDoc || !userDoc.exists || userDoc.data().role !== 'rider') {
      showToast('บัญชีนี้ไม่ใช่ไรเดอร์', 'error');
      await auth.signOut();
      return;
    }
    if (!riderDoc || !riderDoc.exists) {
      showToast('ไม่พบข้อมูลไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    riderProfile = { uid: user.uid, ...riderDoc.data() };
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    initApp();
  } catch (err) {
    if (stale()) return;
    showToast('เกิดข้อผิดพลาด', 'error');
  }
});

/* ═══════════════════════════════════════════════════════════════════
   12. INIT APP
   ═══════════════════════════════════════════════════════════════════ */
function initApp() {
  updateHeader();
  updatePendingBanner();
  subscribeProfile();
  subscribeDispatch();
  subscribeHistory();
  setupNetwork();
  setupPWA();
  updatePushBanner();
  setTimeout(scheduleGPSIfActive, 1500);
  setTimeout(syncLocationUpload, 1500);
}

function updatePushBanner() {
  const el = $('push-banner');
  if (!el) return;
  const need = !!(currentUser && riderProfile && riderProfile.verified && isOnline
    && typeof Notification !== 'undefined' && Notification.permission !== 'granted');
  el.style.display = need ? 'block' : 'none';
}

/* ═══════════════════════════════════════════════════════════════════
   13. SUBSCRIBE
   ═══════════════════════════════════════════════════════════════════ */
function subscribeProfile() {
  if (myProfileUnsub) myProfileUnsub();
  myProfileUnsub = db.collection('riders').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prevVerified = riderProfile?.verified;
    const prevNotice = riderProfile && riderProfile.lastNotice && riderProfile.lastNotice.text;
    riderProfile = { uid: currentUser.uid, ...snap.data() };
    if (prevVerified === false && riderProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว!', 'success');
      soundNewJob();
    }
    const notice = riderProfile.lastNotice && riderProfile.lastNotice.text;
    if (notice && prevNotice && notice !== prevNotice) showToast(notice, 'warning', 6000);
    updateHeader();
    updatePendingBanner();
    updateOnlineToggle();
    updateHeroStats();
  });
}

function stopJobSubs() {
  openUnsubs.forEach((stop) => { try { stop(); } catch (e) {} });
  openUnsubs = [];
  if (myActiveUnsub) { myActiveUnsub(); myActiveUnsub = null; }
  myJobsUnsub = null;
}

function mapOrderDoc(d) {
  const data = d.data();
  return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
}

function publishJobs(prevOpenIds) {
  const map = new Map();
  openJobs.forEach(j => map.set(j.id, j));
  activeMine.forEach(j => map.set(j.id, j));
  allJobs = Array.from(map.values());
  allJobs.sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.getTime() : 0;
    const tb = b.createdAt ? b.createdAt.getTime() : 0;
    return tb - ta;
  });
  if (dispatchMode() !== 'auto') {
    const newJobs = openJobs.filter(j =>
      !prevOpenIds.has(j.id) &&
      riderMayClaim(j) &&
      riderProfile?.verified === true &&
      isOnline
    );
    if (newJobs.length > 0 && prevOpenIds.size > 0) {
      showNewJobPopup(newJobs[0]);
      startRepeatingAlert(newJobs[0].id);
    }
  }
  noteFoodReady(allJobs);
  if (window.ChauatCall) ChauatCall.watch(allJobs);
  renderJobs();
  updateHeroStats();
  scheduleGPSIfActive();
  autoStartPaymentWatch();
}

/* อาหารเปิดหลังร้านรับ (cooking/ready) คนละคิวรี่กับเรียกรถ/ส่งด่วน/ฝากซื้อ
   เพราะกฎไม่อ่านออเดอร์อาหารที่ร้านยังไม่กดรับ และไม่อ่านงานที่คนอื่นรับแล้ว */
function subscribeJobs() {
  stopJobSubs();
  const prevOpen = new Set(openJobs.map(j => j.id));
  if (dispatchMode() === 'auto') {
    openJobs = [];
    publishJobs(prevOpen);
  } else if (currentUser) {
    const buckets = [];
    const publishOpen = () => {
      const map = new Map();
      buckets.forEach((snap) => {
        if (!snap) return;
        snap.docs.forEach((doc) => map.set(doc.id, mapOrderDoc(doc)));
      });
      const prev = seenJobIds;
      openJobs = Array.from(map.values());
      seenJobIds = new Set(openJobs.map(j => j.id));
      publishJobs(prev);
    };
    const watch = (query, index) => {
      openUnsubs.push(query.limit(50).onSnapshot((snap) => {
        buckets[index] = snap;
        publishOpen();
      }, (err) => console.warn('open jobs', err && err.code)));
    };
    watch(db.collection('orders').where('riderId', '==', null).where('status', 'in', ['cooking', 'ready']), 0);
    ['ride', 'express', 'shopping'].forEach((type, i) => {
      watch(
        db.collection('orders')
          .where('riderId', '==', null)
          .where('type', '==', type)
          .where('status', 'in', ['searching', 'pending']),
        i + 1
      );
    });
    watch(
      db.collection('orders')
        .where('riderId', '==', null)
        .where('type', '==', 'food')
        .where('partnerShop', '==', false)
        .where('status', 'in', ['searching', 'pending']),
      4
    );
  }
  if (!currentUser) return;
  myActiveUnsub = db.collection('orders')
    .where('riderId', '==', currentUser.uid)
    .where('status', 'in', ['accepted', 'picked_up', 'customer_paid', 'on_the_way', 'ready'])
    .limit(20)
    .onSnapshot(snap => {
      activeMine = snap.docs.map(mapOrderDoc);
      publishJobs(seenJobIds);
    }, err => console.warn('my jobs', err && err.code));
}

function subscribeHistory() {
  if (myHistoryUnsub) myHistoryUnsub();
  myHistoryUnsub = db.collection('orders')
    .where('riderId', '==', currentUser.uid)
    .where('status', 'in', ['done', 'cancelled', 'shop_closed'])
    .limit(100)
    .onSnapshot(snap => {
      allHistory = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
      });
      updateHeroStats();
      renderJobs();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   14. UI UPDATE
   ═══════════════════════════════════════════════════════════════════ */
function updateHeader() {
  if (!riderProfile) return;
  const nameEl = $('rider-name');
  if (nameEl) nameEl.textContent = riderProfile.name || 'ไรเดอร์';
  const emailEl = $('sheet-rider-email');
  if (emailEl) emailEl.textContent = riderProfile.email || '';
  const trustEl = $('trust-badge');
  if (trustEl) trustEl.textContent = String(riderProfile.trustScore || 100);
  const trustSub = $('sheet-trust-sub');
  if (trustSub) trustSub.textContent = '⭐ ' + (riderProfile.trustScore || 100) + ' / 100';
  updateOnlineToggle();
}

function updatePendingBanner() {
  const banner = $('pending-banner');
  if (!banner) return;
  banner.classList.toggle('show', riderProfile?.verified !== true);
}

function updateOnlineToggle() {
  const btn = $('online-toggle-btn');
  const lbl = $('toggle-label');
  const st = $('rider-status');
  if (!btn || !lbl || !st) return;

  const ONLINE_VALUES = ['active', 'available', 'online'];
  const verified = riderProfile?.verified === true;
  isOnline = verified && ONLINE_VALUES.includes(riderProfile?.status);

  btn.classList.toggle('online', isOnline);
  // Keep the control clickable even while pending so the rider receives an
  // explanation instead of a dead/disabled button.
  btn.disabled = false;
  btn.setAttribute('aria-disabled', verified ? 'false' : 'true');
  btn.title = verified
    ? (isOnline ? 'กดเพื่อหยุดรับงาน' : 'กดเพื่อพร้อมรับงาน')
    : 'บัญชียังรอการอนุมัติจากแอดมิน';
  btn.setAttribute('aria-pressed', isOnline ? 'true' : 'false');
  lbl.textContent = isOnline ? 'ออนไลน์' : 'ออฟไลน์';
  st.textContent = !riderProfile
    ? 'กำลังโหลดบัญชี'
    : !verified
    ? 'รอการอนุมัติ'
    : (isOnline ? 'พร้อมรับงาน' : 'ออฟไลน์');
  const guide = $('rider-work-guide');
  if (guide) {
    guide.innerHTML = !riderProfile
      ? 'กำลังตรวจสอบข้อมูลไรเดอร์ กรุณารอสักครู่'
      : !verified
        ? '⏳ บัญชียังรอการอนุมัติจากแอดมิน<br><span style="font-size:11px;opacity:.8">ปุ่มกดได้เพื่อดูสถานะ แต่จะเริ่มรับงานได้หลังอนุมัติ</span>'
        : isOnline
          ? '🟢 สถานะพร้อมรับงานแล้ว<br>🍽️ อาหาร Partner จะแสดงหลังร้านกดรับออเดอร์ • 📦 งานส่งด่วนแสดงได้ทันที'
          : '🔘 กดปุ่ม “ออฟไลน์” ด้านบนเพื่อเปลี่ยนเป็น “พร้อมรับงาน”<br>🍽️ อาหาร Partner จะแสดงหลังร้านกดรับออเดอร์ • 📦 งานส่งด่วนแสดงได้ทันที';
  }
  renderJobs();
  updatePushBanner();
  syncLocationUpload();
}

// Dispatch allows one active job unless config/dispatch says otherwise (1–5).
// The hero must show that cap. offersAccepted/offersTotal is a lifetime
// offer rate and was rendering as "รับงาน 5/5" while the rider could hold one job.
function riderJobLimit() {
  const raw = Number(dispatchConfig && dispatchConfig.maxJobsPerRider);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(5, Math.max(1, Math.round(raw)));
}

function updateHeroStats() {
  const today = allHistory.filter(j => j.status === 'done' && isToday(j.doneAt || j.createdAt));
  const feeTotal = today.reduce((s, j) => {
    const f = Number(j.fare || 0);
    return s + f * RIDER_SHARE;
  }, 0);
  const tipTotal = today.reduce((s, j) => s + Number(j.cashTip || (j.paymentMode === 'cash' ? CASH_TIP : 0)), 0);
  const todayIncome = feeTotal + tipTotal;
  const todayOwe = today.filter(j => !j.riderPaid).reduce((s, j) => {
    const f = Number(j.fare || 0);
    return s + f * PLATFORM_SHARE;
  }, 0);

  const incomeEl = $('hero-income');
  if (incomeEl) incomeEl.textContent = '฿' + fmt(todayIncome);
  const activeCount = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
  ).length;

  const subEl = $('hero-sub');
  if (subEl) {
    subEl.textContent = `จาก ${today.length} งานเสร็จสิ้นวันนี้ • รับงาน ${activeCount}/${riderJobLimit()}`;
  }
  const feeEl = $('hero-fee');
  if (feeEl) feeEl.textContent = '฿' + fmt(feeTotal);
  const tipEl = $('hero-tip');
  if (tipEl) tipEl.textContent = '฿' + fmt(tipTotal);
  const oweEl = $('hero-owe');
  if (oweEl) oweEl.textContent = '฿' + fmt(todayOwe);

  const doneEl = $('stat-done');
  if (doneEl) doneEl.textContent = today.length;
  const activeEl = $('stat-active');
  if (activeEl) activeEl.textContent = activeCount;
  const totalEl = $('stat-total');
  if (totalEl) totalEl.textContent = riderProfile?.totalJobs || allHistory.length;
}

const JOB_FILTERS = ['all', 'food', 'express', 'ride', 'shopping'];

function matchesJobFilter(job) {
  if (!jobFilter || jobFilter === 'all') return true;
  return !!(job && job.type === jobFilter);
}

function historyMoment(job) {
  return job && (job.doneAt || job.cancelledAt || job.createdAt);
}

function qaFilterHookEnabled() {
  const host = (window.location && window.location.hostname) || '';
  if (host !== 'localhost' && host !== '127.0.0.1') return false;
  return new URLSearchParams(window.location.search).get('qa') === 'job-filter';
}

/* Active Jobs เป็นงานที่ไรเดอร์รับแล้ว ต้องแสดงเสมอไม่ว่ากำลังเลือก
   ตัวกรองงานใหม่ประเภทใดอยู่ก็ตาม */
function isActiveRiderJob(job, myId) {
  return !!(job && myId && job.riderId === myId && (
    RIDER_ACTIVE_STATUSES.includes(job.status) || job.status === 'ready'
  ));
}

function setJobFilter(filter) {
  jobFilter = JOB_FILTERS.indexOf(filter) === -1 ? 'all' : filter;
  document.querySelectorAll('[data-job-filter]').forEach(btn => {
    const active = btn.dataset.jobFilter === jobFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.style.background = active ? 'var(--brand, #00A651)' : 'transparent';
    btn.style.color = active ? '#fff' : 'var(--text, #173D2A)';
  });
  renderJobs();
}

/* ═══════════════════════════════════════════════════════════════════
   15. RENDER JOBS
   ⭐ v3.9.1: เห็นทั้ง searching + ready
   ═══════════════════════════════════════════════════════════════════ */
function renderJobs() {
  const myId = currentUser?.uid;

  /* Job Filter มีผลเฉพาะงานใหม่ที่ยังรอให้ไรเดอร์รับเท่านั้น */
  const newJobs = openJobs.filter(j =>
    matchesJobFilter(j) &&
    riderMayClaim(j) &&
    riderProfile?.verified && isOnline
  );

  /* Active Jobs แยกจาก New Jobs อย่างเด็ดขาด: อ่านจาก activeMine
     และไม่ใช้ matchesJobFilter เพื่อไม่ให้งานที่รับแล้วหายจากหน้าจอ */
  const activeJobs = activeMine.filter(j => isActiveRiderJob(j, myId));

  const doneToday = allHistory.filter(j => isToday(historyMoment(j)));

  const newSec = $('new-job-section');
  const actSec = $('active-job-section');
  const doneSec = $('done-job-section');
  const emptyEl = $('empty-state');

  if (newSec) newSec.style.display = newJobs.length > 0 ? 'block' : 'none';
  if (actSec) actSec.style.display = activeJobs.length > 0 ? 'block' : 'none';
  if (doneSec) doneSec.style.display = doneToday.length > 0 ? 'block' : 'none';
  if (emptyEl) emptyEl.style.display =
    (newJobs.length + activeJobs.length + doneToday.length) === 0 ? 'block' : 'none';

  const nc = $('new-count'); if (nc) nc.textContent = newJobs.length;
  const ac = $('active-count'); if (ac) ac.textContent = activeJobs.length;
  const dc = $('done-count'); if (dc) dc.textContent = doneToday.length;

  const njl = $('new-jobs-list');
  if (njl) njl.innerHTML = newJobs.map(j => renderJobCard(j, 'new')).join('');
  const ajl = $('active-jobs-list');
  if (ajl) ajl.innerHTML = activeJobs.map(j => renderJobCard(j, 'active')).join('');
  const djl = $('done-jobs-list');
  if (djl) djl.innerHTML = doneToday.slice(0, 10).map(j => renderJobCard(j, 'done')).join('');
}

function renderJobCard(j, type) {
  const isNew = type === 'new';
  const fin = calcOrderFinance(j);

  let statusInfo = {
    searching: { label: '🔔 ใหม่ • รอร้านรับ', color: 'var(--orange)', bg: '#FFF3E0' },
    pending: { label: '🔔 รอร้านรับ', color: 'var(--orange)', bg: '#FFF3E0' },
    cooking: { label: '🍳 ร้านกำลังทำ • รับได้เลย', color: '#E65100', bg: '#FFF3E0' },
    ready: { label: '✅ อาหารพร้อม • รับได้เลย', color: 'var(--green)', bg: '#E8F5E9' },
    accepted: { label: '🛵 รับแล้ว • ร้านกำลังทำ', color: 'var(--blue)', bg: '#E3F2FD' },
    picked_up: { label: orderIsCash(j) ? '💵 รับของแล้ว • เก็บเงินสดตอนส่ง' : '📦 รอลูกค้าโอนเงิน', color: '#E65100', bg: '#FFF3E0' },
    customer_paid: { label: '💳 โอนแล้ว • เริ่มส่งได้', color: 'var(--green)', bg: '#E8F5E9' },
    on_the_way: { label: '🚀 กำลังส่ง', color: 'var(--green)', bg: '#E8F5E9' },
    done: { label: '✅ เสร็จ', color: 'var(--green)', bg: '#E8F5E9' },
    cancelled: { label: 'ยกเลิกแล้ว', color: '#8A3A3A', bg: '#FDECEC' }
  }[j.status] || { label: j.status, color: 'var(--text-muted)', bg: 'var(--surface-2)' };

  const payBadge = fin.isCash
    ? `<span class="jc-badge jc-cash">💵 เงินสด • ต้องมี ฿${fmt(fin.foodAmount)}</span>`
    : `<span class="jc-badge jc-transfer">💳 โอน • ลูกค้าจ่าย ฿${fmt(fin.totalCustomerPay)}</span>`;

  const typeIcon = (j.type === 'ride') ? '🚗'
    : (j.type === 'express') ? '📦'
    : (j.type === 'shopping') ? '🛒'
    : '🍽️';

  const chatBtn = `<button class="jc-icon-btn" onclick="event.stopPropagation();openChatWithCustomer('${esc(j.id)}')" title="แชท">💬</button>`;
  const callRow = (!isNew && j.riderId === currentUser?.uid && window.ChauatCall) ? ChauatCall.buttons(j.id) : '';

  const codeHtml = `<div style="font-size:11px;font-weight:900;color:var(--brand);margin-bottom:4px">🧾 ${esc(orderLabel(j))}</div>`;

  const foodIsReady = !!(j.foodReady || j.readyAt || j.status === 'ready');
  const shopSlip = orderHasShopSlip(j);
  const customerPaid = orderIsCash(j) || !!j.customerPaidAt || j.status === 'customer_paid';
  const foodWorkflowHtml = (!isNew && orderNeedsKitchen(j) && ['picked_up', 'customer_paid', 'on_the_way'].includes(j.status))
    ? `<div style="margin:12px 0;padding:12px;border:1px solid #B9DFA6;border-radius:14px;background:#F4FBF0">
        <div style="font-size:13px;font-weight:900;color:#237A3B;margin-bottom:8px">🍽️ ขั้นตอนงานอาหาร</div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:800;margin:5px 0">
          <span>📸 รูปอาหารให้ลูกค้า</span><span style="color:${j.foodImage ? '#168A45' : '#E65100'}">${j.foodImage ? '✅ ส่งแล้ว' : '⏳ ยังไม่ส่ง'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:800;margin:5px 0">
          <span>💳 ลูกค้าโอนเงิน</span><span style="color:${customerPaid ? '#168A45' : '#E65100'}">${orderIsCash(j) ? '💵 เงินสดปลายทาง' : (customerPaid ? '✅ ตรวจพบแล้ว' : '⏳ รอลูกค้าโอน')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:800;margin:5px 0">
          <span>🧾 สลิปที่จ่ายร้าน</span><span style="color:${shopSlip ? '#168A45' : '#E65100'}">${shopSlip ? '✅ แนบแล้ว' : '⏳ ยังไม่แนบ'}</span>
        </div>
      </div>`
    : '';
  if (j.status === 'accepted' && foodIsReady) {
    statusInfo = { label: '✅ อาหารพร้อม • ไปรับที่ร้าน', color: 'var(--green)', bg: '#E8F5E9' };
  }
  if (orderNeedsKitchen(j) && (j.status === 'picked_up' || j.status === 'customer_paid') && !j.foodImage) {
    statusInfo = { label: '📸 ต้องส่งรูปอาหารให้ลูกค้า', color: '#E65100', bg: '#FFF3E0' };
  } else if (orderNeedsKitchen(j) && (j.status === 'picked_up' || j.status === 'customer_paid') && !shopSlip && !customerPaid) {
    statusInfo = { label: '💳 ส่งรูปแล้ว • รอลูกค้าโอน', color: '#E65100', bg: '#FFF3E0' };
  } else if (orderNeedsKitchen(j) && (j.status === 'picked_up' || j.status === 'customer_paid') && !shopSlip) {
    statusInfo = { label: '✅ ลูกค้าโอนแล้ว • แนบสลิปร้าน', color: 'var(--green)', bg: '#E8F5E9' };
  }
  if (!orderIsCash(j) && j.status === 'picked_up' && j.customerPaidAt && !(orderNeedsKitchen(j) && !shopSlip)) {
    statusInfo = { label: '💳 ได้รับเงินแล้ว • เริ่มส่งได้', color: 'var(--green)', bg: '#E8F5E9' };
  }
  const prepHtml = (!foodIsReady && j.prepMinutes)
    ? `<div class="jc-row"><span class="jc-row-icon">⏱️</span><span class="jc-row-text">ร้านใช้เวลาทำประมาณ ${Number(j.prepMinutes)} นาที</span></div>`
    : '';

  let primaryAction = '';
  if (isNew && riderMayClaim(j)) {
    primaryAction = `<button type="button" class="jc-primary-btn jc-accept" data-accept="${esc(j.id)}">✅ รับงาน</button>
      <button type="button" class="jc-secondary-btn" data-skip="${esc(j.id)}">⏭️</button>`;
  } else if (j.status === 'accepted' || (j.status === 'ready' && j.riderId)) {
    if (orderNeedsKitchen(j) && !foodIsReady) {
      primaryAction = `<button type="button" class="jc-primary-btn jc-gray" disabled>⏳ รอร้านทำให้เสร็จ</button>
      <button type="button" class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    } else {
      primaryAction = `<button type="button" class="jc-primary-btn jc-orange" data-arrived="${esc(j.id)}" onclick="arrivedAtShop('${esc(j.id)}')">📍 ถึงร้าน</button>
      ${(j.type === 'food' && !orderNeedsKitchen(j)) ? `<button type="button" class="jc-secondary-btn" data-shop-closed="${esc(j.id)}">ร้านปิด</button>` : `<button type="button" class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`}`;
    }
  } else if (j.status === 'picked_up' || j.status === 'customer_paid') {
    if (orderNeedsKitchen(j) && !j.foodImage) {
      primaryAction = `<button type="button" class="jc-primary-btn jc-orange" data-food-photo="${esc(j.id)}">📸 ส่งรูปอาหารให้ลูกค้า</button>
        <button type="button" class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    } else if (orderNeedsKitchen(j) && !shopSlip && !customerPaid) {
      primaryAction = `${payReceivedButton(j.id)}
        <button type="button" class="jc-secondary-btn" data-chat="${esc(j.id)}">💬</button>`;
    } else if (orderNeedsKitchen(j) && !shopSlip) {
      primaryAction = `<button type="button" class="jc-primary-btn jc-orange" data-slip="${esc(j.id)}">🧾 แนบสลิปที่จ่ายร้าน</button>
        <button type="button" class="jc-secondary-btn" data-chat="${esc(j.id)}">💬</button>`;
    } else if (canLeaveShop(j)) {
      const closedShop = (j.type === 'food' && !orderNeedsKitchen(j) && j.status === 'picked_up' && !j.customerPaidAt)
        ? `<button type="button" class="jc-secondary-btn" data-shop-closed="${esc(j.id)}">ร้านปิด</button>`
        : `<button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
      primaryAction = `<button class="jc-primary-btn jc-green" data-start-deliver="${esc(j.id)}">🚀 เริ่มส่ง</button>
        ${closedShop}`;
    } else if (riderMayConfirmPay(j)) {
      primaryAction = `${payReceivedButton(j.id)}
        <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    } else {
      primaryAction = `<button class="jc-primary-btn jc-gray" disabled>⏳ รอลูกค้าโอนเงิน</button>
        <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    }
  } else if (j.status === 'on_the_way') {
    primaryAction = `<button class="jc-primary-btn jc-green" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'done' || j.status === 'cancelled' || j.status === 'shop_closed') {
    primaryAction = `<button class="jc-primary-btn jc-gray" data-detail="${esc(j.id)}">📄 ดูรายละเอียด</button>`;
  } else {
    primaryAction = `<button class="jc-primary-btn jc-gray" disabled>⏳ รอสถานะ</button>`;
  }
  const payExtra = (riderMayConfirmPay(j) && primaryAction.indexOf('data-paid=') === -1)
    ? `<div class="jc-actions" style="margin-bottom:8px">${payReceivedButton(j.id)}</div>`
    : '';

  return `
    <div class="jc-card ${isNew ? 'jc-new' : ''}" data-card-id="${esc(j.id)}">
      <div class="jc-header">
        <div class="jc-type-icon">${typeIcon}</div>
        <div class="jc-header-info">
          ${codeHtml}
          <div class="jc-title">${esc(j.title || 'งานใหม่')}</div>
          <div class="jc-sub">👤 ${esc(j.userName || 'ลูกค้า')}</div>
        </div>
        <div class="jc-header-actions">
          ${chatBtn}
        </div>
      </div>

      <div class="jc-body">
        <div class="jc-row">
          <span class="jc-row-icon">📍</span>
          <span class="jc-row-text">${esc((j.address || j.destination || '—').slice(0, 80))}</span>
        </div>
        <div class="jc-row">
          <span class="jc-row-icon">🕐</span>
          <span class="jc-row-text">${timeAgo(j.createdAt)}</span>
          <span class="jc-status-chip" style="background:${statusInfo.bg};color:${statusInfo.color}">${statusInfo.label}</span>
        </div>
        ${prepHtml}
      </div>

      <div class="jc-payment-row">${payBadge}</div>

      ${foodWorkflowHtml}

      <div class="jc-finance">
        <div class="jc-finance-left">
          <div class="jc-finance-label">💰 ค่าบริการ</div>
          <div class="jc-finance-sub">คุณได้ 80% ของค่าส่ง = ฿${fmt(fin.riderShare)}${fin.tip > 0 ? ` + ทิปเงินสด ฿${fin.tip}` : ''}</div>
        </div>
        <div class="jc-finance-amount">฿${fmt(fin.totalRider)}</div>
      </div>

      ${callRow}
      ${payExtra}
      <div class="jc-actions">
        ${primaryAction}
      </div>
    </div>`;
}

function findKnownOrder(orderId) {
  const lists = [allJobs, allHistory];
  for (let i = 0; i < lists.length; i++) {
    const found = (lists[i] || []).find((job) => job && (job.id === orderId || job.orderId === orderId));
    if (found) return found;
  }
  if (currentOffer && currentOffer.orderId === orderId) return currentOffer;
  return null;
}

async function orderForAutoChat(orderId) {
  const known = findKnownOrder(orderId);
  if (known && known.type) return known;
  try {
    const snap = await db.collection('orders').doc(orderId).get();
    if (snap.exists) return Object.assign({ id: snap.id }, snap.data());
  } catch (err) {}
  return known;
}

async function sendAutomatedChat(orderId, key) {
  if (!orderId || !key || !currentUser) return;
  const token = orderId + ':' + key;
  if (autoChatSent.has(token)) return;
  const order = await orderForAutoChat(orderId);
  const text = autoChatText(order, key);
  if (!text) return;
  autoChatSent.add(token);
  try {
    const body = await ensureRiderChat(orderId);
    const messageRef = db.collection('chats').doc(orderId).collection('messages').doc('auto_' + key);
    const existing = await messageRef.get();
    if (existing.exists) return;
    await messageRef.set({
      text,
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: body.riderName || riderProfile?.name || 'ไรเดอร์',
      systemMessage: true,
      automated: true,
      automationKey: key,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(orderId).update({
      lastMessage: text.split('\n')[0].slice(0, 80),
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.warn('automated chat:', key, err && (err.code || err.message));
  }
}

function riderQrPaymentText(order, phase) {
  if (!order || order.paymentMode === 'cash') return '';
  if (phase === 'shop_arrived') {
    return '📍 ไรเดอร์ถึงร้านแล้วครับ/ค่ะ\nกำลังตรวจสอบและถ่ายรูปอาหารให้ลูกค้า\nหลังส่งรูปอาหารแล้ว ระบบจะแจ้งยอดโอนที่แน่นอนอีกครั้งครับ/ค่ะ\n\n📱 สามารถสแกน QR นี้เพื่อเตรียมโอนเงินให้ไรเดอร์ได้ครับ/ค่ะ';
  }
  return '📸 ไรเดอร์ส่งรูปอาหารจากร้านแล้วครับ/ค่ะ\nกรุณาโอนเงินให้ไรเดอร์เพื่อชำระค่าอาหารและค่าบริการตามยอดนี้ครับ/ค่ะ\n' + foodPayEquation(foodPayParts(order)) + '\n\n📱 กรุณาสแกน QR นี้เพื่อโอนเงินให้ไรเดอร์ครับ/ค่ะ';
}

async function sendRiderQrPaymentChat(orderId, phase) {
  if (!orderId || !currentUser || !riderProfile?.qrCodeUrl) return false;
  const order = await orderForAutoChat(orderId);
  if (!order || orderServiceType(order) !== 'food' || order.paymentMode === 'cash') return false;
  const key = phase === 'shop_arrived' ? 'shop_arrived_qr' : 'food_payment_qr';
  const text = riderQrPaymentText(order, phase);
  const token = orderId + ':' + key;
  if (!text) return false;
  if (autoChatSent.has(token)) return true;
  autoChatSent.add(token);
  try {
    const body = await ensureRiderChat(orderId);
    const messageRef = db.collection('chats').doc(orderId).collection('messages').doc('auto_' + key);
    if ((await messageRef.get()).exists) return true;
    await messageRef.set({
      text,
      imageUrl: riderProfile.qrCodeUrl,
      imagePath: riderProfile.qrCodePath || '',
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: body.riderName || riderProfile.name || 'ไรเดอร์',
      systemMessage: true,
      automated: true,
      automationKey: key,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(orderId).update({
      lastMessage: text.split('\n')[0].slice(0, 80),
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn('automated rider QR chat:', key, err && (err.code || err.message));
    autoChatSent.delete(token);
    return false;
  }
}

function sendAutomatedChatLater(orderId, key) {
  sendAutomatedChat(orderId, key);
}

/* ═══════════════════════════════════════════════════════════════════
   16. JOB ACTIONS
   ═══════════════════════════════════════════════════════════════════ */

/* อาหารรับได้หลังร้านรับ (cooking/ready) — เรียกรถ/ส่งด่วน/ฝากซื้อรับจาก searching ได้
   The server transaction assigns the rider. The phone cannot write riderId. */
async function confirmPaymentReceived(jobId) {
  if (!currentUser) return;
  if (!confirm('ยืนยันว่าได้รับเงินโอนจากลูกค้าแล้ว?')) return;
  try {
    await callDispatch('confirmPaymentReceived', { orderId: jobId });
    const job = allJobs.find(j => j.id === jobId);
    if (job) {
      job.customerPaid = true;
      job.customerPaidAt = job.customerPaidAt || new Date();
      job.paidConfirmedBy = 'rider';
      if (job.status === 'picked_up') job.status = 'customer_paid';
    }
    window._paymentNotified = window._paymentNotified || {};
    window._paymentNotified[jobId] = true;
    clearPaymentTimers();
    const overlay = $('modalOverlay');
    if (overlay && overlay.classList.contains('show')) closeModal();
    showToast('บันทึกว่ารับเงินแล้ว — เริ่มส่งได้');
    renderJobs();
  } catch (err) {
    showToast((err && err.message) || 'ยืนยันรับเงินไม่สำเร็จ', 'error');
  }
}

async function reportShopClosed(jobId) {
  if (!currentUser) return;
  const job = allJobs.find(j => j.id === jobId);
  const fare = Number(job && job.fare) || 0;
  const tip = job && job.paymentMode === 'cash' ? (job.cashTip != null ? Number(job.cashTip) : 5) : 0;
  const due = fare + (Number.isFinite(tip) ? tip : 0);
  if (!confirm('ร้านปิดหรือซื้ออาหารไม่ได้?\nงานจะจบ และลูกค้าต้องชำระค่าบริการ ฿' + due + ' ให้ไรเดอร์\nChauatGo ไม่มีส่วนเกี่ยวข้องกับร้าน')) return;
  try {
    await callDispatch('reportShopClosed', { orderId: jobId });
    showToast('บันทึกร้านปิดแล้ว — ลูกค้าต้องชำระค่าบริการ');
  } catch (err) {
    showToast((err && err.message) || 'บันทึกร้านปิดไม่สำเร็จ', 'error');
  }
}

async function acceptJob(jobId) {
  if (dispatchMode() === 'auto') {
    return showToast('โหมดอัตโนมัติ — รอกดรับจากใบเสนอ', 'warning');
  }
  if (!currentUser || acceptingOffer) return;
  acceptingOffer = true;
  try {
    const result = await callDispatch('claimOpenJob', { orderId: jobId });
    const readyAlready = !!(result && result.readyAlready);
    const prepMinutes = Number((result && result.prepMinutes) || 0);
    showToast(readyAlready
      ? '✅ รับงานแล้ว — อาหารพร้อม ไปที่ร้าน'
      : ('✅ รับงานแล้ว — ร้านกำลังทำ' + (prepMinutes ? ' ประมาณ ' + prepMinutes + ' นาที' : '')));
    sendAutomatedChatLater(jobId, 'accepted');
    closeNewJobPopup();
    scheduleGPSIfActive();
  } catch (err) {
    showToast(acceptErrorText(err), 'error', 6000);
  } finally {
    acceptingOffer = false;
  }
}

function noteFoodReady(jobs) {
  const mine = {};
  jobs.forEach(j => {
    if (!currentUser || j.riderId !== currentUser.uid) return;
    mine[j.id] = !!(j.foodReady || j.readyAt || j.status === 'ready');
  });
  if (foodReadySeen) {
    Object.keys(mine).forEach(id => {
      if (mine[id] && foodReadySeen[id] === false) {
        const job = jobs.find(j => j.id === id);
        if (job) alertFoodReady(job);
      }
    });
  }
  foodReadySeen = mine;
}

function alertFoodReady(job) {
  const who = job.merchantName || 'ร้าน';
  showToast('อาหารพร้อมแล้ว — ' + orderLabel(job), 'success', 6000);
  startRepeatingAlert(job.id);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('✅ อาหารพร้อมแล้ว', {
        body: who + ' • ' + orderLabel(job),
        icon: '/icons/icon-512.png',
        tag: 'food-ready-' + job.id
      });
    } catch (e) {}
  }
}

/* ⭐ v3.9.1: ถึงร้าน → Modal ถ่ายรูป */
async function arrivedAtShop(jobId) {
  if (pickupOrderId === jobId && $('modalOverlay')?.classList.contains('show')) return;
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return showToast('ไม่พบงาน', 'error');
  if (orderNeedsKitchen(job) && !orderFoodReady(job)) {
    return showToast('รอร้านทำให้เสร็จก่อน', 'warning');
  }
  if (orderServiceType(job) === 'food' && job.paymentMode !== 'cash' && !riderProfile?.qrCodeUrl) {
    showToast('⚠️ ยังไม่ได้แนบ QR รับเงิน — ลูกค้าจะไม่ได้รับ QR อัตโนมัติ', 'warning', 6000);
  }
  sendAutomatedChatLater(jobId, 'shop_arrived');
  const qrSent = await sendRiderQrPaymentChat(jobId, 'shop_arrived');
  if (orderServiceType(job) === 'food' && job.paymentMode !== 'cash' && riderProfile?.qrCodeUrl && !qrSent) {
    showToast('⚠️ ส่ง QR ให้ลูกค้าไม่สำเร็จ กรุณาตรวจสอบแชทหรือส่งใหม่', 'warning', 6000);
  }
  openPickupModal(jobId, job);
}

function openShopSlip(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return showToast('ไม่พบงาน', 'error');
  openPickupModal(jobId, job);
}

function openFoodPhoto(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return showToast('ไม่พบงาน', 'error');
  if (job.foodImage) return openPickupModal(jobId, job);
  openPickupModal(jobId, job);
}

function pickupStage(job) {
  if (job && orderNeedsKitchen(job) && job.foodImage) return 'slip';
  if (job && orderNeedsKitchen(job)) return 'food';
  return 'both';
}

/* Food: photo first (payment message), then the shop slip. Other services still send both together. */
function openPickupModal(jobId, job) {
  pickupOrderId = jobId;
  pickupFoodBlob = null;
  pickupSlipBlob = null;
  pickupFoodUrl = null;
  pickupSlipUrl = null;

  const fin = calcOrderFinance(job);
  const stage = pickupStage(job);
  const mc = $('modalContent');
  if (!mc) return;

  const foodHeading = stage === 'slip'
    ? `<div style="font-size:48px">🧾</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">โอนค่าอาหารให้ร้าน</h2>
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">
        แนบสลิปแล้วระบบจะส่งให้ลูกค้า ออกเดินทางได้หลังมีสลิป
      </p>`
    : (stage === 'food'
      ? `<div style="font-size:48px">📸</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">ถ่ายรูปอาหาร</h2>
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">
        ${orderIsCash(job) ? 'ส่งรูปให้ลูกค้า แล้วแจ้งให้เตรียมเงินสดจ่ายไรเดอร์ตอนรับของ' : 'ส่งรูปให้ลูกค้า แล้วแจ้งยอดให้โอนหาไรเดอร์'}
      </p>`
      : `<div style="font-size:48px">📸</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">รับของ</h2>
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">
        กรุณาถ่ายรูปของ + สลิปที่จ่ายร้าน
      </p>`);

  const payPreview = stage === 'food'
    ? `<div style="background:#FFF8E1;border-radius:12px;padding:12px;margin-bottom:16px;font-size:13px;font-weight:800;line-height:1.6;white-space:pre-line">${esc(foodPhotoMessage(job))}</div>`
    : '';

  mc.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      ${foodHeading}
    </div>
    ${payPreview}

    <!-- ข้อมูลร้าน -->
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:14px;font-weight:900">🏪 ${esc(job.merchantName || 'ร้านค้า')}</div>
      <div style="font-size:11px;color:var(--brand);font-weight:900;margin-top:4px">🧾 ${esc(orderLabel(job))}</div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:8px 0 0;margin-top:8px;border-top:1px dashed var(--border)">
        <span>${fin.foodAmount > 0 ? '💰 ยอดที่ต้องโอนร้าน' : '💰 ค่าบริการที่ลูกค้าจ่าย (ไม่โอนร้าน)'}</span>
        <span style="font-weight:900;color:var(--green)">฿${fmt(fin.foodAmount > 0 ? fin.foodAmount : fin.fare)}</span>
      </div>
    </div>

    <!-- รูปอาหาร -->
    <div style="margin-bottom:14px;${stage === 'slip' ? 'display:none' : ''}">
      <label style="display:block;font-size:13px;font-weight:900;margin-bottom:8px">
        📸 รูปอาหาร <span style="color:#E53935">*บังคับ</span>
      </label>
      <div style="border:2px dashed var(--border);border-radius:12px;aspect-ratio:1;max-height:220px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);overflow:hidden;position:relative">
        <div id="pickup-food-placeholder" style="text-align:center">
          <div style="font-size:36px">🍽️</div>
          <div style="font-size:12px;font-weight:700;margin-top:6px;color:var(--text-muted)">ยังไม่มีรูปอาหาร</div>
        </div>
        <img id="pickup-food-preview" style="display:none;width:100%;height:100%;object-fit:cover">
      </div>
      <div class="photo-source-row">
        <button type="button" class="photo-source-btn camera ripple" onclick="openLiveCamera('food')">📷 ถ่ายรูปจากกล้อง</button>
        <button type="button" class="photo-source-btn ripple" onclick="document.getElementById('pickup-food-gallery').click()">🖼️ เลือกจากคลังภาพ</button>
      </div>
      <input type="file" id="pickup-food-camera" accept="image/*" capture="environment" style="display:none" onchange="handlePickupImage(event, 'food')">
      <input type="file" id="pickup-food-gallery" accept="image/*" style="display:none" onchange="handlePickupImage(event, 'food')">
    </div>

    ${stage === 'slip' && job.foodImage ? `<div style="margin-bottom:14px"><div style="font-size:13px;font-weight:900;margin-bottom:8px">📸 รูปที่ส่งให้ลูกค้าแล้ว</div><img src="${esc(job.foodImage)}" style="width:100%;border-radius:12px;max-height:180px;object-fit:cover"></div>` : ''}

    <!-- สลิปโอนร้าน -->
    <div style="margin-bottom:14px;${stage === 'food' ? 'display:none' : ''}">
      <label style="display:block;font-size:13px;font-weight:900;margin-bottom:8px">
        🧾 สลิปที่จ่ายร้าน <span style="color:#E53935">*บังคับ</span>
      </label>
      <div style="border:2px dashed var(--border);border-radius:12px;aspect-ratio:1;max-height:220px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);overflow:hidden;position:relative">
        <div id="pickup-slip-placeholder" style="text-align:center">
          <div style="font-size:36px">🧾</div>
          <div style="font-size:12px;font-weight:700;margin-top:6px;color:var(--text-muted)">ยังไม่มีสลิป</div>
        </div>
        <img id="pickup-slip-preview" style="display:none;width:100%;height:100%;object-fit:cover">
      </div>
      <div class="photo-source-row">
        <button type="button" class="photo-source-btn camera ripple" onclick="openLiveCamera('slip')">📷 ถ่ายสลิปจากกล้อง</button>
        <button type="button" class="photo-source-btn ripple" onclick="document.getElementById('pickup-slip-gallery').click()">🖼️ เลือกสลิปจากคลังภาพ</button>
      </div>
      <input type="file" id="pickup-slip-camera" accept="image/*" capture="environment" style="display:none" onchange="handlePickupImage(event, 'slip')">
      <input type="file" id="pickup-slip-gallery" accept="image/*" style="display:none" onchange="handlePickupImage(event, 'slip')">
    </div>

    <div id="live-camera-panel" style="display:none;position:fixed;inset:0;z-index:1200;background:#101317;align-items:center;justify-content:center;padding:18px">
      <div style="width:min(100%,520px);background:#fff;border-radius:20px;padding:14px;color:#14221b">
        <div style="display:flex;justify-content:space-between;align-items:center;font-weight:900;font-size:18px;margin-bottom:10px">
          <span>📷 ถ่ายรูปจากกล้อง</span>
          <button type="button" onclick="closeLiveCamera()" style="border:0;background:transparent;font-size:28px">×</button>
        </div>
        <video id="live-camera-video" autoplay playsinline muted style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#000;border-radius:14px"></video>
        <canvas id="live-camera-canvas" style="display:none"></canvas>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button type="button" class="action-btn-big btn-gray-big" style="flex:1" onclick="closeLiveCamera()">ยกเลิก</button>
          <button type="button" class="action-btn-big btn-green-big" style="flex:1" onclick="captureLivePhoto()">📸 กดถ่ายรูป</button>
        </div>
      </div>
    </div>

    <!-- ปุ่ม -->
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="action-btn-big btn-gray-big ripple" style="flex:1" onclick="closeModal()">ยกเลิก</button>
      <button class="action-btn-big btn-green-big ripple" style="flex:1" id="pickup-confirm-btn" disabled onclick="confirmPickup()">${stage === 'slip' ? '🧾 ส่งสลิปให้ลูกค้า' : (stage === 'food' ? '📤 ส่งรูปอาหารให้ลูกค้า' : '📤 ส่งให้ลูกค้า')}</button>
    </div>
  `;

  $('modalOverlay').classList.add('show');
}

/* ⭐ v3.9.1: จัดการรูปที่ถ่าย */
async function handlePickupImage(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  await processPickupImage(file, type);
  event.target.value = '';
}

async function processPickupImage(file, type) {
  if (file.size > MAX_SLIP_SIZE) {
    showToast('รูปใหญ่เกิน 5MB', 'error');
    return;
  }

  showToast('⏳ กำลังประมวลผล...', 'info');

  try {
    const compressed = await compressImage(file, 800, 0.75);
    if (!compressed || compressed.size <= 0 || compressed.size > MAX_SLIP_SIZE) {
      showToast('รูปใหญ่เกิน 5MB หลังย่อ', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (type === 'food') {
        pickupFoodBlob = compressed;
        const preview = $('pickup-food-preview');
        const placeholder = $('pickup-food-placeholder');
        if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
      } else {
        pickupSlipBlob = compressed;
        const preview = $('pickup-slip-preview');
        const placeholder = $('pickup-slip-placeholder');
        if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
      }
      updatePickupConfirmBtn();
    };
    reader.readAsDataURL(compressed);
  } catch (err) {
    showToast('ประมวลผลรูปไม่สำเร็จ', 'error');
  }
}

let liveCameraStream = null;
let liveCameraType = 'food';

async function openLiveCamera(type) {
  liveCameraType = type === 'slip' ? 'slip' : 'food';
  const panel = $('live-camera-panel');
  const video = $('live-camera-video');
  if (!panel || !video) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('มือถือหรือเบราว์เซอร์นี้ไม่รองรับกล้องในเว็บ กรุณาเลือกจากคลังภาพ', 'warning', 6000);
    return;
  }
  try {
    liveCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1706 } },
      audio: false
    });
    video.srcObject = liveCameraStream;
    panel.style.display = 'flex';
    await video.play();
  } catch (err) {
    showToast('เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องในการตั้งค่าเว็บไซต์ แล้วลองใหม่', 'error', 7000);
  }
}

function closeLiveCamera() {
  if (liveCameraStream) liveCameraStream.getTracks().forEach(track => track.stop());
  liveCameraStream = null;
  const video = $('live-camera-video');
  if (video) video.srcObject = null;
  const panel = $('live-camera-panel');
  if (panel) panel.style.display = 'none';
}

async function captureLivePhoto() {
  const video = $('live-camera-video');
  const canvas = $('live-camera-canvas');
  if (!video || !canvas || !video.videoWidth) return showToast('กล้องยังไม่พร้อม ลองอีกครั้ง', 'warning');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  closeLiveCamera();
  if (blob) await processPickupImage(new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' }), liveCameraType);
}

function updatePickupConfirmBtn() {
  const btn = $('pickup-confirm-btn');
  if (!btn) return;
  const job = allJobs.find(j => j.id === pickupOrderId);
  const stage = pickupStage(job);
  if (stage === 'food') btn.disabled = !pickupFoodBlob;
  else if (stage === 'slip') btn.disabled = !pickupSlipBlob;
  else btn.disabled = !(pickupFoodBlob && pickupSlipBlob);
}

async function postRiderOrderImage(orderId, blob) {
  const body = await ensureRiderChat(orderId);
  const path = `chats/${orderId}/riders/${currentUser.uid}/${Date.now()}.jpg`;
  const ref = storage.ref(path);
  await ref.put(blob, { contentType: 'image/jpeg' });
  const url = await ref.getDownloadURL();
  await db.collection('chats').doc(orderId).collection('messages').add({
    imageUrl: url,
    imagePath: path,
    senderId: currentUser.uid,
    senderRole: 'rider',
    senderName: body.riderName || riderProfile?.name || 'ไรเดอร์',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  try {
    await db.collection('chats').doc(orderId).update({
      lastMessage: '📷 รูปภาพ',
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (previewErr) {}
  return url;
}

/* The food photo is already stored under orders/{orderId}. Reuse that URL in
   the chat message instead of uploading the same image a second time. This
   keeps the customer-readable order asset as the source of truth and avoids
   a second Storage authorization check on chats/{orderId}/images. */
async function postRiderOrderImageUrl(orderId, url, imagePath) {
  const body = await ensureRiderChat(orderId);
  await db.collection('chats').doc(orderId).collection('messages').add({
    imageUrl: url,
    imagePath: imagePath || '',
    senderId: currentUser.uid,
    senderRole: 'rider',
    senderName: body.riderName || riderProfile?.name || 'ไรเดอร์',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  try {
    await db.collection('chats').doc(orderId).update({
      lastMessage: '📷 รูปภาพ',
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (previewErr) {}
  return url;
}

/* Food photo goes to the customer with the payment request. The shop slip is the next step. */
async function confirmPickup() {
  const pickupJob = allJobs.find(j => j.id === pickupOrderId);
  const stage = pickupStage(pickupJob);
  if (stage === 'food') return submitFoodPhoto(pickupJob);
  if (stage === 'slip') return submitShopSlip(pickupJob);
  return confirmCombinedPickup();
}

async function submitFoodPhoto(pickupJob) {
  if (!pickupFoodBlob) return showToast('⚠️ กรุณาถ่ายรูปอาหาร', 'warning');
  if (pickupJob && orderNeedsKitchen(pickupJob) && !orderFoodReady(pickupJob)) {
    return showToast('รอร้านทำให้เสร็จก่อน', 'warning');
  }
  const btn = $('pickup-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }
  let uploadStep = 'เตรียมอัปโหลด';
  try {
    const jobId = pickupOrderId;
    const ts = Date.now();
    const foodPath = `chats/${jobId}/riders/${currentUser.uid}/food_${ts}.jpg`;
    const foodRef = storage.ref(foodPath);
    uploadStep = 'อัปโหลดไฟล์รูป';
    await foodRef.put(pickupFoodBlob, { contentType: 'image/jpeg' });
    uploadStep = 'ขอ Download URL';
    pickupFoodUrl = await foodRef.getDownloadURL();
    try {
      uploadStep = 'ส่งรูปเข้าแชท';
      await postRiderOrderImageUrl(jobId, pickupFoodUrl, foodPath);
    } catch (chatErr) {
      console.warn('food photo chat message failed:', chatErr && (chatErr.code || chatErr.message));
    }
    uploadStep = 'บันทึกรูปลงออเดอร์';
    await db.collection('orders').doc(jobId).update({
      status: 'picked_up',
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
      foodImage: pickupFoodUrl,
      foodImagePath: foodPath
    });
    const pickedJob = allJobs.find(j => j.id === jobId) || pickupJob;
    if (pickedJob) {
      pickedJob.status = 'picked_up';
      pickedJob.foodImage = pickupFoodUrl;
      pickedJob.foodImagePath = foodPath;
    }
    sendAutomatedChatLater(jobId, 'food_photo');
    const qrSent = await sendRiderQrPaymentChat(jobId, 'food_payment');
    if (orderServiceType(pickedJob || pickupJob) === 'food'
      && !orderIsCash(pickedJob || pickupJob)
      && riderProfile?.qrCodeUrl
      && !qrSent) {
      showToast('⚠️ ส่งยอดโอนพร้อม QR ไม่สำเร็จ แต่ส่งรูปอาหารแล้ว กรุณาตรวจสอบแชท', 'warning', 7000);
    }
    arrivedShopNotifiedOrderIds.add(jobId);
    if (pickedJob && !orderIsCash(pickedJob) && !pickedJob.customerPaidAt) startPaymentTimers(jobId);
    showToast(orderIsCash(pickedJob)
      ? '✅ ส่งรูปแล้ว — แจ้งให้เตรียมเงินสดตอนส่ง แล้วแนบสลิปร้าน'
      : '✅ ส่งรูปแล้ว — แจ้งลูกค้าให้โอน แล้วแนบสลิปร้าน');
    renderJobs();
    openPickupModal(jobId, pickedJob || { id: jobId, type: 'food', foodImage: pickupFoodUrl });
  } catch (err) {
    console.error('submitFoodPhoto error:', err);
    const detail = err && (err.code || err.message) || 'unknown-error';
    showToast(`ไม่สำเร็จขั้นตอน: ${uploadStep} (${detail})`, 'error', 9000);
    if (btn) { btn.disabled = false; btn.textContent = '📤 ส่งรูปอาหารให้ลูกค้า'; }
  }
}

async function submitShopSlip(pickupJob) {
  if (!pickupSlipBlob) return showToast('⚠️ กรุณาแนบสลิปที่จ่ายร้าน', 'warning');
  const btn = $('pickup-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }
  try {
    const jobId = pickupOrderId;
    const ts = Date.now();
    const slipPath = `slips/riders/${currentUser.uid}/${jobId}_${ts}.jpg`;
    const slipRef = storage.ref(slipPath);
    await slipRef.put(pickupSlipBlob, { contentType: 'image/jpeg' });
    pickupSlipUrl = await slipRef.getDownloadURL();
    await postRiderOrderImage(jobId, pickupSlipBlob);
    await db.collection('orders').doc(jobId).update({
      riderSlipToShop: pickupSlipUrl,
      riderSlipToShopPath: slipPath,
      riderPaidShopAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const job = allJobs.find(j => j.id === jobId) || pickupJob;
    if (job) {
      job.riderSlipToShop = pickupSlipUrl;
      job.riderSlipToShopPath = slipPath;
    }
    sendAutomatedChatLater(jobId, 'shop_slip');
    showToast(canLeaveShop(job)
      ? (orderIsCash(job) ? '✅ ส่งสลิปแล้ว — เริ่มส่งได้ เก็บเงินสดตอนส่ง' : '✅ ส่งสลิปแล้ว — เริ่มส่งได้')
      : '✅ ส่งสลิปแล้ว — รอลูกค้าโอนก่อนออกจากร้าน');
    closeModal();
    renderJobs();
  } catch (err) {
    console.error('submitShopSlip error:', err);
    showToast('อัปโหลดไม่สำเร็จ: ' + (err.code || err.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🧾 ส่งสลิปให้ลูกค้า'; }
  }
}

/* Express, shopping, and ride still attach the photo and the shop slip together. */
async function confirmCombinedPickup() {
  if (!pickupFoodBlob || !pickupSlipBlob) {
    return showToast('⚠️ กรุณาถ่ายรูปของ + สลิป', 'warning');
  }
  const btn = $('pickup-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }

  let uploadStep = 'รูปของ';
  try {
    const jobId = pickupOrderId;
    const ts = Date.now();

    const foodPath = `chats/${jobId}/riders/${currentUser.uid}/food_${ts}.jpg`;
    const foodRef = storage.ref(foodPath);
    uploadStep = 'รูปของ ' + foodPath;
    await foodRef.put(pickupFoodBlob, { contentType: 'image/jpeg' });
    pickupFoodUrl = await foodRef.getDownloadURL();

    const slipPath = `slips/riders/${currentUser.uid}/${jobId}_${ts}.jpg`;
    const slipRef = storage.ref(slipPath);
    uploadStep = 'สลิป ' + slipPath;
    await slipRef.put(pickupSlipBlob, { contentType: 'image/jpeg' });
    pickupSlipUrl = await slipRef.getDownloadURL();

    uploadStep = 'บันทึกออเดอร์';
    await db.collection('orders').doc(jobId).update({
      status: 'picked_up',
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
      foodImage: pickupFoodUrl,
      foodImagePath: foodPath,
      riderSlipToShop: pickupSlipUrl,
      riderSlipToShopPath: slipPath,
      riderPaidShopAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const pickedJob = allJobs.find(j => j.id === jobId);
    const cashPickup = orderIsCash(pickedJob);
    const alreadyPaid = !!(pickedJob && pickedJob.customerPaidAt);
    if (pickedJob) {
      pickedJob.status = 'picked_up';
      pickedJob.foodImage = pickupFoodUrl;
      pickedJob.foodImagePath = foodPath;
      pickedJob.riderSlipToShop = pickupSlipUrl;
      pickedJob.riderSlipToShopPath = slipPath;
    }
    showToast(cashPickup
      ? '✅ รับของแล้ว — เริ่มส่งได้ เก็บเงินสดตอนส่ง'
      : (alreadyPaid ? '✅ ส่งให้ลูกค้าแล้ว — ได้รับเงินแล้ว เริ่มส่งได้' : '✅ ส่งให้ลูกค้าแล้ว — รอโอนเงิน'));
    sendAutomatedChatLater(jobId, 'picked_up');
    closeModal();
    arrivedShopNotifiedOrderIds.add(jobId);
    renderJobs();

    if (!cashPickup && !alreadyPaid) startPaymentTimers(jobId);
  } catch (err) {
    console.error('confirmCombinedPickup error:', err);
    showToast('อัปโหลดไม่สำเร็จ (' + uploadStep + '): ' + (err.code || err.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 ส่งให้ลูกค้า'; }
  }
}

/* ⭐ v3.9.1: Timer 5 นาที → โทรตาม, 15 นาที → ยกเลิกได้ */
function startPaymentTimers(jobId) {
  clearPaymentTimers();

  paymentTimeout5 = setTimeout(async () => {
    const job = allJobs.find(j => j.id === jobId);
    if (!job || job.customerPaidAt) return;

    showToast('⚠️ ลูกค้ายังไม่โอน — โทรตามในแอปได้', 'warning');
    playTone([660, 660, 880], 0.2, 0.3, 0.6);

    if (job.userId && window.ChauatCall && confirm('⚠️ ลูกค้ายังไม่โอนเงิน (5 นาที)\n\nโทรหาลูกค้าในแอปตอนนี้?')) {
      ChauatCall.start(job.id, 'customer');
    }
  }, PAYMENT_TIMEOUT_5MIN);

  paymentTimeout15 = setTimeout(() => {
    const job = allJobs.find(j => j.id === jobId);
    if (!job || job.customerPaidAt) return;

    if (confirm('⚠️ ลูกค้ายังไม่โอน (15 นาที)\n\nยกเลิกงานนี้?')) {
      cancelJobAfterTimeout(jobId);
    }
  }, PAYMENT_TIMEOUT_15MIN);
}

function clearPaymentTimers() {
  if (paymentTimeout5) { clearTimeout(paymentTimeout5); paymentTimeout5 = null; }
  if (paymentTimeout15) { clearTimeout(paymentTimeout15); paymentTimeout15 = null; }
}

async function cancelJobAfterTimeout(jobId) {
  try {
    await db.collection('orders').doc(jobId).update({
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: 'rider',
      cancelReason: 'ลูกค้าไม่โอนเงินภายใน 15 นาที'
    });

    try {
      const chatRef = db.collection('chats').doc(jobId);
      const chatSnap = await chatRef.get();
      if (chatSnap.exists) {
        await chatRef.collection('messages').add({
          text: '❌ ไรเดอร์ยกเลิกงาน\n📝 เหตุผล: ลูกค้าไม่โอนเงินภายใน 15 นาที',
          senderId: currentUser.uid,
          senderRole: 'rider',
          senderName: riderProfile.name,
          systemMessage: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (e) {}

    showToast('❌ ยกเลิกงานแล้ว');
    clearPaymentTimers();
    stopGPS();
  } catch (err) {
    showToast('ยกเลิกไม่สำเร็จ: ' + (err.message || ''), 'error');
  }
}

/* เริ่มส่ง — โอนต้องมี customerPaidAt, เงินสดเริ่มได้ทันทีหลังรับของ */
async function startDelivery(jobId) {
  try {
    const snap = await db.collection('orders').doc(jobId).get();
    if (!snap.exists) return showToast('ไม่พบงาน', 'error');
    const job = snap.data();

    if (orderNeedsKitchen(job) && !orderHasShopSlip(job)) {
      return showToast('⚠️ แนบสลิปที่โอนให้ร้านก่อนออกเดินทาง', 'warning');
    }
    if (!canLeaveShop(job)) {
      return showToast('⚠️ ลูกค้ายังไม่โอนเงิน', 'warning');
    }

    await db.collection('orders').doc(jobId).update({
      status: 'on_the_way',
      onTheWayAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🚀 เริ่มส่งอาหาร');
    sendAutomatedChatLater(jobId, 'on_the_way');
    clearPaymentTimers();
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

async function deliverJob(jobId) {
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;
  const fin = calcOrderFinance(job);
  openDeliverModal(job, fin);
}

/* ⭐ v3.9.1: Subscribe order active เพื่อ detect customerPaidAt */
function startWatchingPayment(jobId) {
  window._paymentWatch = window._paymentWatch || {};
  window._paymentNotified = window._paymentNotified || {};
  if (window._paymentWatch[jobId]) return;

  window._paymentWatch[jobId] = db.collection('orders').doc(jobId)
    .onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.customerPaidAt && !window._paymentNotified[jobId]) {
        const localJob = allJobs.find(job => job.id === jobId);
        if (localJob) {
          localJob.customerPaidAt = data.customerPaidAt;
          if (data.status) localJob.status = data.status;
          if (data.riderSlipToShop) localJob.riderSlipToShop = data.riderSlipToShop;
          if (data.riderSlipToShopPath) localJob.riderSlipToShopPath = data.riderSlipToShopPath;
        }
        window._paymentNotified[jobId] = true;
        soundPaymentReceived();
        showToast('💳 ลูกค้าโอนเงินแล้ว — เริ่มส่งได้');
        renderJobs();
      }
    });
}

/* ⭐ v3.9.1: Auto-start payment watch เมื่อมี picked_up */
function autoStartPaymentWatch() {
  const pickedUpJobs = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    j.status === 'picked_up' &&
    !j.customerPaidAt &&
    !orderIsCash(j)
  );

  pickedUpJobs.forEach(job => {
    if (job.pickedUpAt && !window._paymentTimersStarted?.[job.id]) {
      window._paymentTimersStarted = window._paymentTimersStarted || {};
      window._paymentTimersStarted[job.id] = true;

      const pickedAt = toDate(job.pickedUpAt)?.getTime() || Date.now();
      const elapsed = Date.now() - pickedAt;
      const remaining5 = Math.max(0, PAYMENT_TIMEOUT_5MIN - elapsed);
      const remaining15 = Math.max(0, PAYMENT_TIMEOUT_15MIN - elapsed);

      if (remaining5 > 0) {
        paymentTimeout5 = setTimeout(async () => {
          const j = allJobs.find(x => x.id === job.id);
          if (!j || j.customerPaidAt) return;
          showToast('⚠️ ลูกค้ายังไม่โอน — กรุณาโทรตาม', 'warning');
          playTone([660, 660, 880], 0.2, 0.3, 0.6);
        }, remaining5);
      }

      if (remaining15 > 0) {
        paymentTimeout15 = setTimeout(() => {
          const j = allJobs.find(x => x.id === job.id);
          if (!j || j.customerPaidAt) return;
          if (confirm('⚠️ ลูกค้ายังไม่โอน (15 นาที)\n\nยกเลิกงานนี้?')) {
            cancelJobAfterTimeout(job.id);
          }
        }, remaining15);
      }
    }

    startWatchingPayment(job.id);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   17. DELIVER MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openDeliverModal(job, fin) {
  const mc = $('modalContent');
  if (!mc) return;

  mc.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:48px">✅</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">ยืนยันส่งสำเร็จ</h2>
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">
        กดยืนยันเมื่อส่งอาหารให้ลูกค้าแล้ว
      </p>
    </div>

    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0">
        <span>ค่าบริการทั้งหมด</span>
        <span style="font-weight:900">฿${fmt(fin.fare)}</span>
      </div>
      ${fin.tip > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#E65100">
        <span>ทิปเงินสด</span>
        <span style="font-weight:900">฿${fmt(fin.tip)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:var(--green)">
        <span>คุณได้ (80% ของค่าส่ง${fin.tip > 0 ? ' + ทิป' : ''})</span>
        <span style="font-weight:900">฿${fmt(fin.totalRider)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#E65100;border-top:1px dashed var(--border);margin-top:6px;padding-top:8px">
        <span>ต้องโอนเข้าระบบ (20% ของค่าส่ง)</span>
        <span style="font-weight:900">฿${fmt(fin.platformShare)}</span>
      </div>
      ${fin.isCash ? `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:900;padding:8px 0 0;margin-top:6px;border-top:1px dashed var(--border);color:#E65100">
        <span>💵 เก็บเงินสดจากลูกค้า</span>
        <span>฿${fmt(job.total || fin.totalCustomerPay)}</span>
      </div>` : ''}
    </div>

    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="action-btn-big btn-gray-big ripple" style="flex:1" onclick="closeModal()">ยกเลิก</button>
      <button class="action-btn-big btn-green-big ripple" style="flex:1" onclick="confirmDeliver('${esc(job.id)}')">✅ ยืนยันส่งสำเร็จ</button>
    </div>
  `;

  $('modalOverlay').classList.add('show');
}

async function confirmDeliver(jobId) {
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;
  const fin = calcOrderFinance(job);

  try {
    const result = await callDispatch('completeOrder', { orderId: jobId });
    const income = result && result.riderIncome != null ? result.riderIncome : fin.totalRider;
    showToast('✅ ส่งสำเร็จ! +฿' + fmt(income));
    sendAutomatedChatLater(jobId, 'delivered');
    closeModal();
    clearPaymentTimers();
    stopGPS();
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}
/* ═══════════════════════════════════════════════════════════════════
   18. JOB DETAIL
   ═══════════════════════════════════════════════════════════════════ */
function showJobDetail(jobId) {
  acknowledgeAlert(jobId);
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;
  const fin = calcOrderFinance(job);
  const mapUrl = job.lat && job.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
    : (job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null);
  const mc = $('modalContent');
  if (!mc) return;

  const codeHtml = `<div style="background:linear-gradient(135deg,#FF6B35,#E55A2B);color:#fff;border-radius:12px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:11px;opacity:.9;font-weight:800">🧾 Order</div>
        <div style="font-size:24px;font-weight:900;letter-spacing:3px;margin-top:4px">${esc(orderLabel(job))}</div>
      </div>`;

  const foodImgHtml = job.foodImage
    ? `<div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:900;margin-bottom:8px">📸 รูปอาหาร</div>
        <img src="${esc(job.foodImage)}" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover" onclick="window.open('${esc(job.foodImage)}','_blank')">
      </div>`
    : '';

  const slipImgHtml = job.riderSlipToShop
    ? `<div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:900;margin-bottom:8px">🧾 สลิปที่จ่ายร้าน</div>
        <img src="${esc(job.riderSlipToShop)}" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover" onclick="window.open('${esc(job.riderSlipToShop)}','_blank')">
      </div>`
    : '';

  const payStatusHtml = orderIsCash(job) && ['picked_up', 'on_the_way', 'customer_paid'].includes(job.status)
    ? `<div style="background:#FFF3E0;border-left:4px solid #E65100;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#E65100;font-weight:900">💵 ชำระเงินสดกับไรเดอร์ — เก็บเงินตอนส่ง</div>`
    : (job.customerPaidAt
      ? `<div style="background:#E8F5E9;border-left:4px solid var(--green);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--green);font-weight:900">✅ ลูกค้าโอนเงินแล้ว — เริ่มส่งได้</div>`
      : (job.status === 'picked_up'
        ? `<div style="background:#FFF3E0;border-left:4px solid var(--orange);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#E65100;font-weight:900">⏳ รอลูกค้าโอนเงิน</div>`
        : ''));
  const payActionHtml = riderMayConfirmPay(job)
    ? `<button type="button" class="action-btn-big btn-green-big ripple" style="width:100%;margin-bottom:8px" data-paid="${esc(job.id)}">💳 ลูกค้าโอนแล้ว / ได้รับเงินแล้ว</button>`
    : '';

  const hasMapPoint = !!(
    (job.shopPlaceLat && job.shopPlaceLng) ||
    (job.lat && job.lng) ||
    (job.fromLat && job.fromLng)
  );
  destroyRiderJobMap();

  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 รายละเอียดงาน</h2>
    ${codeHtml}
    ${payStatusHtml}
    ${hasMapPoint ? '<div id="rider-job-map" style="height:240px;border-radius:14px;margin-bottom:14px;overflow:hidden"></div>' : ''}
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-weight:900;font-size:15px;margin-bottom:8px">${esc(job.title || 'งาน')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);line-height:1.9">
        <div>👤 ลูกค้า: <b>${esc(job.userName || '—')}</b></div>
        <div>📍 ${esc(job.address || job.destination || '—')}</div>
        <div>🏪 ${esc(job.merchantName || '—')}</div>
        <div>🕐 ${fmtDateTime(job.createdAt)}</div>
        ${job.prepMinutes ? `<div>⏱️ เวลาทำประมาณ ${Number(job.prepMinutes)} นาที</div>` : ''}
        ${(job.foodReady || job.readyAt) ? `<div style="color:var(--green);font-weight:900">✅ อาหารพร้อมแล้ว</div>` : ''}
      </div>
    </div>
    ${job.note ? `<div style="background:var(--orange-light);border-left:4px solid var(--orange);padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:12px;color:#E65100;font-weight:700">📌 ${esc(job.note)}</div>` : ''}
    ${foodImgHtml}
    ${slipImgHtml}
    <div style="background:var(--green-light);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0">
        <span>💰 ค่าบริการ</span><span style="font-weight:900">฿${fmt(fin.fare)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0;color:var(--green)">
        <span>คุณได้รับ (80% ของค่าส่ง)</span><span style="font-weight:900">฿${fmt(fin.totalRider)}</span>
      </div>
    </div>
    ${job.riderId === currentUser?.uid && window.ChauatCall ? ChauatCall.buttons(job.id) : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="action-btn-big btn-orange-big ripple" style="text-decoration:none;color:#fff;justify-content:center">📍 นำทาง</a>` : ''}
    </div>
    ${payActionHtml}
    ${job.status !== 'done' ? `<button class="action-btn-big btn-gray-big ripple" style="width:100%;margin-bottom:8px" onclick="openChatWithCustomer('${esc(job.id)}')">💬 แชทกับลูกค้า</button>` : ''}
    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
  if (hasMapPoint) setTimeout(() => mountRiderJobMap(job), 60);
}

function destroyRiderJobMap() {
  if (!riderJobMap) return;
  try { riderJobMap.remove(); } catch (e) {}
  riderJobMap = null;
}

function mountRiderJobMap(job) {
  destroyRiderJobMap();
  const el = document.getElementById('rider-job-map');
  if (!el || typeof L === 'undefined' || !window.ChauatMap) return;
  const shop = ChauatMap.point(job.shopPlaceLat, job.shopPlaceLng);
  const drop = ChauatMap.point(job.lat, job.lng);
  const from = ChauatMap.point(job.fromLat, job.fromLng);
  const customer = drop || (shop ? from : null);
  const showFrom = from && !ChauatMap.same(from, shop) && !ChauatMap.same(from, customer);
  const line = [];
  if (shop) line.push(shop);
  if (showFrom) line.push(from);
  if (customer && !ChauatMap.same(customer, line[line.length - 1])) line.push(customer);
  if (!line.length && from) line.push(from);
  if (!line.length) {
    el.style.display = 'none';
    return;
  }
  riderJobMap = L.map(el, { zoomControl: true });
  ChauatMap.addBaseTiles(riderJobMap);
  if (shop) {
    L.marker([shop.lat, shop.lng], { icon: ChauatMap.pin('🏪', ChauatMap.COLORS.shop), zIndexOffset: 900 })
      .addTo(riderJobMap)
      .bindPopup('<b>🏪 ' + esc(job.shopPlaceName || job.merchantName || 'ร้าน') + '</b>');
  }
  if (showFrom) {
    L.marker([from.lat, from.lng], { icon: ChauatMap.pin('📍', ChauatMap.COLORS.user), zIndexOffset: 950 })
      .addTo(riderJobMap)
      .bindPopup('<b>📍 จุดรับ</b>');
  }
  if (customer) {
    L.marker([customer.lat, customer.lng], { icon: ChauatMap.pin('🏠', ChauatMap.COLORS.customer), zIndexOffset: 1000 })
      .addTo(riderJobMap)
      .bindPopup('<b>🏠 จุดส่ง</b>');
  }
  if (line.length >= 2) ChauatMap.route(riderJobMap, null, line);
  ChauatMap.fit(riderJobMap, line, 17);
  setTimeout(() => {
    if (!riderJobMap) return;
    riderJobMap.invalidateSize();
    ChauatMap.fit(riderJobMap, line, 17);
  }, 220);
}

/* ═══════════════════════════════════════════════════════════════════
   19. NEW JOB POPUP
   ═══════════════════════════════════════════════════════════════════ */
function showNewJobPopup(job) {
  newJobPopupId = job.id;
  const fin = calcOrderFinance(job);
  const cashBadge = fin.isCash
    ? `<div style="padding:8px;background:var(--orange-light);border-radius:10px;margin-top:8px;font-size:12px;font-weight:900;color:#E65100">💵 เงินสด • ต้องมี ฿${fmt(fin.foodAmount)}</div>`
    : '';

  const nd = $('new-job-detail');
  if (nd) {
    nd.innerHTML = `
      <div style="font-size:16px;font-weight:900;color:var(--brand);text-align:center;padding:8px;background:var(--brand-light);border-radius:8px;margin-bottom:8px">🧾 ${esc(orderLabel(job))}</div>
      <div>👤 <strong>${esc(job.userName || 'ลูกค้า')}</strong></div>
      <div>📍 ${esc(job.address || job.destination || '—')}</div>
      ${job.prepMinutes ? `<div>⏱️ ร้านใช้เวลาทำประมาณ ${Number(job.prepMinutes)} นาที</div>` : ''}
      ${(job.foodReady || job.readyAt || job.status === 'ready') ? `<div style="color:var(--green);font-weight:900">✅ อาหารพร้อมแล้ว</div>` : ''}
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
        💰 ค่าบริการ: <strong style="color:var(--brand);font-size:18px">฿${fmt(fin.fare)}</strong>
      </div>
      <div style="font-size:11px;color:var(--green);font-weight:800;margin-top:4px">
        คุณจะได้ ${fin.tip > 0 ? '80% ของค่าส่ง + ทิป' : '80% ของค่าส่ง'} = ฿${fmt(fin.totalRider)}
      </div>
      ${cashBadge}
    `;
  }
  $('newJobPopup').classList.add('show');

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('🔔 งานใหม่!', {
        body: `${orderLabel(job)} • ${job.userName || 'ลูกค้า'} - ฿${fmt(fin.fare)}`,
        icon: '/icons/icon-512.png',
        tag: 'new-job-' + job.id
      });
    } catch (e) {}
  }
}

function closeNewJobPopup() {
  $('newJobPopup').classList.remove('show');
  if (newJobPopupId) acknowledgeAlert(newJobPopupId);
  newJobPopupId = null;
}

function acceptFromPopup() {
  if (newJobPopupId) acceptJob(newJobPopupId);
}

function skipJob(jobId) {
  closeNewJobPopup();
  showToast('ข้ามงานนี้', 'info');
}

/* ═══════════════════════════════════════════════════════════════════
   20. ONLINE / GPS
   ═══════════════════════════════════════════════════════════════════ */
async function toggleOnline() {
  unlockRiderAudio();
  if (!currentUser || riderProfile?.verified !== true) {
    return showToast('รอแอดมินอนุมัติก่อน', 'warning');
  }
  const newState = !isOnline;
  const prevStatus = riderProfile.status;
  isOnline = newState;
  riderProfile.status = newState ? 'active' : 'inactive';
  updateOnlineToggle();
  try {
    await db.collection('riders').doc(currentUser.uid).update({
      status: riderProfile.status,
      lastToggle: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(newState ? '🟢 ออนไลน์' : '⚫ ออฟไลน์');
    if (newState) scheduleGPSIfActive();
    else stopGPS();
    syncLocationUpload();
    updatePushBanner();
  } catch (err) {
    isOnline = !newState;
    riderProfile.status = prevStatus;
    updateOnlineToggle();
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

function scheduleGPSIfActive() {
  const hasActive = allJobs.some(j =>
    j.riderId === currentUser?.uid &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
  );
  if (isOnline || hasActive) startGPS();
  else stopGPS();
}

function startGPS() {
  if (!navigator.geolocation) return;
  if (gpsWatchId) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      try {
        await writeGps(latitude, longitude, accuracy);
        await checkArrivalForActiveOrders(latitude, longitude);
      } catch (err) {}
    },
    (err) => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function stopGPS() {
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

function syncLocationUpload() {
  if (isOnline && currentUser && riderProfile?.verified === true) {
    startGPS();
    uploadLocationOnce();
    if (!gpsUploadTimer) gpsUploadTimer = setInterval(uploadLocationOnce, 20000);
    return;
  }
  if (gpsUploadTimer) {
    clearInterval(gpsUploadTimer);
    gpsUploadTimer = null;
  }
  if (currentUser) markGpsOffline();
}

function uploadLocationOnce() {
  if (!navigator.geolocation || !currentUser || !isOnline) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      await writeGps(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      await checkArrivalForActiveOrders(pos.coords.latitude, pos.coords.longitude);
    } catch (err) {}
  }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 });
}

async function writeGps(latitude, longitude, accuracy) {
  if (!currentUser || !isOnline) return;
  const now = Date.now();
  if (now - lastGpsUpload < 15000) return;
  lastGpsUpload = now;
  const geohash = window.ChauatGeo ? ChauatGeo.geohashForLocation(latitude, longitude) : '';
  await db.collection('gps_riders').doc(currentUser.uid).set({
    riderId: currentUser.uid,
    name: (riderProfile && riderProfile.name) || '',
    lat: latitude,
    lng: longitude,
    accuracy: accuracy || null,
    geohash: geohash,
    online: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !isOnline) return;
  lastGpsUpload = 0;
  uploadLocationOnce();
});
window.addEventListener('pageshow', () => {
  if (!isOnline) return;
  lastGpsUpload = 0;
  uploadLocationOnce();
});

async function markGpsOffline() {
  if (!currentUser) return;
  lastGpsUpload = 0;
  try {
    await db.collection('gps_riders').doc(currentUser.uid).set({
      riderId: currentUser.uid,
      online: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) {}
}

async function checkArrivalForActiveOrders(myLat, myLng) {
  const myActive = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
  );

  for (const job of myActive) {
    if (job.status === 'accepted' && job.shopPlaceLat && job.shopPlaceLng
      && (!orderNeedsKitchen(job) || orderFoodReady(job))
      && !arrivedShopNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.shopPlaceLat, job.shopPlaceLng) * 1000;
      if (dist <= ARRIVAL_RADIUS_M) {
        arrivedShopNotifiedOrderIds.add(job.id);
        soundArrivedShop();
        showToast('📍 ถึงร้านแล้ว — กด "ถึงร้าน" เพื่อรับอาหาร');
        sendAutomatedChatLater(job.id, 'shop_arrived');
      }
    }

    if (job.status === 'on_the_way' && job.lat && job.lng
      && !nearNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.lat, job.lng) * 1000;
      if (dist <= NEAR_CUSTOMER_RADIUS_M) {
        nearNotifiedOrderIds.add(job.id);
        soundNearCustomer();
        showToast('🔔 ใกล้ถึงลูกค้า 300 ม.');

        await db.collection('orders').doc(job.id).update({
          riderNearCustomerAt: firebase.firestore.FieldValue.serverTimestamp(),
          riderNearCustomerChatAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
        sendAutomatedChatLater(job.id, 'near_customer');
      }
    }

    if (job.status === 'on_the_way' && job.lat && job.lng && !arrivedCustomerNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.lat, job.lng) * 1000;
      if (dist <= CUSTOMER_ARRIVAL_RADIUS_M) {
        arrivedCustomerNotifiedOrderIds.add(job.id);
        await db.collection('orders').doc(job.id).update({
          riderArrivedCustomerChatAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
        sendAutomatedChatLater(job.id, 'arrived_customer');
      }
    }
  }
}

function requestGPS() {
  if (!navigator.geolocation) return showToast('ไม่รองรับ GPS', 'error');
  navigator.geolocation.getCurrentPosition(
    (pos) => { showToast(`📍 ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`); },
    () => { showToast('ไม่สามารถเข้าถึง GPS', 'error'); }
  );
}

/* ═══════════════════════════════════════════════════════════════════
   21. SHEET / MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openSheet() {
  unlockRiderAudio();
  syncSoundSettingsUI();
  $('sheetOverlay')?.classList.add('show');
}
function closeSheet() { $('sheetOverlay')?.classList.remove('show'); }
function closeModal() {
  destroyRiderJobMap();
  $('modalOverlay')?.classList.remove('show');
  const mc = $('modalContent');
  if (mc) mc.innerHTML = '';
  pickupFoodBlob = null;
  pickupSlipBlob = null;
  pickupOrderId = null;
}

/* ═══════════════════════════════════════════════════════════════════
   22. PROFILE / FINANCE
   ═══════════════════════════════════════════════════════════════════ */
async function handleRiderQrFile(event) {
  const file = event?.target?.files?.[0];
  if (event?.target) event.target.value = '';
  if (!file || !currentUser || !riderProfile) return;
  if (!file.type.startsWith('image/') && file.type !== '') {
    return showToast('กรุณาเลือกไฟล์รูปภาพ QR เท่านั้น', 'error');
  }
  if (!file.size || file.size > MAX_SLIP_SIZE) return showToast('ไฟล์ QR ต้องมีขนาดมากกว่า 0 และไม่เกิน 5MB', 'error');
  let newPath = '';
  try {
    showToast('⏳ กำลังบันทึก QR Code...', 'info');
    const blob = await compressQrImage(file);
    newPath = `rider_qr/${currentUser.uid}/payment-qr-${Date.now()}.png`;
    const ref = storage.ref(newPath);
    await ref.put(blob, { contentType: 'image/png' });
    const url = await ref.getDownloadURL();
    await db.collection('riders').doc(currentUser.uid).update({
      qrCodeUrl: url,
      qrCodePath: newPath
    });
    const oldPath = riderProfile.qrCodePath;
    riderProfile.qrCodeUrl = url;
    riderProfile.qrCodePath = newPath;
    if (oldPath && oldPath !== newPath) await storage.ref(oldPath).delete().catch(() => {});
    showToast('✅ บันทึก QR Code แล้ว', 'success');
    showProfile();
  } catch (err) {
    if (newPath) await storage.ref(newPath).delete().catch(() => {});
    console.error('handleRiderQrFile error:', err);
    showToast('บันทึก QR ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

async function removeRiderQr() {
  if (!currentUser || !riderProfile?.qrCodeUrl) return;
  if (!confirm('ลบ QR Code สำหรับรับโอนเงินใช่ไหม?')) return;
  try {
    if (riderProfile.qrCodePath) {
      await storage.ref(riderProfile.qrCodePath).delete().catch((err) => {
        if (err?.code !== 'storage/object-not-found') throw err;
      });
    }
    await db.collection('riders').doc(currentUser.uid).update({
      qrCodeUrl: firebase.firestore.FieldValue.delete(),
      qrCodePath: firebase.firestore.FieldValue.delete()
    });
    delete riderProfile.qrCodeUrl;
    delete riderProfile.qrCodePath;
    showToast('ลบ QR Code แล้ว', 'success');
    showProfile();
  } catch (err) {
    showToast('ลบ QR ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

function showProfile() {
  const mc = $('modalContent');
  if (!mc) return;
  setTimeout(refreshCameraPermissionUI, 0);
  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">👤 ข้อมูลส่วนตัว</h2>
    <div style="line-height:2;font-size:14px">
      <p><b>ชื่อ:</b> ${esc(riderProfile.name)}</p>
      <p><b>เบอร์:</b> ${esc(riderProfile.phone || '—')}</p>
      <p><b>อีเมล:</b> ${esc(riderProfile.email || '—')}</p>
      <p><b>ยานพาหนะ:</b> ${esc(riderProfile.vehicle || '—')}</p>
      <p><b>ทะเบียน:</b> ${esc(riderProfile.plate || '—')}</p>
      <p><b>สถานะ:</b> ${riderProfile.verified ? '✅ อนุมัติแล้ว' : '⏳ รออนุมัติ'}</p>
      <p><b>Rating:</b> ⭐ ${(riderProfile.rating || 0).toFixed(1)} (${riderProfile.totalRatings || 0} รีวิว)</p>
      <p><b>อัตรารับงาน:</b> ${Number(riderProfile.offersAccepted || 0)}/${Number(riderProfile.offersTotal || 0)} ข้อเสนอ</p>
      <p><b>งานทั้งหมด:</b> ${riderProfile.totalJobs || 0} งาน</p>
      <p><b>รายได้รวม:</b> ฿${fmt(riderProfile.totalIncome || 0)}</p>
      <p><b>Trust Score:</b> ⭐ ${riderProfile.trustScore || 100} / 100</p>
    </div>
    <div style="margin-top:16px;padding:14px;background:var(--surface-2);border-radius:14px">
      <div style="font-weight:900;margin-bottom:6px">📱 QR Code รับโอนเงินจากลูกค้า</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:10px">QR นี้จะถูกส่งให้ลูกค้าอัตโนมัติเมื่อไรเดอร์ถึงร้าน และหลังส่งรูปอาหาร พร้อมข้อความยอดที่ต้องโอน</div>
      ${riderProfile.qrCodeUrl ? `<img src="${esc(riderProfile.qrCodeUrl)}" alt="QR รับโอนเงิน" style="display:block;width:min(220px,100%);aspect-ratio:1;object-fit:contain;margin:8px auto 12px;background:#fff;border-radius:12px;padding:8px"><button class="action-btn-big btn-gray-big ripple" style="width:100%;margin-bottom:8px" onclick="removeRiderQr()">🗑️ ลบ QR Code</button>` : '<div style="padding:18px;text-align:center;border:2px dashed var(--border);border-radius:12px;color:var(--text-muted);font-weight:800;margin-bottom:10px">ยังไม่ได้แนบ QR Code</div>'}
      <input id="rider-qr-input" type="file" accept="image/*" style="display:none" onchange="handleRiderQrFile(event)">
      <button class="action-btn-big ${riderProfile.qrCodeUrl ? 'btn-gray-big' : 'btn-green-big'} ripple" style="width:100%" onclick="document.getElementById('rider-qr-input').click()">${riderProfile.qrCodeUrl ? '🔄 เปลี่ยน QR Code' : '📤 แนบ QR Code ของไรเดอร์'}</button>
    </div>
    <div style="margin-top:16px;padding:14px;background:var(--surface-2);border-radius:14px">
      <div style="font-weight:900;margin-bottom:6px">📷 สิทธิ์กล้องสำหรับถ่ายรูปอาหาร</div>
      <div id="camera-permission-status" style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:10px">กำลังตรวจสอบสิทธิ์กล้อง...</div>
      <button class="action-btn-big btn-orange-big ripple" style="width:100%" onclick="requestCameraPermissionFromSettings()">📷 อนุญาตและทดสอบกล้อง</button>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-top:8px">กดปุ่มนี้ครั้งเดียวก่อนรับงาน ระบบจะขอสิทธิ์กล้องอย่างเป็นทางการ แล้วจึงถ่ายรูปอาหารจากกล้องได้</div>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

async function refreshCameraPermissionUI() {
  const el = $('camera-permission-status');
  if (!el) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.textContent = 'เบราว์เซอร์นี้ไม่รองรับกล้องในเว็บ — ยังเลือกจากคลังภาพได้';
    return;
  }
  try {
    const permission = navigator.permissions && await navigator.permissions.query({ name: 'camera' });
    const state = permission && permission.state;
    el.textContent = state === 'granted'
      ? '✅ อนุญาตกล้องแล้ว พร้อมถ่ายรูปอาหาร'
      : state === 'denied'
        ? '⛔ กล้องถูกปฏิเสธ กรุณาเปิดสิทธิ์กล้องของเว็บไซต์ในการตั้งค่าเบราว์เซอร์'
        : '⚠️ ยังไม่ได้อนุญาตกล้อง กดปุ่มด้านล่างเพื่อขอสิทธิ์';
  } catch (err) {
    el.textContent = '⚠️ ยังไม่ได้ตรวจสอบสิทธิ์กล้อง กดปุ่มด้านล่างเพื่อทดสอบ';
  }
}

async function requestCameraPermissionFromSettings() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return showToast('เบราว์เซอร์นี้ไม่รองรับกล้องในเว็บ กรุณาเลือกจากคลังภาพ', 'warning', 6000);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(track => track.stop());
    showToast('✅ อนุญาตกล้องแล้ว สามารถถ่ายรูปอาหารได้', 'success', 5000);
    refreshCameraPermissionUI();
  } catch (err) {
    showToast('⛔ ยังเปิดกล้องไม่ได้ กรุณาเลือก “อนุญาต” เมื่อเบราว์เซอร์ถามสิทธิ์', 'error', 7000);
    refreshCameraPermissionUI();
  }
}

function showFinance() {
  const finished = allHistory.filter(j => j.status === 'done');
  const today = finished.filter(j => isToday(j.doneAt || j.createdAt));
  const week = finished.filter(j => {
    const d = toDate(j.doneAt);
    if (!d) return false;
    return d >= new Date(Date.now() - 7 * 86400000);
  });
  const month = finished.filter(j => {
    const d = toDate(j.doneAt);
    if (!d) return false;
    return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
  });

  const sum = (arr) => arr.reduce((s, j) => s + Number(j.riderIncome || 0), 0);
  const pendingOwe = finished.filter(j => !j.riderPaid).reduce((s, j) => s + Number(j.riderOwe || 0), 0);

  const mc = $('modalContent');
  if (!mc) return;
  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">💰 รายได้ & GP</h2>
    <div style="background:var(--header-grad);color:#fff;border-radius:16px;padding:20px;margin-bottom:12px">
      <div style="font-size:12px;opacity:.9;font-weight:700">รายได้วันนี้</div>
      <div style="font-size:36px;font-weight:900;margin-top:4px">฿${fmt(sum(today))}</div>
      <div style="font-size:12px;opacity:.9;margin-top:6px;font-weight:700">จาก ${today.length} งาน</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;box-shadow:var(--shadow-sm)">
        <div style="font-size:11px;color:var(--text-muted);font-weight:800">7 วัน</div>
        <div style="font-size:20px;font-weight:900;color:var(--brand);margin-top:4px">฿${fmt(sum(week))}</div>
      </div>
      <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;box-shadow:var(--shadow-sm)">
        <div style="font-size:11px;color:var(--text-muted);font-weight:800">30 วัน</div>
        <div style="font-size:20px;font-weight:900;color:var(--brand);margin-top:4px">฿${fmt(sum(month))}</div>
      </div>
    </div>
    <div style="background:var(--orange-light);border-left:4px solid var(--orange);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-size:12px;color:#E65100;font-weight:800">⚠️ GP ค้างโอน chauatgo (20%)</div>
      <div style="font-size:24px;font-weight:900;color:#E65100;margin-top:4px">฿${fmt(pendingOwe)}</div>
      <div style="font-size:11px;color:#E65100;font-weight:600;margin-top:2px">${allHistory.filter(j => !j.riderPaid).length} งาน</div>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showTransferShop() { showToast('💡 ระบบโอนร้านค้า — เร็ว ๆ นี้', 'info'); }
function showTransferApp() { showToast('💡 ระบบโอน chauatgo — เร็ว ๆ นี้', 'info'); }
function showGPIncome() { showToast('💎 GP 2% รอรับจาก chauatgo ทุก 15 วัน', 'info'); }

function showTrustScore() {
  const score = riderProfile?.trustScore || 100;
  const level = score >= 90 ? 'ยอดเยี่ยม' : score >= 70 ? 'ดี' : score >= 50 ? 'ปานกลาง' : 'ต้องปรับปรุง';
  const color = score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--blue)' : score >= 50 ? 'var(--orange)' : 'var(--red)';

  const mc = $('modalContent');
  if (!mc) return;
  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">🏆 Trust Score</h2>
    <div style="text-align:center;padding:20px;background:var(--surface-2);border-radius:16px;margin-bottom:14px">
      <div style="font-size:64px;font-weight:900;color:${color};line-height:1">${score}</div>
      <div style="font-size:13px;font-weight:800;color:var(--text-muted);margin-top:8px">${level}</div>
    </div>
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;font-size:13px;font-weight:700;line-height:1.9">
      <div>✅ โอนตรงเวลา: <b>+คะแนน</b></div>
      <div>✅ รีวิวดี: <b>+คะแนน</b></div>
      <div>✅ งานสำเร็จ: <b>+คะแนน</b></div>
      <div>⚠️ โอนช้า: <b>−คะแนน</b></div>
      <div>⚠️ ยกเลิกงานบ่อย: <b>−คะแนน</b></div>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showHistory() {
  const filtered = allHistory;
  const mc = $('modalContent');
  if (!mc) return;
  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 ประวัติงาน (${filtered.length})</h2>
    <div style="max-height:400px;overflow-y:auto">
    ${filtered.length === 0 ? '<p style="text-align:center;color:var(--text-light);padding:20px">ยังไม่มีงาน</p>' :
      filtered.slice(0, 50).map(j => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer" data-detail="${esc(j.id)}">
          <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
            <span>🧾 ${esc(orderLabel(j))}${j.title ? ' • ' + esc(j.title) : ''}</span>
            <span style="color:var(--green)">฿${fmt(j.riderIncome || 0)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-top:4px">
            🕐 ${fmtDateTime(historyMoment(j))} • ${j.status === 'cancelled' ? 'ยกเลิก' : 'เสร็จ'} • 👤 ${esc(j.userName || '')}
          </div>
        </div>
      `).join('')
    }
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

/* ═══════════════════════════════════════════════════════════════════
   23. CHAT
   ═══════════════════════════════════════════════════════════════════ */
async function openChatWithCustomer(orderId) {
  const job = allJobs.find(j => j.id === orderId) || allHistory.find(j => j.id === orderId);
  if (!job) return showToast('ไม่พบออเดอร์', 'error');

  activeChatId = orderId;
  activeChatCallRole = 'customer';
  activeChatPartnerName = job.userName || 'ลูกค้า';

  try {
    const chatRef = db.collection('chats').doc(orderId);
    const snap = await chatRef.get();
    if (!snap.exists) {
      await chatRef.set({
        orderId: orderId,
        userId: job.userId || '',
        userName: job.userName || 'ลูกค้า',
        riderId: currentUser.uid,
        riderName: riderProfile?.name || 'ไรเดอร์',
        merchantId: job.merchantId || '',
        merchantName: job.merchantName || '',
        lastMessage: '',
        lastSenderId: '',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      const data = snap.data();
      const updates = {};
      if (!data.merchantId && job.merchantId) updates.merchantId = job.merchantId;
      if (!data.merchantName && job.merchantName) updates.merchantName = job.merchantName;
      if (!data.userId && job.userId) updates.userId = job.userId;
      if (!data.riderId) updates.riderId = currentUser.uid;
      if (!data.riderName) updates.riderName = riderProfile?.name || 'ไรเดอร์';
      if (Object.keys(updates).length > 0) {
        try { await chatRef.update(updates); } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('openChatWithCustomer:', err.message);
  }

  const cn = $('chatName'); if (cn) cn.textContent = activeChatPartnerName;
  const cs = $('chatSub'); if (cs) cs.textContent = '🧾 ' + orderLabel(job) + (job.title ? ' • ' + job.title : '');
  $('chatContainer')?.classList.add('show');
  closeModal();

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(orderId).collection('messages')
    .orderBy('createdAt', 'asc').limit(200)
    .onSnapshot(snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChatMessages(msgs);
    }, err => { console.warn('Chat sub:', err.message); });
}

async function openChatRoom(orderId, name, sub) {
  const job = allJobs.find(j => j.id === orderId) || allHistory.find(j => j.id === orderId);
  if (!job) return showToast('ไม่พบออเดอร์', 'error');

  activeChatId = orderId;
  activeChatCallRole = 'customer';
  activeChatPartnerName = name || job.userName || 'ลูกค้า';

  try {
    const chatRef = db.collection('chats').doc(orderId);
    const snap = await chatRef.get();
    if (!snap.exists) {
      await chatRef.set({
        orderId: orderId,
        userId: job.userId || '',
        userName: job.userName || 'ลูกค้า',
        riderId: currentUser.uid,
        riderName: riderProfile?.name || 'ไรเดอร์',
        merchantId: job.merchantId || '',
        merchantName: job.merchantName || '',
        lastMessage: '',
        lastSenderId: '',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    console.warn('openChatRoom:', err.message);
  }

  const cn = $('chatName'); if (cn) cn.textContent = activeChatPartnerName;
  const cs = $('chatSub'); if (cs) cs.textContent = '🧾 ' + orderLabel(job) + (sub ? ' • ' + sub : (job.title ? ' • ' + job.title : ''));
  $('chatContainer')?.classList.add('show');

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(orderId).collection('messages')
    .orderBy('createdAt', 'asc').limit(200)
    .onSnapshot(snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChatMessages(msgs);
    }, err => { console.warn('Chat sub:', err.message); });
}

function closeChat() {
  $('chatContainer')?.classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function callChatPartner() {
  if (window.ChauatCall && activeChatId) ChauatCall.start(activeChatId, activeChatCallRole || 'customer');
  else showToast('โทรไม่ได้ตอนนี้', 'warning');
}

function renderChatMessages(msgs) {
  const el = $('chatMessages');
  if (!el) return;
  if (msgs.length === 0) {
    el.innerHTML = '<div class="chat-empty">เริ่มสนทนากับลูกค้า</div>';
    return;
  }

  let lastDay = '';
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === currentUser.uid || m.senderRole === 'rider';
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) {
      dayDiv = `<div class="chat-day-divider">${day}</div>`;
      lastDay = day;
    }
    const img = m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-image" onclick="window.open('${esc(m.imageUrl)}','_blank')">` : '';
    const sysStyle = m.systemMessage ? 'background:#FFF3E0;color:#E65100;border-left:3px solid #FF9800;' : '';
    return `${dayDiv}
      <div class="chat-msg ${isMine ? 'out' : 'in'}" style="${sysStyle}">
        ${img}
        ${m.text ? `<div style="white-space:pre-wrap">${esc(m.text)}</div>` : ''}
        <div class="msg-time">${fmtTime(m.createdAt)}</div>
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function ensureRiderChat(orderId) {
  const job = allJobs.find(j => j.id === orderId) || allHistory.find(j => j.id === orderId);
  let order = job;
  if (!order) {
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) {
      const missing = new Error('missing-order');
      missing.code = 'not-found';
      throw missing;
    }
    order = { id: snap.id, ...snap.data() };
  }
  if (order.riderId !== currentUser.uid) {
    const denied = new Error('not-party');
    denied.code = 'permission-denied';
    throw denied;
  }
  const chatRef = db.collection('chats').doc(orderId);
  const body = {
    orderId,
    userId: order.userId || '',
    userName: order.userName || 'ลูกค้า',
    riderId: order.riderId || '',
    riderName: order.riderName || riderProfile?.name || 'ไรเดอร์',
    merchantId: order.merchantId || '',
    merchantName: order.merchantName || ''
  };
  let snap = null;
  try { snap = await chatRef.get(); } catch (e) { snap = null; }
  if (!snap || !snap.exists) {
    await chatRef.set({
      ...body,
      lastMessage: '',
      lastSenderId: '',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    const data = snap.data() || {};
    const updates = {};
    ['orderId', 'userId', 'userName', 'riderId', 'riderName', 'merchantId', 'merchantName'].forEach((key) => {
      if ((data[key] || '') !== (body[key] || '')) updates[key] = body[key];
    });
    if (Object.keys(updates).length) {
      try { await chatRef.update(updates); } catch (e) {}
    }
  }
  return body;
}

async function sendChatText() {
  const text = $('chatInput')?.value.trim();
  if (!text || !activeChatId) return;
  const inp = $('chatInput');
  inp.value = '';
  inp.style.height = 'auto';

  try {
    await ensureRiderChat(activeChatId);
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text,
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: riderProfile?.name || currentUser.displayName || 'ไรเดอร์',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    try {
      await db.collection('chats').doc(activeChatId).update({
        lastMessage: text.slice(0, 80),
        lastSenderId: currentUser.uid,
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (previewErr) {
      console.warn('chat preview', previewErr && previewErr.code);
    }
  } catch (err) {
    console.warn('sendChatText error:', err);
    const code = (err && (err.code || err.message)) || '';
    showToast(String(code).indexOf('permission-denied') !== -1 ? 'ส่งไม่สำเร็จ: ไม่มีสิทธิ์ส่งข้อความ' : 'ส่งไม่สำเร็จ', 'error');
    inp.value = text;
  }
}

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > MAX_SLIP_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');
  try {
    const compressed = await compressImage(file, 800, 0.75);
    const path = `chats/${activeChatId}/riders/${currentUser.uid}/${Date.now()}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed, { contentType: 'image/jpeg' });
    const url = await ref.getDownloadURL();

    await ensureRiderChat(activeChatId);
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url,
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: riderProfile?.name || currentUser.displayName || 'ไรเดอร์',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    try {
      await db.collection('chats').doc(activeChatId).update({
        lastMessage: '📷 รูปภาพ',
        lastSenderId: currentUser.uid,
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (previewErr) {
      console.warn('chat preview', previewErr && previewErr.code);
    }
    showToast('✅ ส่งรูปแล้ว');
  } catch (err) {
    console.warn('sendChatImage error:', err);
    showToast('อัปโหลดไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ═══════════════════════════════════════════════════════════════════
   24. NETWORK & PWA
   ═══════════════════════════════════════════════════════════════════ */
function setupNetwork() {
  window.addEventListener('online', () => {
    $('offline-banner')?.classList.remove('show');
    showToast('🟢 กลับมาออนไลน์');
  });
  window.addEventListener('offline', () => {
    $('offline-banner')?.classList.add('show');
  });
  if (!navigator.onLine) $('offline-banner')?.classList.add('show');
}

let deferredPrompt = null;
function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('chauat_rider_pwa_dismissed')) {
      $('pwa-install-banner')?.classList.remove('hidden');
    }
  });
}

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(r => {
      if (r.outcome === 'accepted') {
        showToast('✅ ติดตั้งสำเร็จ');
        $('pwa-install-banner')?.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  } else {
    showToast('เปิดเมนู → เพิ่มไปที่หน้าจอหลัก', 'info');
  }
}

function dismissPWA() {
  $('pwa-install-banner')?.classList.add('hidden');
  localStorage.setItem('chauat_rider_pwa_dismissed', '1');
}

/* ═══════════════════════════════════════════════════════════════════
   24b. AUTO DISPATCH OFFER
   ═══════════════════════════════════════════════════════════════════ */
function callDispatch(name, data) {
  if (!window.ChauatFn) {
    return Promise.reject(new Error('ระบบจ่ายงานยังไม่เปิด — แอดมินต้องติดตั้ง Cloud Functions'));
  }
  return ChauatFn.callFunction(name, data, auth);
}

function subscribeDispatch() {
  if (dispatchUnsub) dispatchUnsub();
  dispatchUnsub = db.doc('config/dispatch').onSnapshot((snap) => {
    dispatchConfig = snap.exists ? (snap.data() || { mode: 'manual' }) : { mode: 'manual' };
    subscribeJobs();
    subscribeOffers();
    updatePushBanner();
    maybeRefreshPush();
  }, () => {
    dispatchConfig = { mode: 'manual' };
    subscribeJobs();
    subscribeOffers();
  });
}

function stopDispatchSubs() {
  if (dispatchUnsub) { dispatchUnsub(); dispatchUnsub = null; }
  if (offerUnsub) { offerUnsub(); offerUnsub = null; }
  clearOffer(false);
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

/* Countdown starts when this phone receives the offer. expiresAt - Date.now()
   hides the card in about a second when the phone clock is ahead of the server. */
function offerWindowMs(data) {
  const sec = Number(data && data.timeoutSec);
  if (Number.isFinite(sec) && sec >= 10 && sec <= 120) return Math.round(sec * 1000);
  const exp = timestampMs(data && data.expiresAt);
  const created = timestampMs(data && data.createdAt);
  if (exp > created && created > 0) {
    const diff = exp - created;
    if (diff >= 10000 && diff <= 120000) return diff;
  }
  return 20000;
}

function ensureOfferDeadline(id, data) {
  const known = offerDeadlines.get(id);
  if (known) return known;
  const deadline = Date.now() + offerWindowMs(data);
  offerDeadlines.set(id, deadline);
  return deadline;
}

function subscribeOffers() {
  if (!currentUser || dispatchMode() !== 'auto') {
    if (offerUnsub) { offerUnsub(); offerUnsub = null; }
    clearOffer(false);
    return;
  }
  if (offerUnsub) return;
  offerUnsub = db.collectionGroup('dispatchOffers')
    .where('riderId', '==', currentUser.uid)
    .where('status', '==', 'pending')
    .limit(20)
    .onSnapshot((snap) => {
      if (snap.metadata && snap.metadata.fromCache && snap.empty && currentOffer) return;
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        const parent = d.ref.parent && d.ref.parent.parent;
        const broadcast = data.broadcast === true;
        return {
          id: d.id,
          orderId: data.orderId || (parent ? parent.id : ''),
          riderId: data.riderId,
          title: data.title || '',
          merchantName: data.merchantName || '',
          pickupName: data.pickupName || '',
          fare: data.fare,
          orderCode: data.orderCode || '',
          distanceKm: data.distanceKm,
          broadcast: broadcast,
          deadlineMs: broadcast ? 0 : ensureOfferDeadline(d.id, data)
        };
      }).filter((o) => o.orderId && !hiddenOfferIds.has(o.id) && (o.broadcast || Date.now() < o.deadlineMs));
      rows.sort((a, b) => a.deadlineMs - b.deadlineMs);
      if (!rows.length) { clearOffer(true); return; }
      showOffer(rows[0]);
    }, (err) => console.warn('offers', err && err.code));
}

function showOffer(offer) {
  const same = currentOffer && currentOffer.id === offer.id && $('offer-seconds');
  currentOffer = offer;
  const el = $('dispatch-offer');
  if (!el) return;
  if (!same) {
    const who = offer.merchantName || offer.pickupName || offer.title || 'งานใหม่';
    const km = (typeof offer.distanceKm === 'number') ? offer.distanceKm.toFixed(1) + ' กม.' : '';
    const clock = offer.broadcast
      ? `<div style="font-size:22px;font-weight:900;color:var(--brand)">เปิดรับอยู่</div>
          <div style="font-size:12px;font-weight:800;color:var(--text-muted)">คนแรกที่กดรับได้งานนี้</div>`
      : `<div style="font-size:42px;font-weight:900;color:var(--brand)" id="offer-seconds">--</div>
          <div style="font-size:12px;font-weight:800;color:var(--text-muted)">วินาทีที่เหลือ</div>`;
    el.className = 'new-job-popup show';
    el.innerHTML = `
      <div class="new-job-card">
        <div class="popup-icon">🛵</div>
        <h2>มีงานเสนอให้คุณ</h2>
        <p>${esc(who)}</p>
        <div class="detail">
          ${clock}
          <div style="margin-top:8px;font-weight:800">${esc(offer.orderCode || offer.title || '')}</div>
          <div style="font-size:13px;margin-top:4px">${km ? esc(km) + ' • ' : ''}฿${fmt(offer.fare || 0)}</div>
        </div>
        <div class="job-actions two">
          <button type="button" class="action-btn-big btn-green-big ripple" onclick="acceptDispatchOffer()">✅ รับงาน</button>
          <button type="button" class="action-btn-big btn-gray-big ripple" onclick="skipDispatchOffer()">⏭️ ข้าม</button>
        </div>
      </div>`;
    startOfferAlert(offer.id, offer.broadcast ? Date.now() + 20000 : offer.deadlineMs);
  } else if (!el.classList.contains('show')) {
    el.className = 'new-job-popup show';
  }
  if (!offerTick) offerTick = setInterval(tickOffer, 250);
  tickOffer();
}

function clearOffer(stopSound) {
  if (offerTick) { clearInterval(offerTick); offerTick = null; }
  currentOffer = null;
  if (stopSound !== false) stopRepeatingAlert();
  const el = $('dispatch-offer');
  if (el) { el.className = 'new-job-popup'; el.innerHTML = ''; }
}

function tickOffer() {
  if (!currentOffer) return;
  if (currentOffer.broadcast) return;
  const deadline = currentOffer.deadlineMs || offerDeadlines.get(currentOffer.id) || 0;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const n = $('offer-seconds');
  if (n) n.textContent = String(left);
  if (deadline && Date.now() >= deadline) {
    hiddenOfferIds.add(currentOffer.id);
    clearOffer(true);
  }
}

function acceptErrorText(err) {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  if (code.indexOf('permission-denied') !== -1 || msg === 'permission' || msg === 'not-yours') {
    return 'ไม่มีสิทธิ์รับงานนี้ — รับได้เฉพาะงานที่ระบบเสนอให้คุณ';
  }
  if (msg === 'taken') return 'งานนี้มีคนรับแล้ว';
  if (msg === 'expired') return 'หมดเวลาเสนองานแล้ว';
  if (msg === 'stale') return 'ข้อเสนอนี้ไม่ใช่รอบปัจจุบัน';
  if (msg === 'closed') return 'ข้อเสนอนี้ปิดแล้ว';
  if (msg === 'missing' || msg === 'missing-order' || msg === 'missing-offer') return 'ไม่พบงานนี้';
  if (msg === 'not-ready' || msg === 'shop') return 'งานนี้ยังไม่พร้อมให้รับ';
  if (msg === 'busy') return 'ยังมีงานค้างอยู่ — รับงานใหม่ไม่ได้';
  if (msg === 'unverified') return 'บัญชียังไม่ได้รับการอนุมัติ';
  if (msg === 'auto') return 'โหมดอัตโนมัติ — กดรับจากใบเสนอ';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg) || code === 'unavailable') {
    return 'ติดต่อระบบไม่ได้ — ตรวจสัญญาณเน็ตแล้วลองอีกครั้ง';
  }
  if (msg) return msg;
  return 'รับงานไม่สำเร็จ';
}

/* The callable in asia-southeast1 assigns the order inside one transaction.
   Platform App Check is off so a rejection comes back with CORS headers. */
async function acceptDispatchOffer() {
  const o = currentOffer;
  if (!o || !currentUser || acceptingOffer) return;
  acceptingOffer = true;
  try {
    if (riderProfile && riderProfile.verified !== true) throw new Error('unverified');
    await callDispatch('acceptDispatchOffer', { orderId: o.orderId, offerId: o.id });
    hiddenOfferIds.add(o.id);
    clearOffer(true);
    showToast('รับงานแล้ว');
    sendAutomatedChatLater(o.orderId, 'accepted');
    scheduleGPSIfActive();
  } catch (err) {
    showToast(acceptErrorText(err), 'error', 6000);
  } finally {
    acceptingOffer = false;
  }
}

async function skipDispatchOffer() {
  const o = currentOffer;
  if (!o) return;
  hiddenOfferIds.add(o.id);
  clearOffer(true);
  try {
    await callDispatch('skipDispatchOffer', { orderId: o.orderId, offerId: o.id });
    showToast('ข้ามงานนี้', 'info');
  } catch (err) {
    showToast((err && err.message) || 'ข้ามไม่สำเร็จ — งานจะหมดเวลาเอง', 'error', 6000);
  }
}

function iosNeedsHomeScreen() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  const standalone = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return ios && !standalone;
}

async function enableRiderPush(silent) {
  if (silent !== true) unlockRiderAudio();
  if (iosNeedsHomeScreen()) {
    if (silent !== true) showToast('บน iPhone ต้องกดแชร์แล้วเลือก เพิ่มไปที่หน้าจอโฮม ก่อน จึงจะรับแจ้งเตือนได้', 'warning', 8000);
    return;
  }
  const vapid = (dispatchConfig && dispatchConfig.vapidKey) || '';
  if (!vapid) {
    if (silent !== true) showToast('แอดมินยังไม่ได้ใส่คีย์ Web Push ในหน้าจ่ายงาน', 'warning', 6000);
    updatePushBanner();
    return;
  }
  if (!('Notification' in window) || !firebase.messaging) {
    showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน', 'warning');
    return;
  }
  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
  }
  if (perm !== 'granted') {
    showToast('ยังไม่เปิดการแจ้งเตือน — จะไม่ได้รับงานเมื่อปิดแอป', 'warning', 6000);
    updatePushBanner();
    return;
  }
  try {
    const messaging = window.ChauatFcm ? ChauatFcm.install(firebaseApp) : firebase.messaging();
    const reg = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.ready;
    if (!messaging || !reg) throw new Error('no-worker');
    const token = await messaging.getToken({ vapidKey: vapid, serviceWorkerRegistration: reg });
    if (!token || !currentUser) throw new Error('no-token');
    await db.collection('riders').doc(currentUser.uid).update({
      fcmTokens: firebase.firestore.FieldValue.arrayUnion(token)
    });
    if (silent !== true) showToast('เปิดการแจ้งเตือนแล้ว รับงานได้แม้ปิดแอป');
  } catch (err) {
    if (silent !== true) showToast('เปิดการแจ้งเตือนไม่สำเร็จ', 'error');
  }
  updatePushBanner();
}

function maybeRefreshPush() {
  if (!currentUser || !dispatchConfig || !dispatchConfig.vapidKey) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (iosNeedsHomeScreen()) return;
  enableRiderPush(true).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════
   25. EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-skip],[data-arrived],[data-food-photo],[data-slip],[data-shop-closed],[data-paid],[data-start-deliver],[data-deliver],[data-detail],[data-chat]');
  if (!t) return;

  try {
    if (t.dataset.accept) await acceptJob(t.dataset.accept);
    else if (t.dataset.skip) skipJob(t.dataset.skip);
    else if (t.dataset.arrived) await arrivedAtShop(t.dataset.arrived);
    else if (t.dataset.foodPhoto) openFoodPhoto(t.dataset.foodPhoto);
    else if (t.dataset.slip) openShopSlip(t.dataset.slip);
    else if (t.dataset.shopClosed) await reportShopClosed(t.dataset.shopClosed);
    else if (t.dataset.paid) await confirmPaymentReceived(t.dataset.paid);
    else if (t.dataset.startDeliver) await startDelivery(t.dataset.startDeliver);
    else if (t.dataset.deliver) await deliverJob(t.dataset.deliver);
    else if (t.dataset.detail) showJobDetail(t.dataset.detail);
    else if (t.dataset.chat) openChatWithCustomer(t.dataset.chat);
  } catch (err) { console.warn('Event delegation:', err); }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .job-card, .jc-card, .jc-primary-btn');
  if (btn && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════════
   26. INIT
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  runSplash();
  bindAudioUnlock();
  syncSoundSettingsUI();
});

window.addEventListener('beforeunload', () => {
  clearPaymentTimers();
  stopGPS();
});

/* ═══════════════════════════════════════════════════════════════════
   27. EXPOSE GLOBALS
   ═══════════════════════════════════════════════════════════════════ */
window.toggleTheme = toggleTheme;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleForgotPassword = handleForgotPassword;
window.handleLogout = handleLogout;
window.toggleOnline = toggleOnline;
window.setJobFilter = setJobFilter;
window.unlockRiderAudio = unlockRiderAudio;
window.testRiderSound = testRiderSound;
window.chooseAlertTone = chooseAlertTone;
window.onSoundEnabledChange = onSoundEnabledChange;
window.onSoundVolumeInput = onSoundVolumeInput;
window.arrivedAtShop = arrivedAtShop;
window.openSheet = openSheet;
window.closeSheet = closeSheet;
window.closeModal = closeModal;
window.showProfile = showProfile;
window.requestCameraPermissionFromSettings = requestCameraPermissionFromSettings;
window.refreshCameraPermissionUI = refreshCameraPermissionUI;
window.handleRiderQrFile = handleRiderQrFile;
window.removeRiderQr = removeRiderQr;
window.showFinance = showFinance;
window.showTransferShop = showTransferShop;
window.showTransferApp = showTransferApp;
window.showGPIncome = showGPIncome;
window.showTrustScore = showTrustScore;
window.showHistory = showHistory;

/* Local e2e only. A production host never gets this hook. */
if (qaFilterHookEnabled()) {
  let qaLoadError = '';
  window.__QA_RIDER_FILTER__ = {
    setJobs: function (jobs) {
      currentUser = currentUser || { uid: 'qa-rider' };
      riderProfile = { ...(riderProfile || {}), uid: 'qa-rider', verified: true, status: 'active' };
      isOnline = true;
      dispatchConfig = { mode: 'manual' };
      openJobs = Array.isArray(jobs) ? jobs : [];
      activeMine = Array.isArray(jobs)
        ? jobs.filter(job => isActiveRiderJob(job, 'qa-rider'))
        : [];
      allHistory = [];
      qaLoadError = '';
      publishJobs(new Set());
    },
    setLoadError: function (message) {
      qaLoadError = String(message || 'ไม่สามารถโหลดงานได้');
      openJobs = [];
      activeMine = [];
      allHistory = [];
      allJobs = [];
      renderJobs();
    },
    triggerNewJobAlert: function (jobId) {
      startRepeatingAlert(jobId || 'qa-new-job');
    },
    setHistory: function (jobs) {
      allHistory = Array.isArray(jobs) ? jobs : [];
      renderJobs();
    },
    state: function () {
      return {
        filter: jobFilter,
        loadError: qaLoadError,
        newIds: Array.from(document.querySelectorAll('#new-jobs-list [data-card-id]')).map(el => el.dataset.cardId),
        activeIds: Array.from(document.querySelectorAll('#active-jobs-list [data-card-id]')).map(el => el.dataset.cardId),
        doneIds: Array.from(document.querySelectorAll('#done-jobs-list [data-card-id]')).map(el => el.dataset.cardId),
        newCount: document.getElementById('new-count')?.textContent || '0',
        activeCount: document.getElementById('active-count')?.textContent || '0',
        doneCount: document.getElementById('done-count')?.textContent || '0'
      };
    }
  };
}
window.showJobDetail = showJobDetail;
window.closeNewJobPopup = closeNewJobPopup;
window.acceptFromPopup = acceptFromPopup;
window.acceptDispatchOffer = acceptDispatchOffer;
window.skipDispatchOffer = skipDispatchOffer;
window.enableRiderPush = enableRiderPush;
window.openChatWithCustomer = openChatWithCustomer;
window.openChatRoom = openChatRoom;
window.closeChat = closeChat;
window.callChatPartner = callChatPartner;
window.sendChatText = sendChatText;
window.sendChatImage = sendChatImage;
window.autoResize = autoResize;
window.requestGPS = requestGPS;
window.installPWA = installPWA;
window.dismissPWA = dismissPWA;

/* Pickup modal */
window.handlePickupImage = handlePickupImage;
window.openLiveCamera = openLiveCamera;
window.closeLiveCamera = closeLiveCamera;
window.captureLivePhoto = captureLivePhoto;
window.confirmPickup = confirmPickup;
window.updatePickupConfirmBtn = updatePickupConfirmBtn;

/* Payment */
window.startDelivery = startDelivery;
window.confirmDeliver = confirmDeliver;

/* Service Worker */
if ('serviceWorker' in navigator) {
  const hadSwController = !!navigator.serviceWorker.controller;
  try {
    if (sessionStorage.getItem('chauat_sw_reload') === '1') sessionStorage.removeItem('chauat_sw_reload');
  } catch (e) {}
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSwController) return;
    try {
      if (sessionStorage.getItem('chauat_sw_reload') === '1') return;
      sessionStorage.setItem('chauat_sw_reload', '1');
    } catch (e) {}
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update();
        setInterval(() => reg.update(), 60000);
      })
      .catch(() => {});
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DONE!
   ═══════════════════════════════════════════════════════════════════ */
console.log('%c🛵 Chauat Go Rider v3.9.1 — Ready!', 'color:#FF6B35;font-weight:900;font-size:14px');
console.log('%c✅ v3.9.1: รองรับ searching + ready', 'color:#00A651;font-weight:800;font-size:12px');
console.log('%c✅ ถ่ายรูปอาหาร + สลิป • รอ customer_paid • Timeout 5/15 นาที', 'color:#2196F3;font-weight:700;font-size:11px');
