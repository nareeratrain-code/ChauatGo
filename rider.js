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

const firebaseApp = firebase.apps.find(a => a.name === 'rider') || firebase.initializeApp(firebaseConfig, 'rider');
const auth = firebase.auth(firebaseApp);
const db = firebase.firestore(firebaseApp);
const storage = firebase.storage(firebaseApp);
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

console.log('%c🛵 Chauat Go Rider v3.9.1', 'color:#FF6B35;font-weight:900;font-size:14px');

/* ═══════════════════════════════════════════════════════════════════
   2. GLOBAL STATE
   ═══════════════════════════════════════════════════════════════════ */
let currentUser = null;
let riderProfile = null;
let allJobs = [];
let allHistory = [];
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
let isOnline = false;
let currentHistoryFilter = 'all';
let cameraFile = null;
let nearNotifiedOrderIds = new Set();
let arrivedShopNotifiedOrderIds = new Set();
let isSigningUp = false;
let authEpoch = 0;

/* รับงานได้ทันทีที่ร้านรับออเดอร์ (cooking) และตอนอาหารพร้อม (ready) — ห้ามก่อนร้านรับ */
const RIDER_CLAIM_STATUSES = ['cooking', 'ready'];
const RIDER_ACTIVE_STATUSES = ['accepted', 'picked_up', 'customer_paid', 'on_the_way'];
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
const SERVICE_BASE = 20;
const SERVICE_PER_KM = 8;
const FREE_KM = 1;
const ARRIVAL_RADIUS_M = 150;
const NEAR_CUSTOMER_RADIUS_M = 100;
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

function soundNewJob() {
  playTone([880, 1108, 1318, 1108], 0.18, 0.18, 0.4);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
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

/* ═══════════════════════════════════════════════════════════════════
   9. FINANCE
   ═══════════════════════════════════════════════════════════════════ */
function calcOrderFinance(order) {
  const fare = Number(order.fare || 0);
  const isCash = order.paymentMode === 'cash';
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
  if (myJobsUnsub) myJobsUnsub();
  if (myHistoryUnsub) myHistoryUnsub();
  if (activeChatUnsub) activeChatUnsub();
  stopGPS();
  clearPaymentTimers();
  allJobs = [];
  allHistory = [];
  seenJobIds.clear();
  foodReadySeen = null;
  nearNotifiedOrderIds.clear();
  arrivedShopNotifiedOrderIds.clear();
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   11. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  const epoch = ++authEpoch;
  if (isSigningUp) return;

  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();
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
  subscribeJobs();
  subscribeHistory();
  setupNetwork();
  setupPWA();
  requestNotificationPermission();
  setTimeout(scheduleGPSIfActive, 1500);
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
  myProfileUnsub = db.collection('riders').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prevVerified = riderProfile?.verified;
    riderProfile = { uid: currentUser.uid, ...snap.data() };
    if (prevVerified === false && riderProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว!', 'success');
      soundNewJob();
    }
    updateHeader();
    updatePendingBanner();
    updateOnlineToggle();
    updateHeroStats();
  });
}

/* งานใหม่ = ร้านรับแล้ว (cooking) หรืออาหารพร้อม (ready) */
function subscribeJobs() {
  if (myJobsUnsub) myJobsUnsub();
  myJobsUnsub = db.collection('orders')
    .where('status', 'in', ['cooking', 'ready', 'accepted', 'picked_up', 'customer_paid', 'on_the_way'])
    .limit(50)
    .onSnapshot(snap => {
      const prevIds = seenJobIds;
      allJobs = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
      });

      /* ⭐ v3.9.1: Sort client-side */
      allJobs.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.getTime() : 0;
        const tb = b.createdAt ? b.createdAt.getTime() : 0;
        return tb - ta;
      });

      const newJobs = allJobs.filter(j =>
        !prevIds.has(j.id) &&
        RIDER_CLAIM_STATUSES.includes(j.status) &&
        !j.riderId &&
        riderProfile?.verified === true &&
        isOnline
      );

      if (newJobs.length > 0 && prevIds.size > 0) {
        soundNewJob();
        showNewJobPopup(newJobs[0]);
      }

      noteFoodReady(allJobs);
      seenJobIds = new Set(allJobs.map(j => j.id));
      renderJobs();
      updateHeroStats();
      scheduleGPSIfActive();
      autoStartPaymentWatch();
    });
}

