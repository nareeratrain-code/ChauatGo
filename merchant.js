/* ═══════════════════════════════════════════════════════════════════
   🏪 CHAUAT GO MERCHANT — v3.8.0
   Full-featured Production JavaScript
   
   ✅ subscribe searching → cooking → ready
   ✅ acceptOrder → cooking + สร้าง Order Code (OD-XXXX)
   ✅ cancelOrder → cancelled + แจ้งลูกค้า
   ✅ Order card แสดง code
   ✅ Chat ครบ
   ✅ Menu + Promotion ครบ
   ✅ Sound + Categories ครบ
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

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('[persistence]', e.code));

window.CHAUAT_MERCHANT_DEBUG = true;
console.log('%c🏪 Chauat Go Merchant v3.8.0', 'color:#00A651;font-weight:900;font-size:14px');

/* ═══════════════════════════════════════════════════════════════════
   2. GLOBAL STATE
   ═══════════════════════════════════════════════════════════════════ */
let currentUser = null;
let merchantProfile = null;
let allOrders = [];
let allMenus = [];
let currentHistoryFilter = 'today';
let activeChatId = null;
let activeChatUnsub = null;
let activeChatPartnerPhone = null;
let activeChatPartnerName = null;
let newOrderPopupId = null;
let seenOrderIds = new Set();
let myProfileUnsub = null;
let myOrdersUnsub = null;
let myMenusUnsub = null;
let audioCtx = null;
let deferredPrompt = null;
let isShopOpen = false;
let isSigningUp = false;

let isAudioUnlocked = false;
let orderLoopTimer = null;
let isFirstOrdersLoad = true;

let currentSoundSettings = { tone: 1, volume: 'mid' };

let editingMenuId = null;
let editingMenuImgBlob = null;
let editingMenuImgUrl = null;
let editingMenuStatus = 'available';
let editingPromoType = 'percent';

let gpSlipFile = null;
let currentGpPending = 0;

let pendingShopAvatarBlob = null;

let cropperInstance = null;
let cropTargetCallback = null;

let editingCategories = [];
let editingCategoryIndex = -1;
let editingCategoryIcon = '🍚';

let editingSoundTone = 1;
let editingSoundVolume = 'mid';

/* ═══════════════════════════════════════════════════════════════════
   3. CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */
const GP_RATE = 0.03;
const GP_RIDER_SHARE = 0.02;
const GP_PLATFORM_SHARE = 0.01;
const PROMO_DAYS = 60;
const MAX_IMG_SIZE = 5 * 1024 * 1024;
const ORDER_LOOP_INTERVAL = 3000;
const GP_BANK_INFO = { bank: 'กสิกรไทย', accountNo: 'xxx-x-xxxxx-x', accountName: 'บริษัท Chauat Go จำกัด' };

const SOUND_TONES = {
  1: { name: 'ติ๊ง-ติ๊ง', freqs: [880, 1108, 1318, 1108], interval: 0.18, duration: 0.18 },
  2: { name: 'บี๊บ-บี๊บ', freqs: [660, 660, 660], interval: 0.14, duration: 0.12 },
  3: { name: 'ระฆัง', freqs: [1318, 1568, 1318, 1046], interval: 0.16, duration: 0.22 }
};

const SOUND_VOLUMES = { low: 0.15, mid: 0.35, high: 0.65 };

const AVAILABLE_ICONS = [
  '🍚','🍲','🥗','🥤','🍰','📦',
  '🍜','🍕','🍔','🌮','🍣','🥘',
  '🍛','🍝','🥪','🍞','☕','🧋',
  '🍺','🍷','🍦','🍩','🎂','🍭'
];

const DEFAULT_CATEGORIES = [
  { id: 'main', name: 'อาหารจานหลัก', icon: '🍚', hidden: false, order: 1 },
  { id: 'side', name: 'กับข้าว', icon: '🍲', hidden: false, order: 2 },
  { id: 'yam', name: 'ยำ', icon: '🥗', hidden: false, order: 3 },
  { id: 'drink', name: 'เครื่องดื่ม', icon: '🥤', hidden: false, order: 4 },
  { id: 'dessert', name: 'ของหวาน', icon: '🍰', hidden: false, order: 5 },
  { id: 'other', name: 'อื่นๆ', icon: '📦', hidden: false, order: 6 }
];

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
const isThisWeek = (t) => { const d = toDate(t); return d ? d >= new Date(Date.now() - 7 * 86400000) : false; };
const isThisMonth = (t) => {
  const d = toDate(t);
  if (!d) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

/* ⭐ v3.8.0: Order Code Generator */
function generateOrderCode() {
  return 'OD-' + String(Math.floor(1000 + Math.random() * 9000));
}

function generateDeliveryCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function calcFinalPrice(menu) {
  if (!menu || !menu.price) return 0;
  if (!menu.promotion || !menu.promotion.active) return Number(menu.price);
  const p = menu.promotion;
  const value = Number(p.value || 0);
  if (value <= 0) return Number(menu.price);
  if (p.type === 'percent') return Math.max(0, Math.round(Number(menu.price) * (1 - value / 100)));
  if (p.type === 'amount') return Math.max(0, Number(menu.price) - value);
  return Number(menu.price);
}

function getPromoLabel(menu) {
  if (!menu || !menu.promotion || !menu.promotion.active) return '';
  const p = menu.promotion;
  const value = Number(p.value || 0);
  if (value <= 0) return '';
  if (p.type === 'percent') return `🔥 ลด ${value}%`;
  if (p.type === 'amount') return `🔥 ลด ${value}฿`;
  return '🔥 โปร';
}

function getStatusLabel(status) {
  if (status === 'out_of_stock') return { text: '🟡 วัตถุดิบหมด', cls: 'status-out' };
  if (status === 'hidden') return { text: '⚫ ซ่อน', cls: 'status-hidden' };
  return { text: '🟢 พร้อมขาย', cls: 'status-available' };
}

/* ═══════════════════════════════════════════════════════════════════
   5. THEME
   ═══════════════════════════════════════════════════════════════════ */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chauat_merchant_theme', next);
  const fab = $('theme-fab');
  if (fab) fab.textContent = next === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#0F1419' : '#00A651';
  showToast(next === 'dark' ? '🌙 โหมดมืด' : '☀️ โหมดสว่าง', 'info');
}

function initTheme() {
  const theme = localStorage.getItem('chauat_merchant_theme') || 'light';
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
function showToast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  t.textContent = (icons[type] || '') + ' ' + msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freqs, interval = 0.15, duration = 0.18, volume = 0.35) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, ctx.currentTime + i * interval);
    const start = ctx.currentTime + i * interval;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.start(start);
    osc.stop(start + duration);
  });
}

function soundNewOrder() {
  const tone = SOUND_TONES[currentSoundSettings.tone] || SOUND_TONES[1];
  const volume = SOUND_VOLUMES[currentSoundSettings.volume] || SOUND_VOLUMES.mid;
  playTone(tone.freqs, tone.interval, tone.duration, volume);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
}

function soundNewChat() {
  playTone([880], 0, 0.1, 0.25);
  if (navigator.vibrate) navigator.vibrate(50);
}

function playToneBySettings(toneId, volumeKey) {
  const tone = SOUND_TONES[toneId] || SOUND_TONES[1];
  const volume = SOUND_VOLUMES[volumeKey] || SOUND_VOLUMES.mid;
  playTone(tone.freqs, tone.interval, tone.duration, volume);
}

function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return showToast('ไม่สามารถเปิดเสียงได้', 'error');
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        isAudioUnlocked = true;
        hideUnlockBanner();
        showToast('🔔 เปิดเสียงเตือนแล้ว');
        setTimeout(() => soundNewOrder(), 300);
      }).catch(() => showToast('เปิดเสียงไม่สำเร็จ', 'error'));
    } else {
      isAudioUnlocked = true;
      hideUnlockBanner();
      showToast('🔔 เปิดเสียงเตือนแล้ว');
      setTimeout(() => soundNewOrder(), 300);
    }
  } catch (e) { showToast('เปิดเสียงไม่สำเร็จ', 'error'); }
}

function hideUnlockBanner() {
  const banner = $('sound-unlock-banner');
  if (banner) { banner.style.display = 'none'; banner.classList.add('hidden'); }
}

function showUnlockBanner() {
  const banner = $('sound-unlock-banner');
  if (banner && !isAudioUnlocked) { banner.style.display = 'flex'; banner.classList.remove('hidden'); }
}

function startOrderLoop() {
  if (orderLoopTimer) return;
  soundNewOrder();
  orderLoopTimer = setInterval(() => {
    const stillPending = allOrders.some(o => o.status === 'searching');
    if (!stillPending) { stopOrderLoop(); return; }
    soundNewOrder();
  }, ORDER_LOOP_INTERVAL);
}

