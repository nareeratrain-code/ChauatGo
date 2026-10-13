/* ═══════════════════════════════════════════════════════════════════
   🏪 CHAUAT GO MERCHANT — v3.8.1
   Full-featured Production JavaScript
   
   ✅ v3.8.1: ลบ orderBy → ไม่ต้อง composite index
   ✅ subscribe searching → cooking → ready
   ✅ acceptOrder → cooking + สร้าง Order Code (OD-XXXX)
   ✅ cancelOrder → cancelled + แจ้งลูกค้า
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
console.log('%c🏪 Chauat Go Merchant v3.8.1', 'color:#00A651;font-weight:900;font-size:14px');

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

/* ⭐ v3.8.1: subscribe searching orders — ไม่ต้อง orderBy */
function subscribeOrders() {
  if (myOrdersUnsub) myOrdersUnsub();
  myOrdersUnsub = db.collection('orders')
    .where('merchantId', '==', currentUser.uid)
    .limit(100)
    .onSnapshot(snap => {
      const prevIds = seenOrderIds;
      allOrders = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
      });

      /* ⭐ v3.8.1: Sort client-side */
      allOrders.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.getTime() : 0;
        const tb = b.createdAt ? b.createdAt.getTime() : 0;
        return tb - ta;
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
    }, err => {
      console.warn('Orders sub:', err.code);
      /* ⭐ v3.8.1: Fallback ถ้า query fail */
      if (err.code === 'failed-precondition') {
        console.warn('⚠️ ต้อง composite index — fallback to query without filter');
        /* ลองใช้ fallback: query ทั้งหมด + filter client-side */
        if (myOrdersUnsub) myOrdersUnsub();
        myOrdersUnsub = db.collection('orders').limit(100)
          .onSnapshot(snap2 => {
            allOrders = snap2.docs.map(d => {
              const data = d.data();
              return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
            }).filter(o => o.merchantId === currentUser.uid);

            allOrders.sort((a, b) => {
              const ta = a.createdAt ? a.createdAt.getTime() : 0;
              const tb = b.createdAt ? b.createdAt.getTime() : 0;
              return tb - ta;
            });

            const newOnes = allOrders.filter(o =>
              !seenOrderIds.has(o.id) && o.status === 'searching' &&
              merchantProfile?.verified === true && isShopOpen
            );

            if (newOnes.length > 0 && seenOrderIds.size > 0) {
              startOrderLoop();
              showNewOrderPopup(newOnes[0]);
            }

            seenOrderIds = new Set(allOrders.map(o => o.id));
            renderOrders();
            updateHeroStats();
            updateGpTab();
            updateNavBadge();
          });
      }
    });
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
  el('stat-new', allOrders.filter(o => o.status === 'searching' && isToday(o.createdAt)).length);
  el('stat-cooking', allOrders.filter(o => (o.status === 'cooking' || o.status === 'ready') && isToday(o.createdAt)).length);
  el('stat-done', doneToday.length);
  el('stat-gp', '฿' + fmt(todayGp));
}

function updateNavBadge() {
  const pending = allOrders.filter(o => o.status === 'searching').length;
  const badge = $('nav-orders-badge');
  if (badge) {
    if (pending > 0) { badge.textContent = pending; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
  }
}