function subscribeHistory() {
  if (myHistoryUnsub) myHistoryUnsub();
  myHistoryUnsub = db.collection('orders')
    .where('riderId', '==', currentUser.uid)
    .where('status', '==', 'done')
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
  if (trustEl) trustEl.textContent = '⭐ ' + (riderProfile.trustScore || 100);
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
  isOnline = riderProfile?.verified === true && ONLINE_VALUES.includes(riderProfile?.status);

  btn.classList.toggle('online', isOnline);
  btn.disabled = riderProfile?.verified !== true;
  lbl.textContent = isOnline ? 'ออนไลน์' : 'ออฟไลน์';
  st.textContent = riderProfile?.verified !== true
    ? '⏳ รอการอนุมัติ'
    : (isOnline ? '🟢 พร้อมรับงาน' : '⚫ ออฟไลน์');
  renderJobs();
}

function updateHeroStats() {
  const today = allHistory.filter(j => isToday(j.doneAt || j.createdAt));
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
  const subEl = $('hero-sub');
  if (subEl) subEl.textContent = `จาก ${today.length} งานเสร็จสิ้นวันนี้`;
  const feeEl = $('hero-fee');
  if (feeEl) feeEl.textContent = '฿' + fmt(feeTotal);
  const tipEl = $('hero-tip');
  if (tipEl) tipEl.textContent = '฿' + fmt(tipTotal);
  const oweEl = $('hero-owe');
  if (oweEl) oweEl.textContent = '฿' + fmt(todayOwe);

  const activeCount = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
  ).length;

  const doneEl = $('stat-done');
  if (doneEl) doneEl.textContent = today.length;
  const activeEl = $('stat-active');
  if (activeEl) activeEl.textContent = activeCount;
  const totalEl = $('stat-total');
  if (totalEl) totalEl.textContent = riderProfile?.totalJobs || allHistory.length;
}
/* ═══════════════════════════════════════════════════════════════════
   15. RENDER JOBS
   ⭐ v3.9.1: เห็นทั้ง searching + ready
   ═══════════════════════════════════════════════════════════════════ */
