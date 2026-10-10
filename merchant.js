/* ═══════════════════════════════════════════════════════════════════
   🏪 CHAUAT GO MERCHANT — v3.4.8.1
   Full-featured Production JavaScript
   - Fix signup/login retry
   - Auto-create docs
   - Debug mode
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

// ⭐ v3.4.8.1: DEBUG MODE
window.CHAUAT_MERCHANT_DEBUG = true;
console.log('%c🏪 Chauat Go Merchant v3.4.8.1 — DEBUG ON', 'color:#00A651;font-weight:900;font-size:14px');

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

let editingMenuId = null;
let editingMenuImgBlob = null;
let editingMenuImgUrl = null;

let gpSlipFile = null;
let currentGpPending = 0;

/* ═══════════════════════════════════════════════════════════════════
   3. CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */
const GP_RATE = 0.03;
const GP_RIDER_SHARE = 0.02;
const GP_PLATFORM_SHARE = 0.01;
const PROMO_DAYS = 60;
const MAX_IMG_SIZE = 5 * 1024 * 1024;
const GP_BANK_INFO = {
  bank: 'กสิกรไทย',
  accountNo: 'xxx-x-xxxxx-x',
  accountName: 'บริษัท Chauat Go จำกัด'
};

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

const fmtTime = (t) => {
  const d = toDate(t);
  return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
};

const fmtDate = (t) => {
  const d = toDate(t);
  return d ? d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
};

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

const isToday = (t) => {
  const d = toDate(t);
  return d ? d.toDateString() === new Date().toDateString() : false;
};

const isThisWeek = (t) => {
  const d = toDate(t);
  if (!d) return false;
  return d >= new Date(Date.now() - 7 * 86400000);
};

const isThisMonth = (t) => {
  const d = toDate(t);
  if (!d) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

const debugLog = (msg, isError) => {
  if (window.CHAUAT_MERCHANT_DEBUG) {
    if (isError) console.warn(msg); else console.log(msg);
  }
};

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
   7. TOAST & SOUND & VIBRATE
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
  playTone([880, 1108, 1318, 1108], 0.18, 0.18, 0.4);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
}