function stopOrderLoop() {
  if (orderLoopTimer) { clearInterval(orderLoopTimer); orderLoopTimer = null; }
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

/* ═══════════════════════════════════════════════════════════════════
   9. FINANCE — GP
   ═══════════════════════════════════════════════════════════════════ */
function isPromoActive(merchant) {
  if (!merchant || !merchant.gpStartDate) return true;
  const start = toDate(merchant.gpStartDate);
  if (!start) return true;
  const daysPassed = Math.floor((Date.now() - start.getTime()) / 86400000);
  return daysPassed < PROMO_DAYS;
}

function getDaysLeft(merchant) {
  if (!merchant || !merchant.gpStartDate) return PROMO_DAYS;
  const start = toDate(merchant.gpStartDate);
  if (!start) return PROMO_DAYS;
  const daysPassed = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.max(0, PROMO_DAYS - daysPassed);
}

function calcGp(foodTotal, merchant) {
  if (isPromoActive(merchant)) return { total: 0, rider: 0, platform: 0, isPromo: true };
  const total = Math.round(foodTotal * GP_RATE * 100) / 100;
  const rider = Math.round(foodTotal * GP_RIDER_SHARE * 100) / 100;
  const platform = Math.round(foodTotal * GP_PLATFORM_SHARE * 100) / 100;
  return { total, rider, platform, isPromo: false };
}

function calcOrderFoodTotal(order) {
  return Number(order.itemsTotal || order.foodTotal || 0);
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
    $('login-error').textContent = '';
  } catch (err) {
    const msg = {
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบอีเมลนี้',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป',
      'auth/network-request-failed': 'ไม่มีการเชื่อมต่อ'
    }[err.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    $('login-error').textContent = msg;
    showToast(msg, 'error');
    btn.disabled = false;
    btn.textContent = '🔓 เข้าสู่ระบบ';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('btn-signup');
  const shopName = $('su-shop-name').value.trim();
  const category = $('su-category').value;
  const phone = $('su-phone').value.trim();
  const openTime = $('su-open-time').value;
  const closeTime = $('su-close-time').value;
  const address = $('su-address').value.trim();
  const email = $('su-email').value.trim().toLowerCase();
  const pw = $('su-password').value;
  const pw2 = $('su-password2').value;

  if (!shopName) return showToast('กรอกชื่อร้าน', 'error');
  if (!category) return showToast('เลือกประเภทร้าน', 'error');
  if (phone.replace(/\D/g, '').length < 9) return showToast('เบอร์ไม่ถูกต้อง', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('อีเมลไม่ถูกต้อง', 'error');
  if (pw.length < 6) return showToast('รหัสผ่าน 6+ ตัว', 'error');
  if (pw !== pw2) return showToast('รหัสไม่ตรงกัน', 'error');
  if (!$('gp-consent-check').checked) return showToast('กรุณายอมรับเงื่อนไข GP', 'error');

  btn.disabled = true;
  btn.textContent = '⏳ กำลังสมัคร...';
  let createdUser = null;
  isSigningUp = true;

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: shopName });

    await db.collection('users').doc(createdUser.uid).set({
      role: 'merchant', name: shopName, email: email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('merchants').doc(createdUser.uid).set({
      merchantId: createdUser.uid,
      name: shopName, category: category, phone: phone, email: email,
      address: address, openTime: openTime, closeTime: closeTime,
      isOpen: false, verified: false,
      ratingAvg: 0, ratingCount: 0,
      gpStartDate: null, gpPending: 0, gpPaid: 0, gpConsent: true,
      soundSettings: { tone: 1, volume: 'mid', updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ');

    setTimeout(async () => {
      try { await auth.signOut(); } catch (e) {}
      isSigningUp = false;
      switchAuthTab('login');
      const le = $('login-email');
      if (le) le.value = email;
      btn.disabled = false;
      btn.textContent = '🏪 สมัครร้านค้า';
      showToast('📧 เข้าสู่ระบบด้วยอีเมลที่สมัคร', 'info');
    }, 1800);
  } catch (err) {
    console.error('❌ Signup error:', err.code, err.message);
    if (createdUser) {
      try { await db.collection('users').doc(createdUser.uid).delete(); } catch (e) {}
      try { await createdUser.delete(); } catch (e) {}
    }
    isSigningUp = false;
    showToast('สมัครไม่สำเร็จ: ' + (err.code || err.message), 'error');
    btn.disabled = false;
    btn.textContent = '🏪 สมัครร้านค้า';
  }
}

async function handleForgotPassword() {
  const email = $('login-email').value.trim();
  if (!email) return showToast('กรอกอีเมลก่อน', 'error');
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว');
  } catch (err) { showToast('ส่งไม่สำเร็จ: ' + err.message, 'error'); }
}

async function handleMerchantLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  stopOrderLoop();
  closeSheet('menu-sheet');
  if (myProfileUnsub) myProfileUnsub();
  if (myOrdersUnsub) myOrdersUnsub();
  if (myMenusUnsub) myMenusUnsub();
  if (activeChatUnsub) activeChatUnsub();
  seenOrderIds.clear();
  allOrders = [];
  isFirstOrdersLoad = true;
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   11. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  if (isSigningUp) return;
  if (myProfileUnsub) myProfileUnsub();
  if (myOrdersUnsub) myOrdersUnsub();
  if (myMenusUnsub) myMenusUnsub();

  if (!user) {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    stopOrderLoop();
    return;
  }

  currentUser = user;

  try {
    let userDoc = null;
    let merchantDoc = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { userDoc = await db.collection('users').doc(user.uid).get(); } catch (e) {}
      try { merchantDoc = await db.collection('merchants').doc(user.uid).get(); } catch (e) {}
      if (userDoc?.exists && merchantDoc?.exists) break;
      if (attempt < 5) await new Promise(r => setTimeout(r, 1000));
    }

    if (!userDoc || !userDoc.exists) {
      showToast('ไม่พบข้อมูลบัญชี — กรุณาสมัครใหม่', 'error');
      await auth.signOut();
      return;
    }

    const userRole = userDoc.data().role;
    if (userRole !== 'merchant') {
      showToast('บัญชีนี้ไม่ใช่ร้านค้า (role: ' + userRole + ')', 'error');
      await auth.signOut();
      return;
    }

    if (!merchantDoc || !merchantDoc.exists) {
      showToast('ไม่พบข้อมูลร้านค้า — กรุณาสมัครใหม่', 'error');
      await auth.signOut();
      return;
    }

    merchantProfile = { uid: user.uid, ...merchantDoc.data() };
    loadSoundSettingsFromProfile();
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    initApp();
  } catch (err) {
    console.error('❌ Auth state error:', err);
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    await auth.signOut();
  }
});

function loadSoundSettingsFromProfile() {
  if (merchantProfile?.soundSettings) {
    const s = merchantProfile.soundSettings;
    currentSoundSettings = { tone: Number(s.tone) || 1, volume: s.volume || 'mid' };
  } else {
    currentSoundSettings = { tone: 1, volume: 'mid' };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   12. INIT APP
   ═══════════════════════════════════════════════════════════════════ */
function initApp() {
  updateHeader();
  updatePendingBanner();
  subscribeProfile();
  subscribeOrders();
  subscribeMenus();
  setupNetwork();
  setupPWA();
  requestNotificationPermission();

  setTimeout(() => {
    if (!isAudioUnlocked) showUnlockBanner();
  }, 1500);

  setTimeout(ensureMenuCategories, 2000);
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 3000);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   13. SUBSCRIBE
   ═══════════════════════════════════════════════════════════════════ */
function subscribeProfile() {
  if (myProfileUnsub) myProfileUnsub();
  myProfileUnsub = db.collection('merchants').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prevVerified = merchantProfile?.verified;
    merchantProfile = { uid: currentUser.uid, ...snap.data() };
    loadSoundSettingsFromProfile();

    if (prevVerified === false && merchantProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว!', 'success');
      soundNewOrder();
    }

    updateHeader();
    updatePendingBanner();
    updateShopToggle();
    updateHeroStats();
    updateGpTab();

    if ($('shop-profile-sheet')?.classList.contains('show')) {
      loadShopAvatarPreview();
    }
  });
}

/* ⭐ v3.8.0: subscribe searching orders */
function subscribeOrders() {
  if (myOrdersUnsub) myOrdersUnsub();
  myOrdersUnsub = db.collection('orders')
    .where('merchantId', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .onSnapshot(snap => {
      const prevIds = seenOrderIds;
      allOrders = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
      });

      /* ⭐ v3.8.0: New orders = status "searching" */
      const newOnes = allOrders.filter(o =>
        !prevIds.has(o.id) && o.status === 'searching' &&
        merchantProfile?.verified === true && isShopOpen
      );

      if (newOnes.length > 0 && prevIds.size > 0) {
        startOrderLoop();
        showNewOrderPopup(newOnes[0]);
      }

      const stillHasPending = allOrders.some(o => o.status === 'searching');
      if (!stillHasPending && orderLoopTimer) stopOrderLoop();

      seenOrderIds = new Set(allOrders.map(o => o.id));
      isFirstOrdersLoad = false;

      renderOrders();
      updateHeroStats();
      updateGpTab();
      updateNavBadge();
    }, err => { console.warn('Orders sub:', err.code); });
}