function renderJobs() {
  const myId = currentUser?.uid;

  const newJobs = allJobs.filter(j =>
    RIDER_CLAIM_STATUSES.includes(j.status) &&
    !j.riderId &&
    riderProfile?.verified && isOnline
  );

  const activeJobs = allJobs.filter(j =>
    j.riderId === myId &&
    (RIDER_ACTIVE_STATUSES.includes(j.status) || j.status === 'ready')
  );

  const doneToday = allHistory.filter(j => isToday(j.doneAt || j.createdAt));

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
    picked_up: { label: '📦 รอลูกค้าโอนเงิน', color: '#E65100', bg: '#FFF3E0' },
    customer_paid: { label: '💳 โอนแล้ว • เริ่มส่งได้', color: 'var(--green)', bg: '#E8F5E9' },
    on_the_way: { label: '🚀 กำลังส่ง', color: 'var(--green)', bg: '#E8F5E9' },
    done: { label: '✅ เสร็จ', color: 'var(--green)', bg: '#E8F5E9' }
  }[j.status] || { label: j.status, color: 'var(--text-muted)', bg: 'var(--surface-2)' };

  const payBadge = fin.isCash
    ? `<span class="jc-badge jc-cash">💵 เงินสด • ต้องมี ฿${fmt(fin.foodAmount)}</span>`
    : `<span class="jc-badge jc-transfer">💳 โอน • ลูกค้าจ่าย ฿${fmt(fin.totalCustomerPay)}</span>`;

  const typeIcon = (j.type === 'ride') ? '🚗'
    : (j.type === 'express') ? '📦'
    : (j.type === 'shopping') ? '🛒'
    : '🍽️';

  const phoneBtn = j.userPhone
    ? `<a href="tel:${esc(j.userPhone)}" class="jc-icon-btn" onclick="event.stopPropagation()" title="โทร">📞</a>`
    : '';

  const chatBtn = `<button class="jc-icon-btn" onclick="event.stopPropagation();openChatWithCustomer('${esc(j.id)}')" title="แชท">💬</button>`;

  /* Code */
  const codeHtml = j.code
    ? `<div style="font-size:11px;font-weight:900;color:var(--brand);margin-bottom:4px">🧾 ${esc(j.code)}</div>`
    : '';

  const foodIsReady = !!(j.foodReady || j.readyAt || j.status === 'ready');
  if (j.status === 'accepted' && foodIsReady) {
    statusInfo = { label: '✅ อาหารพร้อม • ไปรับที่ร้าน', color: 'var(--green)', bg: '#E8F5E9' };
  }
  const prepHtml = (!foodIsReady && j.prepMinutes)
    ? `<div class="jc-row"><span class="jc-row-icon">⏱️</span><span class="jc-row-text">ร้านใช้เวลาทำประมาณ ${Number(j.prepMinutes)} นาที</span></div>`
    : '';

  let primaryAction = '';
  if (isNew && (j.status === 'cooking' || j.status === 'ready')) {
    primaryAction = `<button type="button" class="jc-primary-btn jc-accept" data-accept="${esc(j.id)}">✅ รับงาน</button>
      <button type="button" class="jc-secondary-btn" data-skip="${esc(j.id)}">⏭️</button>`;
  } else if (j.status === 'accepted' || (j.status === 'ready' && j.riderId)) {
    primaryAction = `<button type="button" class="jc-primary-btn jc-orange" data-arrived="${esc(j.id)}" onclick="arrivedAtShop('${esc(j.id)}')">📍 ถึงร้าน</button>
      <button type="button" class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'picked_up') {
    const isPaid = !!j.customerPaidAt;
    if (isPaid) {
      primaryAction = `<button class="jc-primary-btn jc-green" data-start-deliver="${esc(j.id)}">🚀 เริ่มส่ง</button>
        <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    } else {
      primaryAction = `<button class="jc-primary-btn jc-gray" disabled>⏳ รอลูกค้าโอนเงิน</button>
        <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
    }
  } else if (j.status === 'customer_paid') {
    primaryAction = `<button class="jc-primary-btn jc-green" data-start-deliver="${esc(j.id)}">🚀 เริ่มส่ง</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'on_the_way') {
    primaryAction = `<button class="jc-primary-btn jc-green" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'done') {
    primaryAction = `<button class="jc-primary-btn jc-gray" data-detail="${esc(j.id)}">📄 ดูรายละเอียด</button>`;
  } else {
    primaryAction = `<button class="jc-primary-btn jc-gray" disabled>⏳ รอสถานะ</button>`;
  }

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
          ${phoneBtn}
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

      <div class="jc-finance">
        <div class="jc-finance-left">
          <div class="jc-finance-label">💰 ค่าบริการ</div>
          <div class="jc-finance-sub">คุณได้ 80% ของค่าส่ง = ฿${fmt(fin.riderShare)}${fin.tip > 0 ? ` + ทิปเงินสด ฿${fin.tip}` : ''}</div>
        </div>
        <div class="jc-finance-amount">฿${fmt(fin.totalRider)}</div>
      </div>

      <div class="jc-actions">
        ${primaryAction}
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   16. JOB ACTIONS
   ═══════════════════════════════════════════════════════════════════ */

/* รับได้เมื่อร้านรับแล้ว (cooking) หรืออาหารพร้อม (ready) — ไม่รับก่อนร้านรับ */
async function acceptJob(jobId) {
  try {
    const ref = db.collection('orders').doc(jobId);
    let readyAlready = false;
    let prepMinutes = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('missing');
      const job = snap.data();
      if (job.status === 'searching' || job.status === 'pending') throw new Error('shop');
      if (!RIDER_CLAIM_STATUSES.includes(job.status) || job.riderId) throw new Error('taken');
      readyAlready = !!(job.foodReady || job.readyAt || job.status === 'ready');
      prepMinutes = Number(job.prepMinutes || 0);
      tx.update(ref, {
        riderId: currentUser.uid,
        riderName: riderProfile.name,
        riderPhone: riderProfile.phone,
        status: 'accepted',
        acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    showToast(readyAlready
      ? '✅ รับงานแล้ว — อาหารพร้อม ไปที่ร้าน'
      : ('✅ รับงานแล้ว — ร้านกำลังทำ' + (prepMinutes ? ' ประมาณ ' + prepMinutes + ' นาที' : '')));
    closeNewJobPopup();
    scheduleGPSIfActive();
  } catch (err) {
    const code = err && err.message;
    if (code === 'shop') return showToast('รอร้านรับออเดอร์ก่อน', 'warning');
    if (code === 'taken') return showToast('⚠️ งานนี้ถูกรับไปแล้วหรือไม่พร้อม', 'warning');
    if (code === 'missing') return showToast('ไม่พบงานนี้', 'error');
    showToast('รับงานไม่สำเร็จ: ' + (err.code || err.message), 'error');
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
  const who = job.merchantName || job.code || 'ร้าน';
  showToast('อาหารพร้อมแล้ว — ไปรับที่ร้านได้', 'success', 6000);
  soundNewJob();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('✅ อาหารพร้อมแล้ว', {
        body: who + (job.code ? ' • ' + job.code : ''),
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
  openPickupModal(jobId, job);
}

/* ⭐ v3.9.1: Modal รับอาหาร — ถ่ายรูปอาหาร + สลิป */
function openPickupModal(jobId, job) {
  pickupOrderId = jobId;
  pickupFoodBlob = null;
  pickupSlipBlob = null;
  pickupFoodUrl = null;
  pickupSlipUrl = null;

  const fin = calcOrderFinance(job);
  const mc = $('modalContent');
  if (!mc) return;

  mc.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:48px">📸</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">รับอาหารจากร้าน</h2>
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">
        กรุณาถ่ายรูปอาหาร + สลิปที่จ่ายร้าน
      </p>
    </div>

    <!-- ข้อมูลร้าน -->
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:14px;font-weight:900">🏪 ${esc(job.merchantName || 'ร้านค้า')}</div>
      ${job.code ? `<div style="font-size:11px;color:var(--brand);font-weight:900;margin-top:4px">🧾 ${esc(job.code)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:8px 0 0;margin-top:8px;border-top:1px dashed var(--border)">
        <span>💰 ยอดที่ต้องโอนร้าน</span>
        <span style="font-weight:900;color:var(--green)">฿${fmt(fin.foodAmount)}</span>
      </div>
    </div>

    <!-- รูปอาหาร -->
    <div style="margin-bottom:14px">
      <label style="display:block;font-size:13px;font-weight:900;margin-bottom:8px">
        📸 รูปอาหาร <span style="color:#E53935">*บังคับ</span>
      </label>
      <div style="border:2px dashed var(--border);border-radius:12px;aspect-ratio:1;max-height:220px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--surface-2);overflow:hidden;position:relative" onclick="document.getElementById('pickup-food-input').click()">
        <div id="pickup-food-placeholder" style="text-align:center">
          <div style="font-size:36px">🍽️</div>
          <div style="font-size:12px;font-weight:700;margin-top:6px;color:var(--text-muted)">แตะเพื่อถ่ายรูปอาหาร</div>
        </div>
        <img id="pickup-food-preview" style="display:none;width:100%;height:100%;object-fit:cover">
      </div>
      <input type="file" id="pickup-food-input" accept="image/*" capture="environment" style="display:none" onchange="handlePickupImage(event, 'food')">
    </div>

    <!-- สลิปโอนร้าน -->
    <div style="margin-bottom:14px">
      <label style="display:block;font-size:13px;font-weight:900;margin-bottom:8px">
        🧾 สลิปที่จ่ายร้าน <span style="color:#E53935">*บังคับ</span>
      </label>
      <div style="border:2px dashed var(--border);border-radius:12px;aspect-ratio:1;max-height:220px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--surface-2);overflow:hidden;position:relative" onclick="document.getElementById('pickup-slip-input').click()">
        <div id="pickup-slip-placeholder" style="text-align:center">
          <div style="font-size:36px">🧾</div>
          <div style="font-size:12px;font-weight:700;margin-top:6px;color:var(--text-muted)">แตะเพื่อแนบสลิป</div>
        </div>
        <img id="pickup-slip-preview" style="display:none;width:100%;height:100%;object-fit:cover">
      </div>
      <input type="file" id="pickup-slip-input" accept="image/*" capture="environment" style="display:none" onchange="handlePickupImage(event, 'slip')">
    </div>

    <!-- ปุ่ม -->
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="action-btn-big btn-gray-big ripple" style="flex:1" onclick="closeModal()">ยกเลิก</button>
      <button class="action-btn-big btn-green-big ripple" style="flex:1" id="pickup-confirm-btn" disabled onclick="confirmPickup()">📤 ส่งให้ลูกค้า</button>
    </div>
  `;

  $('modalOverlay').classList.add('show');
}

/* ⭐ v3.9.1: จัดการรูปที่ถ่าย */
async function handlePickupImage(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > MAX_SLIP_SIZE) {
    showToast('รูปใหญ่เกิน 5MB', 'error');
    event.target.value = '';
    return;
  }

  showToast('⏳ กำลังประมวลผล...', 'info');

  try {
    const compressed = await compressImage(file, 1000, 0.8);
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

  event.target.value = '';
}

function updatePickupConfirmBtn() {
  const btn = $('pickup-confirm-btn');
  if (!btn) return;
  btn.disabled = !(pickupFoodBlob && pickupSlipBlob);
}

/* ⭐ v3.9.1: ยืนยันรับอาหาร → picked_up */
async function confirmPickup() {
  if (!pickupFoodBlob || !pickupSlipBlob) {
    return showToast('⚠️ กรุณาถ่ายรูปอาหาร + สลิป', 'warning');
  }

  const btn = $('pickup-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }

  try {
    const jobId = pickupOrderId;
    const ts = Date.now();

    /* อัปโหลดรูปอาหาร */
    const foodPath = `orders/${jobId}/food_${ts}.jpg`;
    const foodRef = storage.ref(foodPath);
    await foodRef.put(pickupFoodBlob);
    pickupFoodUrl = await foodRef.getDownloadURL();

    /* อัปโหลดสลิป */
    const slipPath = `slips/riders/${currentUser.uid}/${jobId}_${ts}.jpg`;
    const slipRef = storage.ref(slipPath);
    await slipRef.put(pickupSlipBlob);
    pickupSlipUrl = await slipRef.getDownloadURL();

    /* อัปเดต order */
    await db.collection('orders').doc(jobId).update({
      status: 'picked_up',
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
      foodImage: pickupFoodUrl,
      foodImagePath: foodPath,
      riderSlipToShop: pickupSlipUrl,
      riderSlipToShopPath: slipPath,
      riderPaidShopAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ ส่งให้ลูกค้าแล้ว — รอโอนเงิน');
    closeModal();
    arrivedShopNotifiedOrderIds.add(jobId);

    /* เริ่ม timer รอ 5 นาที */
    startPaymentTimers(jobId);
  } catch (err) {
    console.error('confirmPickup error:', err);
    showToast('อัปโหลดไม่สำเร็จ: ' + (err.code || err.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 ส่งให้ลูกค้า'; }
  }
}

/* ⭐ v3.9.1: Timer 5 นาที → โทรตาม, 15 นาที → ยกเลิกได้ */
function startPaymentTimers(jobId) {
  clearPaymentTimers();

  paymentTimeout5 = setTimeout(async () => {
    const job = allJobs.find(j => j.id === jobId);
    if (!job || job.customerPaidAt) return;

    showToast('⚠️ ลูกค้ายังไม่โอน — กรุณาโทรตาม', 'warning');
    playTone([660, 660, 880], 0.2, 0.3, 0.6);

    if (job.userPhone) {
      if (confirm('⚠️ ลูกค้ายังไม่โอนเงิน (5 นาที)\n\nโทรหาลูกค้าตอนนี้?')) {
        window.location.href = 'tel:' + job.userPhone;
      }
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

/* ⭐ v3.9.1: เริ่มส่ง — ต้องมี customerPaidAt */
async function startDelivery(jobId) {
  try {
    const snap = await db.collection('orders').doc(jobId).get();
    if (!snap.exists) return showToast('ไม่พบงาน', 'error');
    const job = snap.data();

    if (!job.customerPaidAt) {
      return showToast('⚠️ ลูกค้ายังไม่โอนเงิน', 'warning');
    }

    await db.collection('orders').doc(jobId).update({
      status: 'on_the_way',
      onTheWayAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🚀 เริ่มส่งอาหาร');
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
    !j.customerPaidAt
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
    await db.collection('orders').doc(jobId).update({
      status: 'done',
      doneAt: firebase.firestore.FieldValue.serverTimestamp(),
      riderIncome: fin.riderShare + fin.tip,
      riderOwe: fin.platformShare,
      riderPaid: false
    });

    await db.collection('riders').doc(currentUser.uid).update({
      totalJobs: firebase.firestore.FieldValue.increment(1),
      totalIncome: firebase.firestore.FieldValue.increment(fin.riderShare + fin.tip)
    });

    showToast('✅ ส่งสำเร็จ! +฿' + fmt(fin.totalRider));
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
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;
  const fin = calcOrderFinance(job);
  const mapUrl = job.lat && job.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
    : (job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null);
  const mc = $('modalContent');
  if (!mc) return;

  const codeHtml = job.code
    ? `<div style="background:linear-gradient(135deg,#FF6B35,#E55A2B);color:#fff;border-radius:12px;padding:12px;margin-bottom:14px;text-align:center">
        <div style="font-size:11px;opacity:.9;font-weight:800">🧾 Order Code</div>
        <div style="font-size:24px;font-weight:900;letter-spacing:3px;margin-top:4px">${esc(job.code)}</div>
      </div>`
    : '';

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

  const payStatusHtml = job.customerPaidAt
    ? `<div style="background:#E8F5E9;border-left:4px solid var(--green);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--green);font-weight:900">✅ ลูกค้าโอนเงินแล้ว — เริ่มส่งได้</div>`
    : (job.status === 'picked_up'
      ? `<div style="background:#FFF3E0;border-left:4px solid var(--orange);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#E65100;font-weight:900">⏳ รอลูกค้าโอนเงิน</div>`
      : '');

  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 รายละเอียดงาน</h2>
    ${codeHtml}
    ${payStatusHtml}
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-weight:900;font-size:15px;margin-bottom:8px">${esc(job.title || 'งาน')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);line-height:1.9">
        <div>👤 ลูกค้า: <b>${esc(job.userName || '—')}</b></div>
        <div>📞 เบอร์: <b>${esc(job.userPhone || '—')}</b></div>
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      ${job.userPhone ? `<a href="tel:${esc(job.userPhone)}" class="action-btn-big btn-blue-big ripple" style="text-decoration:none;color:#fff;justify-content:center">📞 โทรหา</a>` : ''}
      ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="action-btn-big btn-orange-big ripple" style="text-decoration:none;color:#fff;justify-content:center">📍 นำทาง</a>` : ''}
    </div>
    ${job.status !== 'done' ? `<button class="action-btn-big btn-gray-big ripple" style="width:100%;margin-bottom:8px" onclick="openChatWithCustomer('${esc(job.id)}')">💬 แชทกับลูกค้า</button>` : ''}
    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
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
      ${job.code ? `<div style="font-size:16px;font-weight:900;color:var(--brand);text-align:center;padding:8px;background:var(--brand-light);border-radius:8px;margin-bottom:8px">🧾 ${esc(job.code)}</div>` : ''}
      <div>👤 <strong>${esc(job.userName || 'ลูกค้า')}</strong></div>
      <div>📞 <strong>${esc(job.userPhone || '—')}</strong></div>
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
        body: `${job.userName || 'ลูกค้า'} - ฿${fmt(fin.fare)}`,
        icon: '/icons/icon-512.png',
        tag: 'new-job-' + job.id
      });
    } catch (e) {}
  }
}