function soundNewChat() {
  playTone([880], 0, 0.1, 0.25);
  if (navigator.vibrate) navigator.vibrate(50);
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
  if (isPromoActive(merchant)) {
    return { total: 0, rider: 0, platform: 0, isPromo: true };
  }
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

  try {
    console.log('📝 Step 1: Create Auth user');
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: shopName });
    console.log('✅ Auth user created:', createdUser.uid);

    // ⭐ v3.4.8.1: สร้าง users ก่อน (ตรวจ role)
    console.log('📄 Step 2: Create users doc');
    await db.collection('users').doc(createdUser.uid).set({
      role: 'merchant',
      name: shopName,
      email: email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ users doc created');

    // ⭐ สร้าง merchants
    console.log('🏪 Step 3: Create merchants doc');
    await db.collection('merchants').doc(createdUser.uid).set({
      merchantId: createdUser.uid,
      name: shopName,
      category: category,
      phone: phone,
      email: email,
      address: address,
      openTime: openTime,
      closeTime: closeTime,
      isOpen: false,
      verified: false,
      ratingAvg: 0,
      ratingCount: 0,
      gpStartDate: null,
      gpPending: 0,
      gpPaid: 0,
      gpConsent: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ merchants doc created');

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ');
    console.log('🎉 SIGNUP COMPLETE');

    // ⭐ Sign out หลังสมัคร → ให้ login เอง (ปลอดภัย)
    setTimeout(async () => {
      await auth.signOut();
      switchAuthTab('login');
      const le = $('login-email');
      if (le) le.value = email;
      showToast('📧 เข้าสู่ระบบด้วยอีเมลที่สมัคร', 'info');
    }, 1800);

  } catch (err) {
    console.error('❌ Signup error:', err);
    if (createdUser) {
      try { await createdUser.delete(); } catch (e) {}
    }
    showToast('สมัครไม่สำเร็จ: ' + err.message, 'error');
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
  } catch (err) {
    showToast('ส่งไม่สำเร็จ: ' + err.message, 'error');
  }
}

async function handleMerchantLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeSheet('menu-sheet');
  if (myProfileUnsub) myProfileUnsub();
  if (myOrdersUnsub) myOrdersUnsub();
  if (myMenusUnsub) myMenusUnsub();
  if (activeChatUnsub) activeChatUnsub();
  seenOrderIds.clear();
  allOrders = [];
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   11. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  if (myProfileUnsub) myProfileUnsub();
  if (myOrdersUnsub) myOrdersUnsub();
  if (myMenusUnsub) myMenusUnsub();

  if (!user) {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    return;
  }

  currentUser = user;
  console.log('👤 Auth state:', user.email, user.uid);

  try {
    // ⭐ v3.4.8.1: Retry 5 ครั้ง (รอ Firestore propagate)
    let userDoc = null;
    let merchantDoc = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log(`🔍 Attempt ${attempt}/5: check docs`);

      try {
        userDoc = await db.collection('users').doc(user.uid).get();
      } catch (e) {
        console.warn('users read error:', e.code);
      }

      try {
        merchantDoc = await db.collection('merchants').doc(user.uid).get();
      } catch (e) {
        console.warn('merchants read error:', e.code);
      }

      if (userDoc?.exists && merchantDoc?.exists) {
        console.log('✅ Both docs found');
        break;
      }

      if (attempt < 5) {
        console.log(`⏳ Waiting 1s before retry...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Check users doc
    if (!userDoc || !userDoc.exists) {
      console.error('❌ users doc not found after 5 retries');
      showToast('ไม่พบข้อมูลบัญชี — กรุณาสมัครใหม่', 'error');
      await auth.signOut();
      return;
    }

    const userRole = userDoc.data().role;
    if (userRole !== 'merchant') {
      console.error('❌ Role is not merchant:', userRole);
      showToast('บัญชีนี้ไม่ใช่ร้านค้า (role: ' + userRole + ')', 'error');
      await auth.signOut();
      return;
    }

    // Check merchants doc
    if (!merchantDoc || !merchantDoc.exists) {
      console.error('❌ merchants doc not found');
      showToast('ไม่พบข้อมูลร้านค้า — กรุณาสมัครใหม่', 'error');
      await auth.signOut();
      return;
    }

    merchantProfile = { uid: user.uid, ...merchantDoc.data() };
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    console.log('✅ Login success:', merchantProfile.name);
    initApp();
  } catch (err) {
    console.error('❌ Auth state error:', err);
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    await auth.signOut();
  }
});

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

    if (prevVerified === false && merchantProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว!', 'success');
      soundNewOrder();
    }

    updateHeader();
    updatePendingBanner();
    updateShopToggle();
    updateHeroStats();
    updateGpTab();
  });
}

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

      const newOnes = allOrders.filter(o =>
        !prevIds.has(o.id) &&
        o.status === 'pending' &&
        merchantProfile?.verified === true &&
        isShopOpen
      );

      if (newOnes.length > 0 && prevIds.size > 0) {
        soundNewOrder();
        showNewOrderPopup(newOnes[0]);
      }

      seenOrderIds = new Set(allOrders.map(o => o.id));
      renderOrders();
      updateHeroStats();
      updateGpTab();
      updateNavBadge();
    }, err => {
      console.warn('Orders sub:', err.code);
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
  const idEl = $('shop-id-header');
  if (idEl) idEl.textContent = 'ID: ' + (currentUser?.uid || '').slice(0, 12) + '...';
  const idFull = $('shop-id-full');
  if (idFull) idFull.textContent = currentUser?.uid || '—';
  updateShopToggle();
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
  el('stat-new', allOrders.filter(o => o.status === 'pending' && isToday(o.createdAt)).length);
  el('stat-cooking', allOrders.filter(o => (o.status === 'cooking' || o.status === 'ready') && isToday(o.createdAt)).length);
  el('stat-done', doneToday.length);
  el('stat-gp', '฿' + fmt(todayGp));
}

function updateNavBadge() {
  const pending = allOrders.filter(o => o.status === 'pending').length;
  const badge = $('nav-orders-badge');
  if (badge) {
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   15. RENDER ORDERS
   ═══════════════════════════════════════════════════════════════════ */
function renderOrders() {
  const pending = allOrders.filter(o => o.status === 'pending');
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
    pending: '🔔 รอรับ', cooking: '🍳 กำลังทำ', ready: '✅ พร้อมส่ง',
    accepted: '🛵 ไรเดอร์รับ', picked_up: '📦 ไรเดอร์รับของ',
    on_the_way: '🚀 กำลังส่ง', delivered: '✅ ส่งถึง',
    done: '✅ เสร็จ', cancelled: '❌ ยกเลิก'
  };
  const statusLabel = statusMap[o.status] || o.status;
  const foodTotal = calcOrderFoodTotal(o);
  const itemsHtml = (o.items || []).map(i =>
    `<div class="item-row"><span class="item-name">${esc(i.name)} × ${i.qty}</span><b>฿${fmt(i.price * i.qty)}</b></div>`
  ).join('') || `<div>${esc(o.itemsText || '—')}</div>`;

  let actions = '';
  if (o.status === 'pending') {
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

  const badge = isCash
    ? '<span class="cash-badge">💵 เงินสด</span>'
    : '<span class="transfer-badge">💳 โอน</span>';

  const riderInfo = o.riderName
    ? `<div class="order-meta" style="color:var(--brand);font-weight:900">🛵 ${esc(o.riderName)}${o.riderPhone ? ' • '+esc(o.riderPhone) : ''}</div>`
    : '';

  return `<div class="order-card status-${o.status}">
    <div class="order-top">
      <div class="order-emoji">🍽️</div>
      <div class="order-info">
        <div class="order-id">#${esc(o.id.slice(-8))}</div>
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
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   16. ORDER ACTIONS
   ═══════════════════════════════════════════════════════════════════ */
async function acceptOrder(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'cooking',
      cookingAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🍳 เริ่มทำอาหาร');
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
}

async function readyOrder(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'ready',
      readyAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ พร้อมส่ง');
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
}

async function cancelOrder(orderId) {
  if (!confirm('ยกเลิกออเดอร์นี้?')) return;
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: 'merchant'
    });
    showToast('❌ ยกเลิกออเดอร์');
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
}

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

  const $content = $('order-detail-content');
  if ($content) {
    $content.innerHTML = `
      <div style="background:var(--surface-2);border-radius:14px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-muted);font-weight:800">#${esc(o.id.slice(-8))}</div>
        <div style="font-size:15px;font-weight:900;margin-top:4px">${esc(o.userName || 'ลูกค้า')}</div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;margin-top:4px">📞 ${esc(o.userPhone || '—')}</div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;margin-top:4px">📍 ${esc(o.address || '—')}</div>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:900;margin-bottom:8px">🍽️ รายการอาหาร</div>
        ${itemsHtml}
      </div>
      <div style="background:${isCash?'var(--orange-light)':'var(--blue-light)'};border-radius:14px;padding:14px;margin-bottom:14px;font-size:13px;font-weight:700">
        <div style="font-weight:900;margin-bottom:8px">${isCash?'💵 ลูกค้าจ่ายเงินสด':'💳 ลูกค้าโอนเงิน'}</div>
        <div style="display:flex;justify-content:space-between;padding:3px 0"><span>ยอดอาหาร</span><b>฿${fmt(foodTotal)}</b></div>
        ${o.fare?'<div style="display:flex;justify-content:space-between;padding:3px 0"><span>ค่าส่ง (ของไรเดอร์)</span><b>฿'+fmt(o.fare)+'</b></div>':''}
        ${isCash&&o.cashTip?'<div style="display:flex;justify-content:space-between;padding:3px 0;color:#E65100"><span>ค่าบริการพิเศษ (ทิป)</span><b>฿'+fmt(o.cashTip)+'</b></div>':''}
        <div style="display:flex;justify-content:space-between;padding:8px 0 0;border-top:1px solid var(--border);margin-top:6px;font-size:15px;font-weight:900">
          <span>ร้านได้รับ</span><span style="color:var(--green)">฿${fmt(foodTotal)}</span>
        </div>
      </div>
      ${!gp.isPromo ? `<div style="background:var(--yellow-light);border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;font-weight:700">
        <div style="font-weight:900;margin-bottom:6px">💰 GP 3%</div>
        <div style="display:flex;justify-content:space-between;padding:2px 0"><span>รวม</span><b>฿${fmt(gp.total)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;padding-left:16px;color:#FF6B35"><span>├─ ไรเดอร์ 2%</span><b>฿${fmt(gp.rider)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;padding-left:16px;color:#4A90D9"><span>└─ แพลตฟอร์ม 1%</span><b>฿${fmt(gp.platform)}</b></div>
      </div>` : `<div style="background:var(--green-light);border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;font-weight:900;text-align:center;color:var(--green)">🎉 อยู่ในช่วงโปรโมชั่น — ไม่คิด GP</div>`}
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
   17. NEW ORDER POPUP
   ═══════════════════════════════════════════════════════════════════ */
function showNewOrderPopup(order) {
  newOrderPopupId = order.id;
  const foodTotal = calcOrderFoodTotal(order);
  const isCash = order.paymentMode === 'cash';

  const detail = $('new-order-detail');
  if (detail) {
    detail.innerHTML = `
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
  if (newOrderPopupId) acceptOrder(newOrderPopupId);
  closeNewOrderPopup();
}

/* ═══════════════════════════════════════════════════════════════════
   18. SHOP TOGGLE
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
    showToast(newState ? '🟢 เปิดร้าน' : '⚫ ปิดร้าน');
  } catch (err) {
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   19. MENUS
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
    return `<div class="menu-item">
      <div class="menu-item-img">${imgHtml}</div>
      <div class="menu-item-info">
        <div class="menu-item-name">${esc(m.name)}</div>
        ${m.description?`<div class="menu-item-desc">${esc(m.description)}</div>`:''}
        <div class="menu-item-price">฿${fmt(m.price)}</div>
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

  const titleEl = $('menu-form-title');
  if (titleEl) titleEl.textContent = editingMenuId ? '✏️ แก้ไขเมนู' : '➕ เพิ่มเมนูใหม่';

  if (editingMenuId) {
    const m = allMenus.find(x => x.id === editingMenuId);
    if (m) {
      $('mf-name').value = m.name || '';
      $('mf-price').value = m.price || '';
      $('mf-category').value = m.category || 'main';
      $('mf-desc').value = m.description || '';
      if (m.image && m.image.startsWith('http')) {
        editingMenuImgUrl = m.image;
        const preview = $('img-preview');
        if (preview) {
          preview.src = m.image;
          preview.style.display = 'block';
        }
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
  }

  openSheet('menu-form-sheet');
}

async function previewMenuImg(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  editingMenuImgBlob = file;
  editingMenuImgUrl = null;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = $('img-preview');
    if (preview) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    }
    const placeholder = $('img-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    const removeBtn = $('remove-img-btn');
    if (removeBtn) removeBtn.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function removeMenuImg() {
  editingMenuImgBlob = null;
  editingMenuImgUrl = null;
  const preview = $('img-preview');
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
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

    const data = {
      merchantId: currentUser.uid,
      name: name,
      price: price,
      category: category,
      description: desc,
      image: imageUrl || '',
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
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกเมนู'; }
  }
}

function editMenu(menuId) {
  openMenuForm(menuId);
}

async function deleteMenu(menuId) {
  if (!confirm('ลบเมนูนี้?')) return;
  try {
    await db.collection('menus').doc(menuId).delete();
    showToast('🗑️ ลบเมนูแล้ว');
  } catch (err) {
    showToast('ลบไม่สำเร็จ', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   20. HISTORY
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

  if (currentHistoryFilter === 'today') {
    filtered = done.filter(o => isToday(o.doneAt || o.createdAt));
  } else if (currentHistoryFilter === 'week') {
    filtered = done.filter(o => isThisWeek(o.doneAt || o.createdAt));
  } else if (currentHistoryFilter === 'month') {
    filtered = done.filter(o => isThisMonth(o.doneAt || o.createdAt));
  } else {
    filtered = done;
  }

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
        <div class="history-title">#${esc(o.id.slice(-8))} • ${esc(o.userName || 'ลูกค้า')}</div>
        <div class="history-meta">🕐 ${fmtDateTime(o.doneAt || o.createdAt)}</div>
      </div>
      <div class="history-amount">฿${fmt(foodTotal)}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════
   21. GP TAB
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
    todayGp += gp.total;
    todayRider += gp.rider;
    todayPlatform += gp.platform;
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
    if (isPromo) {
      cd.classList.add('promo');
      daysEl.textContent = daysLeft;
    } else {
      cd.classList.remove('promo');
      daysEl.textContent = '✓';
    }
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

/* ═══════════════════════════════════════════════════════════════════
   22. GP TRANSFER
   ═══════════════════════════════════════════════════════════════════ */
function openGpTransferForm() {
  if (currentGpPending <= 0) {
    return showToast('ไม่มี GP ค้างโอน', 'info');
  }

  gpSlipFile = null;
  const amountEl = $('gp-transfer-amount');
  if (amountEl) amountEl.textContent = '฿' + fmt(currentGpPending);

  const roundEl = $('gp-transfer-round');
  if (roundEl) {
    const now = new Date();
    const month = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    roundEl.textContent = month;
  }

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
      if (preview) {
        preview.src = ev.target.result;
        preview.style.display = 'block';
      }
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
    const now = new Date();
    const roundLabel = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    const historyEntry = {
      amount: amount,
      slipUrl: slipUrl,
      slipPath: path,
      note: note,
      roundLabel: roundLabel,
      verified: false,
      createdAt: new Date()
    };

    await db.collection('merchants').doc(currentUser.uid).update({
      gpPending: 0,
      gpHistory: firebase.firestore.FieldValue.arrayUnion(historyEntry),
      lastGpTransferAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('gp_transfers').add({
      merchantId: currentUser.uid,
      merchantName: merchantProfile.name,
      amount: amount,
      slipUrl: slipUrl,
      slipPath: path,
      note: note,
      status: 'pending',
      roundLabel: roundLabel,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ ส่งสลิปแล้ว รอแอดมินตรวจสอบ');
    closeSheet('gp-transfer-sheet');
  } catch (err) {
    showToast('ส่งไม่สำเร็จ: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันโอนแล้ว'; }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   23. SHEET / MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openSheet(id) {
  const el = $(id);
  if (el) el.classList.add('show');
}

function closeSheet(id) {
  const el = $(id);
  if (el) el.classList.remove('show');
  if (id === 'menu-form-sheet') {
    editingMenuId = null;
    editingMenuImgBlob = null;
    editingMenuImgUrl = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   24. TABS
   ═══════════════════════════════════════════════════════════════════ */
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
   25. SHOP INFO
   ═══════════════════════════════════════════════════════════════════ */
function showShopInfo() {
  const m = merchantProfile;
  if (!m) return;
  const infoHtml = `
    <div style="background:var(--surface-2);border-radius:14px;padding:16px;margin-bottom:14px">
      <div style="font-size:16px;font-weight:900;margin-bottom:10px">🏪 ${esc(m.name)}</div>
      <div style="font-size:13px;font-weight:700;line-height:2;color:var(--text-muted)">
        <div>📂 ประเภท: ${esc(m.category || '—')}</div>
        <div>📞 เบอร์: ${esc(m.phone || '—')}</div>
        <div>📧 อีเมล: ${esc(m.email || '—')}</div>
        <div>📍 ${esc(m.address || '—')}</div>
        <div>⏰ ${esc(m.openTime || '—')} - ${esc(m.closeTime || '—')}</div>
        <div>⭐ ${(m.ratingAvg || 0).toFixed(1)} (${m.ratingCount || 0} รีวิว)</div>
        <div>${m.verified ? '✅ อนุมัติแล้ว' : '⏳ รออนุมัติ'}</div>
      </div>
    </div>
    <button class="sheet-close" onclick="closeSheet('menu-sheet')">ปิด</button>
  `;
  const sheet = document.querySelector('#menu-sheet .sheet');
  if (sheet) {
    sheet.innerHTML = '<div class="sheet-handle"></div><h2>🏪 ข้อมูลร้าน</h2>' + infoHtml;
    const closeBtn = sheet.querySelector('.sheet-close');
    if (closeBtn) closeBtn.onclick = () => {
      closeSheet('menu-sheet');
      setTimeout(() => location.reload(), 300);
    };
  }
}

function copyShopId() {
  const id = currentUser?.uid;
  if (!id) return;
  navigator.clipboard?.writeText(id).then(() => showToast('📋 คัดลอก ID แล้ว'));
}

/* ═══════════════════════════════════════════════════════════════════
   26. CHAT
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
        lastMessage: '',
        lastSenderId: '',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {}

  const cn = $('chatName'); if (cn) cn.textContent = name;
  const cs = $('chatSub'); if (cs) cs.textContent = sub;
  $('chatContainer')?.classList.add('show');

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(orderId).collection('messages')
    .orderBy('createdAt', 'asc').limit(200)
    .onSnapshot(snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChatMessages(msgs);
    });
}

function closeChat() {
  $('chatContainer')?.classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function callChatPartner() {
  if (activeChatPartnerPhone) {
    window.location.href = 'tel:' + activeChatPartnerPhone;
  } else {
    showToast('ไม่มีเบอร์โทร', 'warning');
  }
}

function renderChatMessages(msgs) {
  const el = $('chatMessages');
  if (!el) return;
  if (msgs.length === 0) {
    el.innerHTML = '<div class="chat-empty">เริ่มสนทนา</div>';
    return;
  }
  let lastDay = '';
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === currentUser.uid;
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) {
      dayDiv = `<div class="chat-day-divider">${day}</div>`;
      lastDay = day;
    }
    const img = m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-image" onclick="window.open('${esc(m.imageUrl)}','_blank')">` : '';
    return `${dayDiv}
      <div class="chat-msg ${isMine ? 'out' : 'in'}">
        ${img}
        ${m.text ? `<div>${esc(m.text)}</div>` : ''}
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
      text,
      senderId: currentUser.uid,
      senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: text.slice(0, 80),
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    showToast('ส่งไม่สำเร็จ', 'error');
  }
}

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');
  try {
    const compressed = await compressImage(file, 800, 0.75);
    const path = `chats/${activeChatId}/${Date.now()}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed);
    const url = await ref.getDownloadURL();

    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url,
      senderId: currentUser.uid,
      senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '📷 รูปภาพ',
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งรูปแล้ว');
  } catch (err) {
    showToast('อัปโหลดไม่สำเร็จ', 'error');
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ═══════════════════════════════════════════════════════════════════
   27. NETWORK & PWA
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
  } else {
    showToast('เปิดเมนู → เพิ่มไปที่หน้าจอหลัก', 'info');
  }
}

function dismissPWA() {
  $('pwa-install-banner')?.classList.add('hidden');
  localStorage.setItem('chauat_merchant_pwa_dismissed', '1');
}

/* ═══════════════════════════════════════════════════════════════════
   28. INIT
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  runSplash();
});

/* ═══════════════════════════════════════════════════════════════════
   29. GLOBAL EXPOSE
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
window.showShopInfo = showShopInfo;
window.copyShopId = copyShopId;
window.openChatWithCustomer = openChatWithCustomer;
window.openChatWithRider = openChatWithRider;
window.closeChat = closeChat;
window.callChatPartner = callChatPartner;
window.sendChatText = sendChatText;
window.sendChatImage = sendChatImage;
window.autoResize = autoResize;
window.installPWA = installPWA;
window.dismissPWA = dismissPWA;

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