function subscribeMenus() {
  if (myMenusUnsub) myMenusUnsub();
  myMenusUnsub = db.collection('menus')
    .where('merchantId', '==', currentUser.uid)
    .onSnapshot(snap => {
      allMenus = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMenus();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   14. UI UPDATE
   ═══════════════════════════════════════════════════════════════════ */
function updateHeader() {
  if (!merchantProfile) return;
  const nameEl = $('shop-name');
  if (nameEl) nameEl.textContent = merchantProfile.name || 'ร้านค้า';
  const sheetName = $('sheet-shop-name');
  if (sheetName) sheetName.textContent = merchantProfile.name || 'ร้านค้า';
  updateSheetStatus();
  updateShopToggle();
}

function updateSheetStatus() {
  const statusEl = $('sheet-shop-status');
  if (!statusEl || !merchantProfile) return;
  if (merchantProfile.verified !== true) {
    statusEl.textContent = '⏳ รอการอนุมัติ';
    statusEl.style.color = 'var(--orange)';
  } else if (isShopOpen) {
    statusEl.textContent = '🟢 เปิดรับออเดอร์';
    statusEl.style.color = 'var(--green)';
  } else {
    statusEl.textContent = '⚫ ปิดร้าน';
    statusEl.style.color = 'var(--text-muted)';
  }
}

function updatePendingBanner() {
  const banner = $('pending-banner');
  if (!banner) return;
  banner.classList.toggle('show', merchantProfile?.verified !== true);
}

function updateShopToggle() {
  const btn = $('shop-toggle-btn');
  const lbl = $('toggle-label');
  const st = $('shop-status');
  if (!btn || !lbl || !st) return;

  isShopOpen = merchantProfile?.isOpen === true && merchantProfile?.verified === true;
  btn.classList.toggle('open', isShopOpen);
  btn.disabled = merchantProfile?.verified !== true;
  lbl.textContent = isShopOpen ? 'เปิดร้าน' : 'ปิดร้าน';
  st.textContent = merchantProfile?.verified !== true
    ? '⏳ รอการอนุมัติ'
    : (isShopOpen ? '🟢 เปิดรับออเดอร์' : '⚫ ปิดร้าน');
  updateSheetStatus();
}

function updateHeroStats() {
  const doneToday = allOrders.filter(o => o.status === 'done' && isToday(o.createdAt));
  let todayRevenue = 0;
  let todayGp = 0;
  doneToday.forEach(o => {
    const foodTotal = calcOrderFoodTotal(o);
    todayRevenue += foodTotal;
    const gp = calcGp(foodTotal, merchantProfile);
    todayGp += gp.total;
  });

  const revEl = $('hero-revenue');
  if (revEl) revEl.textContent = '฿' + fmt(todayRevenue);
  const subEl = $('hero-sub');
  if (subEl) subEl.textContent = `📦 ${doneToday.length} ออเดอร์`;

  const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  /* ⭐ v3.8.0: "searching" แทน "pending" */
  el('stat-new', allOrders.filter(o => o.status === 'searching' && isToday(o.createdAt)).length);
  el('stat-cooking', allOrders.filter(o => (o.status === 'cooking' || o.status === 'ready') && isToday(o.createdAt)).length);
  el('stat-done', doneToday.length);
  el('stat-gp', '฿' + fmt(todayGp));
}

function updateNavBadge() {
  /* ⭐ v3.8.0: "searching" แทน "pending" */
  const pending = allOrders.filter(o => o.status === 'searching').length;
  const badge = $('nav-orders-badge');
  if (badge) {
    if (pending > 0) { badge.textContent = pending; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
  }
}
/* ═══════════════════════════════════════════════════════════════════
   15. RENDER ORDERS
   ⭐ v3.8.0: ใช้ "searching" แทน "pending"
   ═══════════════════════════════════════════════════════════════════ */
function renderOrders() {
  const pending = allOrders.filter(o => o.status === 'searching');
  const cooking = allOrders.filter(o => o.status === 'cooking' || o.status === 'ready');
  const done = allOrders.filter(o => o.status === 'done' && isToday(o.createdAt));

  const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  el('cnt-new', pending.length);
  el('cnt-cooking', cooking.length);
  el('cnt-done', done.length);

  const nl = $('new-orders-list');
  if (nl) nl.innerHTML = pending.map(o => renderOrderCard(o)).join('');
  const cl = $('cooking-orders-list');
  if (cl) cl.innerHTML = cooking.map(o => renderOrderCard(o)).join('');
  const dl = $('done-orders-list');
  if (dl) dl.innerHTML = done.slice(0, 10).map(o => renderOrderCard(o)).join('');

  const empty = $('orders-empty');
  if (empty) empty.style.display = (pending.length + cooking.length + done.length) === 0 ? 'block' : 'none';
}

function renderOrderCard(o) {
  const isCash = o.paymentMode === 'cash';
  const statusMap = {
    searching: '🔔 รอรับ',
    pending: '🔔 รอรับ',
    cooking: '🍳 กำลังทำ',
    ready: '✅ พร้อมส่ง',
    accepted: '🛵 ไรเดอร์รับ',
    picked_up: '📦 ไรเดอร์รับของ',
    customer_paid: '💳 ลูกค้าโอน',
    on_the_way: '🚀 กำลังส่ง',
    delivered: '✅ ส่งถึง',
    done: '✅ เสร็จ',
    cancelled: '❌ ยกเลิก'
  };
  const statusLabel = statusMap[o.status] || o.status;
  const foodTotal = calcOrderFoodTotal(o);
  const itemsHtml = (o.items || []).map(i =>
    `<div class="item-row"><span class="item-name">${esc(i.name)} × ${i.qty}</span><b>฿${fmt(i.price * i.qty)}</b></div>`
  ).join('') || `<div>${esc(o.itemsText || '—')}</div>`;

  let actions = '';
  if (o.status === 'searching' || o.status === 'pending') {
    actions = `<div class="order-actions two">
      <button class="order-btn btn-accept ripple" onclick="acceptOrder('${esc(o.id)}')">✅ รับออเดอร์</button>
      <button class="order-btn btn-reject ripple" onclick="cancelOrder('${esc(o.id)}')">❌ ยกเลิก</button>
    </div>`;
  } else if (o.status === 'cooking') {
    actions = `<div class="order-actions two">
      <button class="order-btn btn-ready ripple" onclick="readyOrder('${esc(o.id)}')">✅ พร้อมส่ง</button>
      <button class="order-btn btn-gray ripple" onclick="viewOrderDetail('${esc(o.id)}')">📋 รายละเอียด</button>
    </div>`;
  } else if (o.status === 'ready') {
    actions = `<div class="order-actions">
      <button class="order-btn btn-gray ripple" onclick="viewOrderDetail('${esc(o.id)}')">📋 รอดำเนินการ</button>
    </div>`;
  } else {
    actions = `<div class="order-actions">
      <button class="order-btn btn-gray ripple" onclick="viewOrderDetail('${esc(o.id)}')">📋 ดูรายละเอียด</button>
    </div>`;
  }

  /* ⭐ v3.8.0: ปุ่มโทร + แชท */
  let contactActions = '';
  const hasCustomer = !!o.userPhone;
  const hasRider = !!o.riderPhone;

  if (hasCustomer && hasRider) {
    contactActions = `<div class="order-actions two" style="margin-top:8px">
      <a href="tel:${esc(o.userPhone)}" class="order-btn btn-blue ripple" style="text-decoration:none">📞 โทรลูกค้า</a>
      <button class="order-btn btn-blue ripple" onclick="openChatWithCustomer('${esc(o.id)}')">💬 แชทลูกค้า</button>
    </div>
    <div class="order-actions two" style="margin-top:6px">
      <a href="tel:${esc(o.riderPhone)}" class="order-btn btn-ready ripple" style="text-decoration:none">📞 โทรไรเดอร์</a>
      <button class="order-btn btn-ready ripple" onclick="openChatWithRider('${esc(o.id)}')">💬 แชทไรเดอร์</button>
    </div>`;
  } else if (hasCustomer) {
    contactActions = `<div class="order-actions two" style="margin-top:8px">
      <a href="tel:${esc(o.userPhone)}" class="order-btn btn-blue ripple" style="text-decoration:none">📞 โทรลูกค้า</a>
      <button class="order-btn btn-blue ripple" onclick="openChatWithCustomer('${esc(o.id)}')">💬 แชทลูกค้า</button>
    </div>`;
  } else if (hasRider) {
    contactActions = `<div class="order-actions two" style="margin-top:8px">
      <a href="tel:${esc(o.riderPhone)}" class="order-btn btn-ready ripple" style="text-decoration:none">📞 โทรไรเดอร์</a>
      <button class="order-btn btn-ready ripple" onclick="openChatWithRider('${esc(o.id)}')">💬 แชทไรเดอร์</button>
    </div>`;
  }

  const badge = isCash
    ? '<span class="cash-badge">💵 เงินสด</span>'
    : '<span class="transfer-badge">💳 โอน</span>';

  const riderInfo = o.riderName
    ? `<div class="order-meta" style="color:var(--brand);font-weight:900">🛵 ${esc(o.riderName)}${o.riderPhone ? ' • '+esc(o.riderPhone) : ''}</div>`
    : '';

  /* ⭐ v3.8.0: แสดง Order Code */
  const codeHtml = o.code
    ? `<div style="font-size:11px;font-weight:900;color:var(--brand);margin-bottom:4px">🧾 ${esc(o.code)}</div>`
    : '';

  return `<div class="order-card status-${o.status}">
    <div class="order-top">
      <div class="order-emoji">🍽️</div>
      <div class="order-info">
        <div class="order-id">#${esc(o.id.slice(-8))}</div>
        ${codeHtml}
        <div class="order-title">${esc(o.userName || 'ลูกค้า')}</div>
        <div class="order-meta">🕐 ${timeAgo(o.createdAt)} • ${statusLabel}</div>
        ${riderInfo}
        <div>${badge}</div>
      </div>
    </div>
    <div class="order-items">${itemsHtml}</div>
    <div class="order-total">
      <div><div class="sub">ยอดอาหาร</div><div>฿${fmt(foodTotal)}</div></div>
      <div class="amt">฿${fmt(foodTotal)}</div>
    </div>
    ${actions}
    ${contactActions}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   16. ORDER ACTIONS — ⭐ v3.8.0
   ═══════════════════════════════════════════════════════════════════ */

/* ⭐ v3.8.0: acceptOrder → cooking + สร้าง Order Code */
async function acceptOrder(orderId) {
  try {
    const orderCode = generateOrderCode();
    const deliveryCode = generateDeliveryCode();

    await db.collection('orders').doc(orderId).update({
      status: 'cooking',
      cookingAt: firebase.firestore.FieldValue.serverTimestamp(),
      code: orderCode,
      deliveryCode: deliveryCode,
      codeCreatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    stopOrderLoop();
    showToast('🍳 เริ่มทำอาหาร • Order ' + orderCode);
  } catch (err) {
    console.error('acceptOrder error:', err);
    showToast('ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

async function readyOrder(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'ready',
      readyAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ พร้อมส่ง');
  } catch (err) { showToast('ไม่สำเร็จ', 'error'); }
}

/* ⭐ v3.8.0: cancelOrder + แจ้งลูกค้า */
async function cancelOrder(orderId) {
  const order = allOrders.find(x => x.id === orderId);
  if (!order) return showToast('ไม่พบออเดอร์', 'error');

  const reason = prompt('เหตุผลที่ยกเลิก:\n(เช่น วัตถุดิบหมด, ปิดร้าน, ครัวเต็ม)');
  if (reason === null) return; // user กด Cancel

  try {
    await db.collection('orders').doc(orderId).update({
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: 'merchant',
      cancelReason: reason || 'ร้านค้ายกเลิก'
    });

    /* ⭐ v3.8.0: เขียนข้อความแจ้งลูกค้าใน chat */
    try {
      const chatRef = db.collection('chats').doc(orderId);
      const chatSnap = await chatRef.get();

      if (!chatSnap.exists) {
        await chatRef.set({
          orderId: orderId,
          userId: order.userId || '',
          userName: order.userName || 'ลูกค้า',
          riderId: order.riderId || '',
          riderName: order.riderName || '',
          merchantId: currentUser.uid,
          merchantName: merchantProfile.name,
          lastMessage: '',
          lastSenderId: '',
          lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      const cancelMessage = `❌ ร้านค้ายกเลิกออเดอร์\n📝 เหตุผล: ${reason || 'ร้านค้ายกเลิก'}\n\nขออภัยในความไม่สะดวก 🙏`;

      await db.collection('chats').doc(orderId).collection('messages').add({
        text: cancelMessage,
        senderId: currentUser.uid,
        senderRole: 'merchant',
        senderName: merchantProfile.name,
        systemMessage: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('chats').doc(orderId).update({
        lastMessage: '❌ ยกเลิก: ' + (reason || 'ร้านค้ายกเลิก'),
        lastSenderId: currentUser.uid,
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (chatErr) {
      console.warn('Cancel message failed:', chatErr.message);
    }

    stopOrderLoop();
    showToast('❌ ยกเลิกออเดอร์ + แจ้งลูกค้าแล้ว');
  } catch (err) {
    console.error('cancelOrder error:', err);
    showToast('ไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   17. ORDER DETAIL SHEET
   ═══════════════════════════════════════════════════════════════════ */
function viewOrderDetail(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  const foodTotal = calcOrderFoodTotal(o);
  const gp = calcGp(foodTotal, merchantProfile);
  const isCash = o.paymentMode === 'cash';

  const itemsHtml = (o.items || []).map(i =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span>${esc(i.name)} × ${i.qty}</span><b>฿${fmt(i.price * i.qty)}</b>
    </div>`
  ).join('') || `<div>${esc(o.itemsText || '—')}</div>`;

  /* ⭐ v3.8.0: แสดง Order Code */
  const codeHtml = o.code
    ? `<div style="background:linear-gradient(135deg,#76B82A,#5A8E1F);color:#fff;border-radius:12px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:11px;opacity:.9;font-weight:800">🧾 Order Code</div>
        <div style="font-size:24px;font-weight:900;letter-spacing:3px;margin-top:4px">${esc(o.code)}</div>
      </div>`
    : '';

  const $content = $('order-detail-content');
  if ($content) {
    $content.innerHTML = `
      ${codeHtml}
      <div style="background:var(--surface-2);border-radius:14px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-muted);font-weight:800">#${esc(o.id.slice(-8))}</div>
        <div style="font-size:15px;font-weight:900;margin-top:4px">${esc(o.userName || 'ลูกค้า')}</div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;margin-top:4px">📞 ${esc(o.userPhone || '—')}</div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;margin-top:4px">📍 ${esc(o.address || '—')}</div>
        ${o.note ? `<div style="font-size:12px;color:#E65100;font-weight:700;margin-top:6px;padding:8px;background:#FFF3E0;border-radius:8px">📝 ${esc(o.note)}</div>` : ''}
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:900;margin-bottom:8px">🍽️ รายการอาหาร</div>
        ${itemsHtml}
      </div>
      <div style="background:${isCash?'#FFF3E0':'#E3F2FD'};border-radius:14px;padding:14px;margin-bottom:14px;font-size:13px;font-weight:700">
        <div style="font-weight:900;margin-bottom:8px">${isCash?'💵 ลูกค้าจ่ายเงินสด':'💳 ลูกค้าโอนเงิน'}</div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>ยอดอาหาร</span><b>฿${fmt(foodTotal)}</b></div>
        ${o.fare?'<div style="display:flex;justify-content:space-between;padding:3px 0"><span>ค่าส่ง (ของไรเดอร์)</span><b>฿'+fmt(o.fare)+'</b></div>':''}
        ${isCash&&o.cashTip?'<div style="display:flex;justify-content:space-between;padding:3px 0;color:#E65100"><span>ค่าบริการพิเศษ (ทิป)</span><b>฿'+fmt(o.cashTip)+'</b></div>':''}
        <div style="display:flex;justify-content:space-between;padding:8px 0 0;border-top:1px solid var(--border);margin-top:6px;font-size:15px;font-weight:900">
          <span>ร้านได้รับ</span><span style="color:var(--green)">฿${fmt(foodTotal)}</span>
        </div>
      </div>
      ${!gp.isPromo ? `<div style="background:#FFF9C4;border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;font-weight:700">
        <div style="font-weight:900;margin-bottom:6px">💰 GP 3%</div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>รวม</span><b>฿${fmt(gp.total)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;padding-left:16px;color:#FF6B35"><span>├─ ไรเดอร์ 2%</span><b>฿${fmt(gp.rider)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;padding-left:16px;color:#4A90D9"><span>└─ แพลตฟอร์ม 1%</span><b>฿${fmt(gp.platform)}</b></div>
      </div>` : `<div style="background:#E8F5E9;border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;font-weight:900;text-align:center;color:var(--green)">🎉 อยู่ในช่วงโปรโมชั่น — ไม่คิด GP</div>`}
    `;
  }

  const actionsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      ${o.userPhone?`<a href="tel:${esc(o.userPhone)}" class="order-btn btn-accept ripple" style="text-decoration:none">📞 โทรลูกค้า</a>`:''}
      <button class="order-btn btn-cook ripple" onclick="openChatWithCustomer('${esc(o.id)}')">💬 แชทลูกค้า</button>
    </div>
    ${o.riderPhone?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <a href="tel:${esc(o.riderPhone)}" class="order-btn btn-ready ripple" style="text-decoration:none">📞 โทรไรเดอร์</a>
      <button class="order-btn btn-gray ripple" onclick="openChatWithRider('${esc(o.id)}')">💬 แชทไรเดอร์</button>
    </div>`:''}
  `;
  const $actions = $('order-detail-actions');
  if ($actions) $actions.innerHTML = actionsHtml;

  openSheet('order-detail-sheet');
}

/* ═══════════════════════════════════════════════════════════════════
   18. NEW ORDER POPUP
   ═══════════════════════════════════════════════════════════════════ */
function showNewOrderPopup(order) {
  newOrderPopupId = order.id;
  const foodTotal = calcOrderFoodTotal(order);
  const isCash = order.paymentMode === 'cash';

  const detail = $('new-order-detail');
  if (detail) {
    detail.innerHTML = `
      ${order.code ? `<div style="font-size:16px;font-weight:900;color:var(--brand);text-align:center;padding:8px;background:var(--brand-light);border-radius:8px;margin-bottom:10px">🧾 ${esc(order.code)}</div>` : ''}
      <div>👤 <b>${esc(order.userName || 'ลูกค้า')}</b></div>
      <div>📞 <b>${esc(order.userPhone || '—')}</b></div>
      <div>📍 ${esc((order.address || '').slice(0, 50))}</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
        💰 <b style="font-size:18px;color:var(--green)">฿${fmt(foodTotal)}</b>
        ${isCash?'<div style="font-size:11px;color:#E65100;font-weight:900;margin-top:4px">💵 ลูกค้าจ่ายเงินสด</div>':'<div style="font-size:11px;color:#1976D2;font-weight:900;margin-top:4px">💳 ลูกค้าโอนเงิน</div>'}
      </div>
    `;
  }

  $('new-order-popup')?.classList.add('show');

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('🔔 ออเดอร์ใหม่!', {
        body: `${order.userName || 'ลูกค้า'} — ฿${fmt(foodTotal)}`,
        icon: '/icons/icon-512.png',
        tag: 'new-order-' + order.id
      });
    } catch (e) {}
  }
}

function closeNewOrderPopup() {
  $('new-order-popup')?.classList.remove('show');
  newOrderPopupId = null;
}

function acceptFromPopup() {
  stopOrderLoop();
  if (newOrderPopupId) acceptOrder(newOrderPopupId);
  closeNewOrderPopup();
}

/* ═══════════════════════════════════════════════════════════════════
   19. SHOP TOGGLE
   ═══════════════════════════════════════════════════════════════════ */
async function toggleShop() {
  if (!currentUser || merchantProfile?.verified !== true) {
    return showToast('รอแอดมินอนุมัติก่อน', 'warning');
  }
  const newState = !isShopOpen;
  try {
    await db.collection('merchants').doc(currentUser.uid).update({
      isOpen: newState,
      lastToggle: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (!newState) stopOrderLoop();
    showToast(newState ? '🟢 เปิดร้าน' : '⚫ ปิดร้าน');
  } catch (err) { showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error'); }
}

/* ═══════════════════════════════════════════════════════════════════
   20. SHEET / MODAL / TABS
   ═══════════════════════════════════════════════════════════════════ */
function openSheet(id) { const el = $(id); if (el) el.classList.add('show'); }
function closeSheet(id) {
  const el = $(id);
  if (el) el.classList.remove('show');
  if (id === 'menu-form-sheet') {
    editingMenuId = null;
    editingMenuImgBlob = null;
    editingMenuImgUrl = null;
    editingMenuStatus = 'available';
    editingPromoType = 'percent';
  }
}

function switchTab(tab, el) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const target = $('tab-' + tab);
  if (target) target.classList.add('active');
  if (tab === 'history') renderHistory();
  if (tab === 'gp') updateGpTab();
}
/* ═══════════════════════════════════════════════════════════════════
   21. MENUS
   ═══════════════════════════════════════════════════════════════════ */
function renderMenus() {
  const list = $('menu-list');
  if (!list) return;
  const empty = $('menus-empty');
  const countText = $('menu-count-text');
  if (countText) countText.textContent = allMenus.length + ' เมนู';

  if (!allMenus.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = allMenus.map(m => {
    const hasImg = m.image && m.image.startsWith('http');
    const imgHtml = hasImg
      ? `<img src="${esc(m.image)}" onerror="this.parentElement.innerHTML='🍽️'">`
      : '🍽️';

    const status = m.status || 'available';
    const statusInfo = getStatusLabel(status);
    const itemCls = status === 'hidden' ? 'status-hidden-item'
                  : status === 'out_of_stock' ? 'status-out-item'
                  : 'status-available-item';

    const promoLabel = getPromoLabel(m);
    const finalPrice = calcFinalPrice(m);
    const hasPromo = !!(m.promotion && m.promotion.active && Number(m.promotion.value) > 0);

    const priceHtml = hasPromo
      ? `<div class="menu-price-display">
          <span class="menu-price-old">฿${fmt(m.price)}</span>
          <span class="menu-price-new">฿${fmt(finalPrice)}</span>
        </div>`
      : `<div class="menu-item-price">฿${fmt(m.price)}</div>`;

    const badgesHtml = `
      <div class="menu-badges-row">
        <span class="status-badge ${statusInfo.cls}">${statusInfo.text}</span>
        ${promoLabel ? `<span class="promo-badge">${promoLabel}</span>` : ''}
      </div>
    `;

    return `<div class="menu-item ${itemCls}">
      <div class="menu-item-img">${imgHtml}</div>
      <div class="menu-item-info">
        <div class="menu-item-name">${esc(m.name)}</div>
        ${m.description?`<div class="menu-item-desc">${esc(m.description)}</div>`:''}
        ${priceHtml}
        ${badgesHtml}
      </div>
      <div class="menu-item-actions">
        <button class="menu-action-btn btn-edit-menu ripple" onclick="editMenu('${esc(m.id)}')">✏️</button>
        <button class="menu-action-btn btn-del-menu ripple" onclick="deleteMenu('${esc(m.id)}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openMenuForm(menuId) {
  editingMenuId = menuId || null;
  editingMenuImgBlob = null;
  editingMenuImgUrl = null;
  editingMenuStatus = 'available';
  editingPromoType = 'percent';

  const titleEl = $('menu-form-title');
  if (titleEl) titleEl.textContent = editingMenuId ? '✏️ แก้ไขเมนู' : '➕ เพิ่มเมนูใหม่';

  if (editingMenuId) {
    const m = allMenus.find(x => x.id === editingMenuId);
    if (m) {
      $('mf-name').value = m.name || '';
      $('mf-price').value = m.price || '';
      $('mf-category').value = m.category || 'main';
      $('mf-desc').value = m.description || '';

      editingMenuStatus = m.status || 'available';
      updateStatusUI();

      const promo = m.promotion || {};
      const promoActive = !!promo.active;
      if ($('mf-promo-active')) $('mf-promo-active').checked = promoActive;
      editingPromoType = promo.type || 'percent';
      updatePromoTypeUI();
      if ($('mf-promo-value')) $('mf-promo-value').value = promo.value || '';
      onPromoToggle();
      setTimeout(updatePromoPreview, 100);

      if (m.image && m.image.startsWith('http')) {
        editingMenuImgUrl = m.image;
        const preview = $('img-preview');
        if (preview) { preview.src = m.image; preview.style.display = 'block'; }
        const placeholder = $('img-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        const removeBtn = $('remove-img-btn');
        if (removeBtn) removeBtn.style.display = 'block';
      }
    }
  } else {
    $('mf-name').value = '';
    $('mf-price').value = '';
    $('mf-category').value = 'main';
    $('mf-desc').value = '';
    const preview = $('img-preview');
    if (preview) preview.style.display = 'none';
    const placeholder = $('img-placeholder');
    if (placeholder) placeholder.style.display = 'block';
    const removeBtn = $('remove-img-btn');
    if (removeBtn) removeBtn.style.display = 'none';

    editingMenuStatus = 'available';
    updateStatusUI();
    if ($('mf-promo-active')) $('mf-promo-active').checked = false;
    editingPromoType = 'percent';
    updatePromoTypeUI();
    if ($('mf-promo-value')) $('mf-promo-value').value = '';
    onPromoToggle();
  }

  openSheet('menu-form-sheet');

  setTimeout(() => {
    const currentCat = menuId
      ? (allMenus.find(x => x.id === menuId)?.category || 'main')
      : (getMenuCategories().filter(c => !c.hidden)[0]?.id || 'main');
    renderCategoryDropdown(currentCat);
  }, 50);
}

function pickMenuStatus(status) { editingMenuStatus = status; updateStatusUI(); }

function updateStatusUI() {
  document.querySelectorAll('.status-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === editingMenuStatus);
  });
  const hidden = $('mf-status');
  if (hidden) hidden.value = editingMenuStatus;
}

function onPromoToggle() {
  const active = $('mf-promo-active')?.checked || false;
  const fields = $('mf-promo-fields');
  if (fields) fields.style.display = active ? 'block' : 'none';
  if (active) updatePromoPreview();
}

function pickPromoType(type) { editingPromoType = type; updatePromoTypeUI(); updatePromoPreview(); }

function updatePromoTypeUI() {
  document.querySelectorAll('.promo-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.promoType === editingPromoType);
  });
  const hidden = $('mf-promo-type');
  if (hidden) hidden.value = editingPromoType;

  const unit = $('mf-promo-unit');
  const label = $('mf-promo-value-label');
  const quickPercent = $('promo-quick-percent');
  const quickAmount = $('promo-quick-amount');

  if (editingPromoType === 'percent') {
    if (unit) unit.textContent = '%';
    if (label) label.textContent = 'ลด';
    if (quickPercent) quickPercent.style.display = 'flex';
    if (quickAmount) quickAmount.style.display = 'none';
  } else {
    if (unit) unit.textContent = '฿';
    if (label) label.textContent = 'ลด';
    if (quickPercent) quickPercent.style.display = 'none';
    if (quickAmount) quickAmount.style.display = 'flex';
  }
}

function setPromoValue(v) {
  const input = $('mf-promo-value');
  if (input) input.value = v;
  updatePromoPreview();
}

function updatePromoPreview() {
  const preview = $('mf-promo-preview-text');
  if (!preview) return;
  const price = Number($('mf-price')?.value || 0);
  const value = Number($('mf-promo-value')?.value || 0);
  const active = $('mf-promo-active')?.checked || false;
  if (!active || price <= 0 || value <= 0) { preview.textContent = '—'; return; }
  let finalPrice = price;
  if (editingPromoType === 'percent') finalPrice = Math.max(0, Math.round(price * (1 - value / 100)));
  else finalPrice = Math.max(0, price - value);
  const saved = price - finalPrice;
  preview.textContent = `฿${price} → ฿${finalPrice} (ประหยัด ฿${saved})`;
}

function previewMenuImg(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');

  const reader = new FileReader();
  reader.onload = (e) => {
    openCropModal(e.target.result, (croppedFile, dataUrl) => {
      editingMenuImgBlob = croppedFile;
      editingMenuImgUrl = null;
      const preview = $('img-preview');
      if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
      const placeholder = $('img-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      const removeBtn = $('remove-img-btn');
      if (removeBtn) removeBtn.style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeMenuImg() {
  editingMenuImgBlob = null;
  editingMenuImgUrl = null;
  const preview = $('img-preview');
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  const placeholder = $('img-placeholder');
  if (placeholder) placeholder.style.display = 'block';
  const removeBtn = $('remove-img-btn');
  if (removeBtn) removeBtn.style.display = 'none';
  const input = $('menu-img-input');
  if (input) input.value = '';
}

async function saveMenu() {
  if (!currentUser) return;
  const name = $('mf-name').value.trim();
  const price = parseInt($('mf-price').value);
  const category = $('mf-category').value;
  const desc = $('mf-desc').value.trim();

  if (!name) return showToast('กรอกชื่อเมนู', 'error');
  if (!price || price < 1) return showToast('กรอกราคา', 'error');

  const status = editingMenuStatus || 'available';
  const promoActive = $('mf-promo-active')?.checked || false;
  const promoType = editingPromoType || 'percent';
  const promoValue = parseInt($('mf-promo-value')?.value || 0);

  if (promoActive) {
    if (!promoValue || promoValue < 1) return showToast('กรอกค่าส่วนลด', 'error');
    if (promoType === 'percent' && (promoValue < 1 || promoValue > 100)) return showToast('ส่วนลด % ต้องอยู่ 1-100', 'error');
    if (promoType === 'amount' && promoValue >= price) return showToast('ส่วนลดต้องน้อยกว่าราคา', 'error');
  }

  const btn = $('btn-save-menu');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    let imageUrl = editingMenuImgUrl;
    if (editingMenuImgBlob) {
      const compressed = await compressImage(editingMenuImgBlob, 800, 0.8);
      const path = `menus/${currentUser.uid}/${Date.now()}.jpg`;
      const ref = storage.ref(path);
      await ref.put(compressed);
      imageUrl = await ref.getDownloadURL();
    }

    const promoData = promoActive && promoValue > 0
      ? { active: true, type: promoType, value: promoValue, label: promoType === 'percent' ? `🔥 ลด ${promoValue}%` : `🔥 ลด ${promoValue}฿` }
      : { active: false, type: 'percent', value: 0, label: '' };

    const data = {
      merchantId: currentUser.uid,
      name: name, price: price, category: category, description: desc,
      image: imageUrl || '', status: status,
      statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      promotion: promoData,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (editingMenuId) {
      await db.collection('menus').doc(editingMenuId).update(data);
      showToast('✅ แก้ไขเมนูแล้ว');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('menus').add(data);
      showToast('✅ เพิ่มเมนูแล้ว');
    }
    closeSheet('menu-form-sheet');
  } catch (err) {
    console.error('saveMenu error:', err);
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกเมนู'; }
  }
}

function editMenu(menuId) { openMenuForm(menuId); }

async function deleteMenu(menuId) {
  if (!confirm('ลบเมนูนี้?')) return;
  try {
    await db.collection('menus').doc(menuId).delete();
    showToast('🗑️ ลบเมนูแล้ว');
  } catch (err) { showToast('ลบไม่สำเร็จ', 'error'); }
}

/* ═══════════════════════════════════════════════════════════════════
   22. HISTORY
   ═══════════════════════════════════════════════════════════════════ */
function filterHistory(filter, el) {
  currentHistoryFilter = filter;
  $$('.filter-chip[data-history]').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderHistory();
}

function renderHistory() {
  let filtered = [];
  const done = allOrders.filter(o => o.status === 'done');
  if (currentHistoryFilter === 'today') filtered = done.filter(o => isToday(o.doneAt || o.createdAt));
  else if (currentHistoryFilter === 'week') filtered = done.filter(o => isThisWeek(o.doneAt || o.createdAt));
  else if (currentHistoryFilter === 'month') filtered = done.filter(o => isThisMonth(o.doneAt || o.createdAt));
  else filtered = done;

  const histCount = $('history-count');
  if (histCount) histCount.textContent = filtered.length;

  const list = $('history-list');
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h4>ไม่มีประวัติ</h4><p>ยังไม่มีออเดอร์ในช่วงนี้</p></div>';
    return;
  }
  list.innerHTML = filtered.map(o => {
    const foodTotal = calcOrderFoodTotal(o);
    return `<div class="history-item" onclick="viewOrderDetail('${esc(o.id)}')">
      <div class="history-info">
        <div class="history-title">${o.code ? '🧾 ' + esc(o.code) + ' • ' : ''}#${esc(o.id.slice(-8))}</div>
        <div class="history-meta">${esc(o.userName || 'ลูกค้า')} • 🕐 ${fmtDateTime(o.doneAt || o.createdAt)}</div>
      </div>
      <div class="history-amount">฿${fmt(foodTotal)}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════
   23. SOUND SETTINGS
   ═══════════════════════════════════════════════════════════════════ */
function openSoundSettings() {
  editingSoundTone = currentSoundSettings.tone || 1;
  editingSoundVolume = currentSoundSettings.volume || 'mid';
  updateSoundToneUI();
  updateSoundVolumeUI();
  openSheet('sound-settings-sheet');
}

function pickSoundTone(toneId) {
  editingSoundTone = toneId;
  updateSoundToneUI();
  setTimeout(() => playToneBySettings(toneId, editingSoundVolume), 100);
}

function pickSoundVolume(volumeKey) {
  editingSoundVolume = volumeKey;
  updateSoundVolumeUI();
  setTimeout(() => playToneBySettings(editingSoundTone, volumeKey), 100);
}

function updateSoundToneUI() {
  document.querySelectorAll('.sound-tone-option').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.tone) === editingSoundTone);
  });
}

function updateSoundVolumeUI() {
  document.querySelectorAll('.sound-volume-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vol === editingSoundVolume);
  });
}

function testSound() {
  playToneBySettings(editingSoundTone, editingSoundVolume);
  showToast('🔊 ทดสอบเสียง — ' + (SOUND_TONES[editingSoundTone]?.name || ''), 'info');
}

async function saveSoundSettings() {
  if (!currentUser) return;
  const btn = $('btn-save-sound');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    const newSettings = {
      tone: editingSoundTone, volume: editingSoundVolume,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('merchants').doc(currentUser.uid).update({ soundSettings: newSettings });
    currentSoundSettings = { tone: editingSoundTone, volume: editingSoundVolume };
    showToast('✅ บันทึกการตั้งค่าเสียงแล้ว');
    closeSheet('sound-settings-sheet');
    setTimeout(() => soundNewOrder(), 300);
  } catch (err) { showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกการตั้งค่า'; } }
}

/* ═══════════════════════════════════════════════════════════════════
   24. SHOP PROFILE + AVATAR
   ═══════════════════════════════════════════════════════════════════ */
function openShopProfile() {
  if (!merchantProfile) return;
  loadShopAvatarPreview();
  renderShopProfileInfo();
  openSheet('shop-profile-sheet');
}

function renderShopProfileInfo() {
  const m = merchantProfile;
  if (!m) return;
  const box = $('shop-profile-info');
  if (!box) return;
  box.innerHTML = `
    <div class="shop-info-block-inner">
      <div class="shop-info-name-big">🏪 ${esc(m.name)}</div>
      <div class="shop-info-rows">
        <div class="shop-info-row"><span class="k">📂 ประเภท</span><span class="v">${esc(m.category || '—')}</span></div>
        <div class="shop-info-row"><span class="k">📞 เบอร์</span><span class="v">${esc(m.phone || '—')}</span></div>
        <div class="shop-info-row"><span class="k">📧 อีเมล</span><span class="v">${esc(m.email || '—')}</span></div>
        <div class="shop-info-row"><span class="k">📍 ที่อยู่</span><span class="v">${esc(m.address || '—')}</span></div>
        <div class="shop-info-row"><span class="k">⏰ เวลา</span><span class="v">${esc(m.openTime || '—')} - ${esc(m.closeTime || '—')}</span></div>
        <div class="shop-info-row"><span class="k">⭐ Rating</span><span class="v">${(m.ratingAvg || 0).toFixed(1)} (${m.ratingCount || 0} รีวิว)</span></div>
        <div class="shop-info-row"><span class="k">สถานะ</span><span class="v">${m.verified ? '✅ อนุมัติแล้ว' : '⏳ รออนุมัติ'}</span></div>
      </div>
    </div>
  `;
}

function loadShopAvatarPreview() {
  const preview = $('shop-avatar-preview');
  if (!preview) return;
  if (merchantProfile && merchantProfile.image) {
    preview.src = merchantProfile.image;
  } else {
    preview.src = 'icons/icon-192.png';
  }
  const saveBtn = $('shop-avatar-save-btn');
  if (saveBtn) saveBtn.style.display = 'none';
  pendingShopAvatarBlob = null;
}

function uploadShopAvatar(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.size > MAX_IMG_SIZE) {
    showToast('รูปใหญ่เกิน 5MB', 'error');
    event.target.value = '';
    return;
  }
  if (!file.type || file.type.indexOf('image/') !== 0) {
    showToast('ต้องเป็นรูปภาพ', 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    openCropModal(e.target.result, (croppedFile, dataUrl) => {
      pendingShopAvatarBlob = croppedFile;
      const preview = $('shop-avatar-preview');
      if (preview) preview.src = dataUrl;
      const saveBtn = $('shop-avatar-save-btn');
      if (saveBtn) saveBtn.style.display = 'block';
      showToast('📷 เลือกรูปแล้ว — กด "บันทึก"', 'info');
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function saveShopAvatar() {
  if (!pendingShopAvatarBlob || !currentUser) {
    return showToast('ยังไม่ได้เลือกรูป', 'warning');
  }
  const btn = $('shop-avatar-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }

  try {
    const compressed = await compressImage(pendingShopAvatarBlob, 800, 0.85);
    const path = `shops/${currentUser.uid}/avatar_${Date.now()}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed);
    const url = await ref.getDownloadURL();

    await db.collection('merchants').doc(currentUser.uid).update({
      image: url,
      imagePath: path,
      imageUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (merchantProfile) {
      merchantProfile.image = url;
      merchantProfile.imagePath = path;
    }

    const preview = $('shop-avatar-preview');
    if (preview) preview.src = url;
    if (btn) btn.style.display = 'none';
    pendingShopAvatarBlob = null;

    showToast('✅ บันทึกรูปโปรไฟล์แล้ว!');
  } catch (err) {
    console.error('saveShopAvatar error:', err);
    showToast('บันทึกไม่สำเร็จ: ' + (err.code || err.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกรูปโปรไฟล์'; }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   25. CATEGORY MANAGER
   ═══════════════════════════════════════════════════════════════════ */
function getMenuCategories() {
  if (!merchantProfile?.menuCategories || !Array.isArray(merchantProfile.menuCategories) || merchantProfile.menuCategories.length === 0) {
    return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }
  return merchantProfile.menuCategories.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

function renderCategoryDropdown(selectedId) {
  const sel = $('mf-category');
  if (!sel) return;
  const cats = getMenuCategories().filter(c => !c.hidden);
  if (!cats.length) { sel.innerHTML = '<option value="other">📦 อื่นๆ</option>'; return; }
  sel.innerHTML = cats.map(c =>
    `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`
  ).join('');
}

function openCategoryManager() {
  editingCategories = getMenuCategories();
  renderCategoryList();
  openSheet('category-manager-sheet');
}

function renderCategoryList() {
  const list = $('cat-list');
  if (!list) return;

  if (!editingCategories.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-light);font-weight:700">ยังไม่มีหมวดหมู่</div>';
    return;
  }

  list.innerHTML = editingCategories.map((c, i) => `
    <div class="cat-item ${c.hidden ? 'hidden' : ''}">
      <div class="cat-item-icon">${esc(c.icon || '📦')}</div>
      <div class="cat-item-info">
        <div class="cat-item-name">${esc(c.name)}</div>
        <div class="cat-item-status">${c.hidden ? '👁️‍🗨️ ซ่อนจากลูกค้า' : '✅ แสดง'}</div>
      </div>
      <div class="cat-item-actions">
        <button class="cat-action-btn edit" onclick="editCategoryItem(${i})" title="แก้ไข">✏️</button>
        <button class="cat-action-btn toggle ${c.hidden ? '' : 'active'}" onclick="toggleCategoryItem(${i})" title="${c.hidden ? 'แสดง' : 'ซ่อน'}">
          ${c.hidden ? '👁️' : '👁️‍🗨️'}
        </button>
        <button class="cat-action-btn del" onclick="deleteCategoryItem(${i})" title="ลบ">🗑️</button>
      </div>
    </div>
  `).join('');
}

function openAddCategoryForm() {
  editingCategoryIndex = -1;
  editingCategoryIcon = '🍚';
  const titleEl = $('cat-form-title');
  if (titleEl) titleEl.textContent = '➕ เพิ่มหมวดใหม่';
  if ($('cat-name')) $('cat-name').value = '';
  renderIconPicker();
  openSheet('category-form-sheet');
}

function editCategoryItem(index) {
  editingCategoryIndex = index;
  const c = editingCategories[index];
  editingCategoryIcon = c.icon || '🍚';
  const titleEl = $('cat-form-title');
  if (titleEl) titleEl.textContent = '✏️ แก้ไขหมวด';
  if ($('cat-name')) $('cat-name').value = c.name || '';
  renderIconPicker();
  openSheet('category-form-sheet');
}

function renderIconPicker() {
  const picker = $('cat-icon-picker');
  if (!picker) return;
  picker.innerHTML = AVAILABLE_ICONS.map(icon =>
    `<button type="button" class="cat-icon-option ${icon === editingCategoryIcon ? 'active' : ''}" onclick="pickCategoryIcon('${icon}')">${icon}</button>`
  ).join('');
}

function pickCategoryIcon(icon) {
  editingCategoryIcon = icon;
  renderIconPicker();
}

function saveCategoryItem() {
  const name = $('cat-name')?.value.trim();
  if (!name) return showToast('กรอกชื่อหมวด', 'error');

  if (editingCategoryIndex === -1) {
    const newCat = {
      id: 'cat_' + Date.now(),
      name: name, icon: editingCategoryIcon, hidden: false,
      order: editingCategories.length + 1
    };
    editingCategories.push(newCat);
    showToast('✅ เพิ่มหมวด "' + name + '"');
  } else {
    editingCategories[editingCategoryIndex].name = name;
    editingCategories[editingCategoryIndex].icon = editingCategoryIcon;
    showToast('✅ แก้ไขหมวดแล้ว');
  }

  closeSheet('category-form-sheet');
  renderCategoryList();
}

function toggleCategoryItem(index) {
  editingCategories[index].hidden = !editingCategories[index].hidden;
  renderCategoryList();
}

function deleteCategoryItem(index) {
  const c = editingCategories[index];
  if (!confirm(`ลบหมวด "${c.name}"?\n\nเมนูที่อยู่ในหมวดนี้จะยังอยู่ แต่จะไม่มีหมวด`)) return;
  editingCategories.splice(index, 1);
  renderCategoryList();
  showToast('🗑️ ลบหมวดแล้ว');
}

async function saveCategoryChanges() {
  if (!currentUser) return;
  const btn = $('btn-save-cats');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    editingCategories.forEach((c, i) => { c.order = i + 1; });
    await db.collection('merchants').doc(currentUser.uid).update({
      menuCategories: editingCategories,
      menuCategoriesUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    merchantProfile.menuCategories = editingCategories.slice();
    showToast('✅ บันทึกหมวดหมู่แล้ว');
    closeSheet('category-manager-sheet');
    if ($('menu-form-sheet')?.classList.contains('show')) {
      const current = $('mf-category')?.value;
      renderCategoryDropdown(current);
    }
  } catch (err) { showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกหมวดหมู่'; } }
}

async function ensureMenuCategories() {
  if (!currentUser) return;
  if (merchantProfile?.menuCategories && Array.isArray(merchantProfile.menuCategories) && merchantProfile.menuCategories.length > 0) return;
  try {
    await db.collection('merchants').doc(currentUser.uid).update({
      menuCategories: DEFAULT_CATEGORIES,
      menuCategoriesUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    merchantProfile.menuCategories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    console.log('✅ Auto-initialized menuCategories');
  } catch (e) { console.warn('Cannot init menuCategories:', e.code); }
}

/* ═══════════════════════════════════════════════════════════════════
   26. CROP IMAGE (Cropper.js)
   ═══════════════════════════════════════════════════════════════════ */
function openCropModal(imageSrc, onConfirm) {
  const modal = $('crop-modal');
  const img = $('crop-image');
  if (!modal || !img) return;

  img.src = imageSrc;
  cropTargetCallback = onConfirm;
  modal.classList.add('show');

  img.onload = () => {
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    setTimeout(() => {
      try {
        cropperInstance = new Cropper(img, {
          aspectRatio: 1, viewMode: 1, dragMode: 'move',
          autoCropArea: 1, background: false, guides: false,
          center: true, highlight: false,
          cropBoxMovable: true, cropBoxResizable: true,
          toggleDragModeOnDblclick: false, responsive: true,
          restore: false, checkOrientation: false,
          zoomOnTouch: true, zoomOnWheel: true, wheelZoomRatio: 0.1,
          minContainerWidth: 200, minContainerHeight: 200
        });
      } catch (e) {
        console.error('Cropper init error:', e);
        showToast('โหลดตัว crop ไม่สำเร็จ', 'error');
      }
    }, 100);
  };
}

function resetCrop() {
  if (cropperInstance) cropperInstance.reset();
  showToast('↺ รีเซ็ตแล้ว', 'info');
}

function closeCropModal() {
  const modal = $('crop-modal');
  if (modal) modal.classList.remove('show');
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  cropTargetCallback = null;
  const img = $('crop-image');
  if (img) img.src = '';
}

async function confirmCrop() {
  if (!cropperInstance) return showToast('ยังไม่มีรูป', 'warning');
  try {
    const canvas = cropperInstance.getCroppedCanvas({
      width: 800, height: 800,
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
    });
    if (!canvas) return showToast('crop ไม่สำเร็จ', 'error');
    canvas.toBlob((blob) => {
      if (!blob) return showToast('ไม่สามารถประมวลผลรูป', 'error');
      const file = new File([blob], 'crop_' + Date.now() + '.jpg', { type: 'image/jpeg' });
      if (typeof cropTargetCallback === 'function') {
        cropTargetCallback(file, canvas.toDataURL('image/jpeg', 0.85));
      }
      closeCropModal();
      showToast('✅ ปรับขนาดรูปแล้ว');
    }, 'image/jpeg', 0.85);
  } catch (err) { showToast('ไม่สำเร็จ: ' + err.message, 'error'); }
}
/* ═══════════════════════════════════════════════════════════════════
   27. GP TAB + TRANSFER
   ═══════════════════════════════════════════════════════════════════ */
function updateGpTab() {
  if (!merchantProfile) return;
  const doneOrders = allOrders.filter(o => o.status === 'done');
  const today = doneOrders.filter(o => isToday(o.doneAt || o.createdAt));
  const month = doneOrders.filter(o => isThisMonth(o.doneAt || o.createdAt));

  const pending = Number(merchantProfile.gpPending || 0);
  const pendingEl = $('gp-pending');
  if (pendingEl) pendingEl.textContent = '฿' + fmt(pending);
  currentGpPending = pending;

  const monthSales = month.reduce((s, o) => s + calcOrderFoodTotal(o), 0);
  const pendingSub = $('gp-pending-sub');
  if (pendingSub) pendingSub.textContent = 'จากยอดขาย ' + fmt(monthSales) + '฿';

  const todaySales = today.reduce((s, o) => s + calcOrderFoodTotal(o), 0);
  let todayGp = 0, todayRider = 0, todayPlatform = 0;
  today.forEach(o => {
    const gp = calcGp(calcOrderFoodTotal(o), merchantProfile);
    todayGp += gp.total; todayRider += gp.rider; todayPlatform += gp.platform;
  });

  const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  el('gp-today-sales', '฿' + fmt(todaySales));
  el('gp-today-total', '฿' + fmt(todayGp));
  el('gp-today-rider', '฿' + fmt(todayRider));
  el('gp-today-platform', '฿' + fmt(todayPlatform));
  el('gp-today-net', '฿' + fmt(todaySales - todayGp));

  let monthGp = 0;
  month.forEach(o => {
    const gp = calcGp(calcOrderFoodTotal(o), merchantProfile);
    monthGp += gp.total;
  });
  el('gp-month-orders', month.length + ' รายการ');
  el('gp-month-sales', '฿' + fmt(monthSales));
  el('gp-month-total', '฿' + fmt(monthGp));
  el('gp-month-net', '฿' + fmt(monthSales - monthGp));

  const daysLeft = getDaysLeft(merchantProfile);
  const isPromo = isPromoActive(merchantProfile);
  const cd = $('gp-countdown');
  const daysEl = $('gp-days-left');
  if (cd && daysEl) {
    if (isPromo) { cd.classList.add('promo'); daysEl.textContent = daysLeft; }
    else { cd.classList.remove('promo'); daysEl.textContent = '✓'; }
  }

  renderGpHistory();
}

function renderGpHistory() {
  const list = $('gp-history-list');
  if (!list) return;
  const history = merchantProfile.gpHistory || [];
  if (!history.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:12px;font-weight:700">ยังไม่มีประวัติการโอน</div>';
    return;
  }
  list.innerHTML = history.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(h => {
    const date = toDate(h.createdAt);
    const status = h.verified ? 'verified' : 'pending';
    const statusLabel = h.verified ? '✅ ยืนยัน' : '⏳ รอตรวจ';
    return `<div class="gp-history-item">
      <div>
        <div class="date">📅 ${date ? date.toLocaleDateString('th-TH',{day:'2-digit',month:'short'}) : '—'}</div>
        <div style="font-size:10px;color:var(--text-light);margin-top:2px">${h.roundLabel || ''}</div>
      </div>
      <div style="text-align:right">
        <div class="amt">฿${fmt(h.amount || 0)}</div>
        <div class="status ${status}" style="margin-top:2px">${statusLabel}</div>
      </div>
    </div>`;
  }).join('');
}

function openGpTransferForm() {
  if (currentGpPending <= 0) return showToast('ไม่มี GP ค้างโอน', 'info');
  gpSlipFile = null;
  const amountEl = $('gp-transfer-amount');
  if (amountEl) amountEl.textContent = '฿' + fmt(currentGpPending);
  const roundEl = $('gp-transfer-round');
  if (roundEl) roundEl.textContent = new Date().toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const preview = $('gp-slip-preview');
  if (preview) preview.style.display = 'none';
  const input = $('gp-slip-input');
  if (input) input.value = '';
  const note = $('gp-note');
  if (note) note.value = '';
  openSheet('gp-transfer-sheet');
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'gp-slip-input') {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
    gpSlipFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = $('gp-slip-preview');
      if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
  }
});

async function submitGpTransfer() {
  if (!gpSlipFile) return showToast('กรุณาแนบสลิปโอน', 'warning');
  if (currentGpPending <= 0) return showToast('ไม่มี GP ค้างโอน', 'warning');

  const btn = $('btn-submit-gp');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    const compressed = await compressImage(gpSlipFile, 1000, 0.8);
    const path = `gp_slips/${currentUser.uid}/${Date.now()}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed);
    const slipUrl = await ref.getDownloadURL();
    const note = $('gp-note')?.value.trim() || '';
    const amount = currentGpPending;
    const roundLabel = new Date().toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    const historyEntry = {
      amount: amount, slipUrl: slipUrl, slipPath: path, note: note,
      roundLabel: roundLabel, verified: false, createdAt: new Date()
    };

    await db.collection('merchants').doc(currentUser.uid).update({
      gpPending: 0,
      gpHistory: firebase.firestore.FieldValue.arrayUnion(historyEntry),
      lastGpTransferAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('gp_transfers').add({
      merchantId: currentUser.uid,
      merchantName: merchantProfile.name,
      amount: amount, slipUrl: slipUrl, slipPath: path, note: note,
      status: 'pending', roundLabel: roundLabel,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ ส่งสลิปแล้ว รอแอดมินตรวจสอบ');
    closeSheet('gp-transfer-sheet');
  } catch (err) { showToast('ส่งไม่สำเร็จ: ' + err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันโอนแล้ว'; } }
}

/* ═══════════════════════════════════════════════════════════════════
   28. CHAT — ลูกค้า + ไรเดอร์
   ═══════════════════════════════════════════════════════════════════ */
async function openChatWithCustomer(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return showToast('ไม่พบออเดอร์', 'error');
  activeChatId = orderId;
  activeChatPartnerPhone = o.userPhone || null;
  activeChatPartnerName = o.userName || 'ลูกค้า';
  await openChatRoom(orderId, activeChatPartnerName, o.title || 'ออเดอร์');
  closeSheet('order-detail-sheet');
}

async function openChatWithRider(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return showToast('ไม่พบออเดอร์', 'error');
  if (!o.riderId) return showToast('ยังไม่มีไรเดอร์รับงาน', 'warning');
  activeChatId = orderId;
  activeChatPartnerPhone = o.riderPhone || null;
  activeChatPartnerName = o.riderName || 'ไรเดอร์';
  await openChatRoom(orderId, activeChatPartnerName, o.title || 'ออเดอร์');
  closeSheet('order-detail-sheet');
}

async function openChatRoom(orderId, name, sub) {
  try {
    const chatRef = db.collection('chats').doc(orderId);
    const snap = await chatRef.get();
    if (!snap.exists) {
      const o = allOrders.find(x => x.id === orderId);
      if (!o) return;
      await chatRef.set({
        orderId: orderId,
        userId: o.userId || '',
        userName: o.userName || 'ลูกค้า',
        riderId: o.riderId || '',
        riderName: o.riderName || 'ไรเดอร์',
        merchantId: currentUser.uid,
        merchantName: merchantProfile.name,
        lastMessage: '', lastSenderId: '',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) { console.warn('openChatRoom:', err.message); }

  const cn = $('chatName'); if (cn) cn.textContent = name;
  const cs = $('chatSub'); if (cs) cs.textContent = sub;
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
  if (activeChatPartnerPhone) window.location.href = 'tel:' + activeChatPartnerPhone;
  else showToast('ไม่มีเบอร์โทร', 'warning');
}

function renderChatMessages(msgs) {
  const el = $('chatMessages');
  if (!el) return;
  if (msgs.length === 0) { el.innerHTML = '<div class="chat-empty">เริ่มสนทนา</div>'; return; }
  let lastDay = '';
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === currentUser.uid;
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) { dayDiv = `<div class="chat-day-divider">${day}</div>`; lastDay = day; }
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

async function sendChatText() {
  const text = $('chatInput')?.value.trim();
  if (!text || !activeChatId) return;
  const inp = $('chatInput');
  inp.value = '';
  inp.style.height = 'auto';
  try {
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text, senderId: currentUser.uid, senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: text.slice(0, 80),
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) { showToast('ส่งไม่สำเร็จ', 'error'); }
}

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');
  try {
    const compressed = await compressImage(file, 800, 0.75);
    const path = `chats/${activeChatId}/images/${Date.now()}_${currentUser.uid}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed);
    const url = await ref.getDownloadURL();

    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url, senderId: currentUser.uid, senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '📷 รูปภาพ',
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งรูปแล้ว');
  } catch (err) { showToast('อัปโหลดไม่สำเร็จ', 'error'); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ═══════════════════════════════════════════════════════════════════
   29. NETWORK + PWA
   ═══════════════════════════════════════════════════════════════════ */
function setupNetwork() {
  window.addEventListener('online', () => {
    $('offline-banner')?.classList.remove('show');
    showToast('🟢 กลับมาออนไลน์');
  });
  window.addEventListener('offline', () => { $('offline-banner')?.classList.add('show'); });
  if (!navigator.onLine) $('offline-banner')?.classList.add('show');
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('chauat_merchant_pwa_dismissed')) {
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
  } else { showToast('เปิดเมนู → เพิ่มไปที่หน้าจอหลัก', 'info'); }
}

function dismissPWA() {
  $('pwa-install-banner')?.classList.add('hidden');
  localStorage.setItem('chauat_merchant_pwa_dismissed', '1');
}

/* ═══════════════════════════════════════════════════════════════════
   30. INIT
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  runSplash();

  document.body.addEventListener('click', () => {
    if (!isAudioUnlocked) {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'running') {
        isAudioUnlocked = true;
        hideUnlockBanner();
      }
    }
  }, { once: false });
});

window.addEventListener('beforeunload', () => { stopOrderLoop(); });

/* ═══════════════════════════════════════════════════════════════════
   31. GLOBAL EXPOSE
   ═══════════════════════════════════════════════════════════════════ */
window.toggleTheme = toggleTheme;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleForgotPassword = handleForgotPassword;
window.handleMerchantLogout = handleMerchantLogout;
window.toggleShop = toggleShop;
window.switchTab = switchTab;
window.openSheet = openSheet;
window.closeSheet = closeSheet;
window.acceptOrder = acceptOrder;
window.readyOrder = readyOrder;
window.cancelOrder = cancelOrder;
window.viewOrderDetail = viewOrderDetail;
window.closeNewOrderPopup = closeNewOrderPopup;
window.acceptFromPopup = acceptFromPopup;
window.openMenuForm = openMenuForm;
window.previewMenuImg = previewMenuImg;
window.removeMenuImg = removeMenuImg;
window.saveMenu = saveMenu;
window.editMenu = editMenu;
window.deleteMenu = deleteMenu;
window.filterHistory = filterHistory;
window.openGpTransferForm = openGpTransferForm;
window.submitGpTransfer = submitGpTransfer;
window.openShopProfile = openShopProfile;
window.uploadShopAvatar = uploadShopAvatar;
window.saveShopAvatar = saveShopAvatar;
window.openChatWithCustomer = openChatWithCustomer;
window.openChatWithRider = openChatWithRider;
window.closeChat = closeChat;
window.callChatPartner = callChatPartner;
window.sendChatText = sendChatText;
window.sendChatImage = sendChatImage;
window.autoResize = autoResize;
window.installPWA = installPWA;
window.dismissPWA = dismissPWA;

window.unlockAudio = unlockAudio;
window.startOrderLoop = startOrderLoop;
window.stopOrderLoop = stopOrderLoop;

window.pickMenuStatus = pickMenuStatus;
window.pickPromoType = pickPromoType;
window.setPromoValue = setPromoValue;
window.updatePromoPreview = updatePromoPreview;
window.onPromoToggle = onPromoToggle;

window.openSoundSettings = openSoundSettings;
window.pickSoundTone = pickSoundTone;
window.pickSoundVolume = pickSoundVolume;
window.testSound = testSound;
window.saveSoundSettings = saveSoundSettings;

window.openCategoryManager = openCategoryManager;
window.renderCategoryList = renderCategoryList;
window.openAddCategoryForm = openAddCategoryForm;
window.editCategoryItem = editCategoryItem;
window.pickCategoryIcon = pickCategoryIcon;
window.saveCategoryItem = saveCategoryItem;
window.toggleCategoryItem = toggleCategoryItem;
window.deleteCategoryItem = deleteCategoryItem;
window.saveCategoryChanges = saveCategoryChanges;
window.openCropModal = openCropModal;
window.resetCrop = resetCrop;
window.closeCropModal = closeCropModal;
window.confirmCrop = confirmCrop;

/* Service Worker */
if ('serviceWorker' in navigator) {
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
console.log('%c🏪 Chauat Go Merchant v3.8.0 — Ready!', 'color:#00A651;font-weight:900;font-size:14px');
console.log('%c✅ Flow ใหม่: searching → cooking → ready → accepted → done', 'color:#FF6B35;font-weight:800;font-size:12px');
console.log('%c✅ Order Code (OD-XXXX) + แจ้งลูกค้าเมื่อยกเลิก', 'color:#2196F3;font-weight:700;font-size:11px');