function closeNewJobPopup() {
  $('newJobPopup').classList.remove('show');
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
  if (hasActive && isOnline) startGPS();
  else stopGPS();
}

function startGPS() {
  if (!navigator.geolocation) return;
  if (gpsWatchId) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      try {
        await db.collection('gps_riders').doc(currentUser.uid).set({
          riderId: currentUser.uid,
          name: riderProfile.name,
          lat: latitude,
          lng: longitude,
          accuracy,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

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

async function checkArrivalForActiveOrders(myLat, myLng) {
  const myActive = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
  );

  for (const job of myActive) {
    if (job.status === 'accepted' && job.shopPlaceLat && job.shopPlaceLng
      && !arrivedShopNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.shopPlaceLat, job.shopPlaceLng) * 1000;
      if (dist <= ARRIVAL_RADIUS_M) {
        arrivedShopNotifiedOrderIds.add(job.id);
        soundArrivedShop();
        showToast('📍 ถึงร้านแล้ว — กด "ถึงร้าน" เพื่อรับอาหาร');
      }
    }

    if (job.status === 'on_the_way' && job.lat && job.lng
      && !nearNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.lat, job.lng) * 1000;
      if (dist <= NEAR_CUSTOMER_RADIUS_M) {
        nearNotifiedOrderIds.add(job.id);
        soundNearCustomer();
        showToast('🔔 ใกล้ถึงลูกค้า 100 ม.');

        await db.collection('orders').doc(job.id).update({
          riderNearCustomerAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
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
function openSheet() { $('sheetOverlay')?.classList.add('show'); }
function closeSheet() { $('sheetOverlay')?.classList.remove('show'); }
function closeModal() {
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
function showProfile() {
  const mc = $('modalContent');
  if (!mc) return;
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
      <p><b>งานทั้งหมด:</b> ${riderProfile.totalJobs || 0} งาน</p>
      <p><b>รายได้รวม:</b> ฿${fmt(riderProfile.totalIncome || 0)}</p>
      <p><b>Trust Score:</b> ⭐ ${riderProfile.trustScore || 100} / 100</p>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showFinance() {
  const today = allHistory.filter(j => isToday(j.doneAt || j.createdAt));
  const week = allHistory.filter(j => {
    const d = toDate(j.doneAt);
    if (!d) return false;
    return d >= new Date(Date.now() - 7 * 86400000);
  });
  const month = allHistory.filter(j => {
    const d = toDate(j.doneAt);
    if (!d) return false;
    return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
  });

  const sum = (arr) => arr.reduce((s, j) => s + Number(j.riderIncome || 0), 0);
  const pendingOwe = allHistory.filter(j => !j.riderPaid).reduce((s, j) => s + Number(j.riderOwe || 0), 0);

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
            <span>${j.code ? '🧾 ' + esc(j.code) : esc(j.title || 'งาน')}</span>
            <span style="color:var(--green)">฿${fmt(j.riderIncome || 0)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-top:4px">
            🕐 ${fmtDateTime(j.doneAt || j.createdAt)} • 👤 ${esc(j.userName || '')}
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
  activeChatPartnerPhone = job.userPhone || null;
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
  const cs = $('chatSub'); if (cs) cs.textContent = job.code ? '🧾 ' + job.code : (job.title || 'ออเดอร์');
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
  activeChatPartnerPhone = job.userPhone || null;
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
  const cs = $('chatSub'); if (cs) cs.textContent = sub || job.title || 'ออเดอร์';
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
      senderRole: 'rider',
      senderName: riderProfile?.name || currentUser.displayName || 'ไรเดอร์',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: text.slice(0, 80),
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.warn('sendChatText error:', err);
    showToast('ส่งไม่สำเร็จ: ' + (err.code || err.message), 'error');
    inp.value = text;
  }
}

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > MAX_SLIP_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');
  try {
    const compressed = await compressImage(file, 800, 0.75);
    const path = `chats/${activeChatId}/images/${Date.now()}_${currentUser.uid}.jpg`;
    const ref = storage.ref(path);
    await ref.put(compressed);
    const url = await ref.getDownloadURL();

    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url,
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: riderProfile?.name || currentUser.displayName || 'ไรเดอร์',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '📷 รูปภาพ',
      lastSenderId: currentUser.uid,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
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
   25. EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-skip],[data-arrived],[data-start-deliver],[data-deliver],[data-detail],[data-chat]');
  if (!t) return;

  try {
    if (t.dataset.accept) await acceptJob(t.dataset.accept);
    else if (t.dataset.skip) skipJob(t.dataset.skip);
    else if (t.dataset.arrived) await arrivedAtShop(t.dataset.arrived);
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
window.arrivedAtShop = arrivedAtShop;
window.openSheet = openSheet;
window.closeSheet = closeSheet;
window.closeModal = closeModal;
window.showProfile = showProfile;
window.showFinance = showFinance;
window.showTransferShop = showTransferShop;
window.showTransferApp = showTransferApp;
window.showGPIncome = showGPIncome;
window.showTrustScore = showTrustScore;
window.showHistory = showHistory;
window.showJobDetail = showJobDetail;
window.closeNewJobPopup = closeNewJobPopup;
window.acceptFromPopup = acceptFromPopup;
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