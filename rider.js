/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO RIDER — v3.7.1
   Full-featured Production JavaScript
   ✅ Fix chat merchantId (Phase A)
   ✅ รองรับ cooking / ready (Flow A)
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

console.log('%c🛵 Chauat Go Rider v3.7.1', 'color:#FF6B35;font-weight:900;font-size:14px');

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

/* ⭐ v3.7.0: Status */
const RIDER_VISIBLE_STATUSES = ['searching', 'pending', 'cooking', 'ready'];
const RIDER_ACTIVE_STATUSES = ['accepted', 'picked_up', 'on_the_way'];

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
  const tip = isCash ? CASH_TIP : 0;
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

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ');
  } catch (err) {
    if (createdUser) { try { await createdUser.delete(); } catch (e) {} }
    showToast('สมัครไม่สำเร็จ: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✅ สมัครเป็นไรเดอร์';
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

async function handleLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeSheet();
  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();
  if (myHistoryUnsub) myHistoryUnsub();
  if (activeChatUnsub) activeChatUnsub();
  stopGPS();
  allJobs = [];
  allHistory = [];
  seenJobIds.clear();
  nearNotifiedOrderIds.clear();
  arrivedShopNotifiedOrderIds.clear();
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   11. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async (user) => {
  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();
  if (myHistoryUnsub) myHistoryUnsub();

  if (!user) {
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    return;
  }

  currentUser = user;

  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'rider') {
      showToast('บัญชีนี้ไม่ใช่ไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    const riderDoc = await db.collection('riders').doc(user.uid).get();
    if (!riderDoc.exists) {
      showToast('ไม่พบข้อมูลไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    riderProfile = { uid: user.uid, ...riderDoc.data() };
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    initApp();
  } catch (err) {
    showToast('เกิดข้อผิดพลาด', 'error');
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

function subscribeJobs() {
  if (myJobsUnsub) myJobsUnsub();
  myJobsUnsub = db.collection('orders')
    .where('status', 'in', ['searching', 'pending', 'cooking', 'ready', 'accepted', 'picked_up', 'on_the_way'])
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snap => {
      const prevIds = seenJobIds;
      allJobs = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
      });

      const newJobs = allJobs.filter(j =>
        !prevIds.has(j.id) &&
        RIDER_VISIBLE_STATUSES.includes(j.status) &&
        !j.riderId &&
        riderProfile?.verified === true &&
        isOnline
      );

      if (newJobs.length > 0 && prevIds.size > 0) {
        soundNewJob();
        showNewJobPopup(newJobs[0]);
      }

      seenJobIds = new Set(allJobs.map(j => j.id));
      renderJobs();
      updateHeroStats();
      scheduleGPSIfActive();
    });
}

function subscribeHistory() {
  if (myHistoryUnsub) myHistoryUnsub();
  myHistoryUnsub = db.collection('orders')
    .where('riderId', '==', currentUser.uid)
    .where('status', '==', 'done')
    .orderBy('doneAt', 'desc')
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
}

function updateHeroStats() {
  const today = allHistory.filter(j => isToday(j.doneAt || j.createdAt));
  const feeTotal = today.reduce((s, j) => {
    const f = Number(j.fare || 0);
    return s + f * RIDER_SHARE;
  }, 0);
  const tipTotal = today.reduce((s, j) => s + (j.isCash ? CASH_TIP : 0), 0);
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
   15. RENDER JOBS — Job Card ใหม่ (Grab-style)
   ═══════════════════════════════════════════════════════════════════ */
function renderJobs() {
  const myId = currentUser?.uid;

  const newJobs = allJobs.filter(j =>
    RIDER_VISIBLE_STATUSES.includes(j.status) &&
    !j.riderId &&
    riderProfile?.verified && isOnline
  );

  const activeJobs = allJobs.filter(j =>
    j.riderId === myId &&
    RIDER_ACTIVE_STATUSES.includes(j.status)
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

  const statusInfo = {
    searching: { label: '🔔 ใหม่', color: 'var(--orange)', bg: '#FFF3E0' },
    pending: { label: '🔔 รอร้านรับ', color: 'var(--orange)', bg: '#FFF3E0' },
    cooking: { label: '🍳 ร้านกำลังทำ', color: '#E65100', bg: '#FFF3E0' },
    ready: { label: '✅ พร้อมส่ง', color: 'var(--green)', bg: '#E8F5E9' },
    accepted: { label: '🛵 รับแล้ว', color: 'var(--blue)', bg: '#E3F2FD' },
    picked_up: { label: '📦 รับของแล้ว', color: 'var(--blue)', bg: '#E3F2FD' },
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

  let primaryAction = '';
  if (isNew) {
    primaryAction = `<button class="jc-primary-btn jc-accept" data-accept="${esc(j.id)}">✅ รับงาน</button>
      <button class="jc-secondary-btn" data-skip="${esc(j.id)}">⏭️</button>`;
  } else if (j.status === 'accepted') {
    primaryAction = `<button class="jc-primary-btn jc-orange" data-arrived="${esc(j.id)}">📍 ถึงร้าน</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'picked_up') {
    primaryAction = `<button class="jc-primary-btn jc-blue" data-ontheway="${esc(j.id)}">🚀 เริ่มส่ง</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'on_the_way') {
    primaryAction = `<button class="jc-primary-btn jc-green" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="jc-secondary-btn" data-detail="${esc(j.id)}">📋</button>`;
  } else if (j.status === 'done') {
    primaryAction = `<button class="jc-primary-btn jc-gray" data-detail="${esc(j.id)}">📄 ดูรายละเอียด</button>`;
  }

  return `
    <div class="jc-card ${isNew ? 'jc-new' : ''}" data-card-id="${esc(j.id)}">
      <div class="jc-header">
        <div class="jc-type-icon">${typeIcon}</div>
        <div class="jc-header-info">
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
      </div>

      <div class="jc-payment-row">${payBadge}</div>

      <div class="jc-finance">
        <div class="jc-finance-left">
          <div class="jc-finance-label">💰 ค่าบริการ</div>
          <div class="jc-finance-sub">คุณได้ 80% = ฿${fmt(fin.riderShare)}${fin.tip > 0 ? ` + ทิป ฿${fin.tip}` : ''}</div>
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
async function acceptJob(jobId) {
  try {
    const snap = await db.collection('orders').doc(jobId).get();
    if (!snap.exists) return showToast('ไม่พบงานนี้', 'error');
    const job = snap.data();
    if (job.riderId) return showToast('มีคนรับงานนี้ไปแล้ว', 'warning');

    await db.collection('orders').doc(jobId).update({
      riderId: currentUser.uid,
      riderName: riderProfile.name,
      riderPhone: riderProfile.phone,
      status: 'accepted',
      acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ รับงานแล้ว!');
    closeNewJobPopup();
    scheduleGPSIfActive();
  } catch (err) {
    showToast('รับงานไม่สำเร็จ: ' + (err.code || err.message), 'error');
  }
}

async function arrivedAtShop(jobId) {
  try {
    await db.collection('orders').doc(jobId).update({
      status: 'picked_up',
      arrivedAtShopAt: firebase.firestore.FieldValue.serverTimestamp(),
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
      riderArrivedShopNotifiedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('📍 แจ้งร้านค้าและลูกค้าแล้ว');
    arrivedShopNotifiedOrderIds.add(jobId);
  } catch (err) { showToast('ไม่สำเร็จ', 'error'); }
}

async function onTheWayJob(jobId) {
  try {
    await db.collection('orders').doc(jobId).update({
      status: 'on_the_way',
      onTheWayAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🚀 เริ่มส่ง');
  } catch (err) { showToast('ไม่สำเร็จ', 'error'); }
}

async function deliverJob(jobId) {
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;
  const fin = calcOrderFinance(job);
  openDeliverModal(job, fin);
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
      <p style="color:var(--text-muted);font-size:13px;font-weight:600;margin-top:4px">แนบสลิปโอนเงินให้ร้านค้า</p>
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
        <span>คุณได้ (80%${fin.tip > 0 ? ' + ทิป' : ''})</span>
        <span style="font-weight:900">฿${fmt(fin.totalRider)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#E65100;border-top:1px dashed var(--border);margin-top:6px;padding-top:8px">
        <span>โอนร้านค้า</span>
        <span style="font-weight:900">฿${fmt(fin.foodAmount)}</span>
      </div>
    </div>

    <div class="slip-upload-box" onclick="document.getElementById('slip-input').click()">
      <div class="icon">📸</div>
      <div class="label">แตะเพื่ออัปโหลดสลิป</div>
      <div class="hint">แนบสลิปโอนเงินให้ร้านค้า</div>
    </div>
    <input type="file" id="slip-input" accept="image/*" capture="environment" style="display:none">
    <img id="slip-preview" class="slip-preview" style="display:none">

    <div class="slip-progress" id="slip-progress" style="display:none">
      <div class="slip-progress-bar" id="slip-progress-bar"></div>
    </div>

    <div class="job-actions two" style="margin-top:16px">
      <button class="action-btn-big btn-gray-big ripple" onclick="closeModal()">ยกเลิก</button>
      <button class="action-btn-big btn-green-big ripple" id="confirm-deliver-btn">✅ ยืนยัน</button>
    </div>
  `;

  $('modalOverlay').classList.add('show');

  $('slip-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_SLIP_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = $('slip-preview');
      preview.src = ev.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  $('confirm-deliver-btn').addEventListener('click', async () => {
    const file = $('slip-input').files[0];
    const btn = $('confirm-deliver-btn');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังบันทึก...';

    try {
      let slipUrl = null;
      let slipPath = null;

      if (file) {
        const progress = $('slip-progress');
        const bar = $('slip-progress-bar');
        progress.style.display = 'block';
        const compressed = await compressImage(file, 1000, 0.8);
        slipPath = `slips/riders/${currentUser.uid}/${job.id}_${Date.now()}.jpg`;
        const ref = storage.ref(slipPath);
        const task = ref.put(compressed);
        task.on('state_changed', (s) => {
          bar.style.width = (s.bytesTransferred / s.totalBytes * 100) + '%';
        });
        await task;
        slipUrl = await ref.getDownloadURL();
      }

      await db.collection('orders').doc(job.id).update({
        status: 'done',
        doneAt: firebase.firestore.FieldValue.serverTimestamp(),
        riderSlipUrl: slipUrl,
        riderSlipPath: slipPath,
        riderSlipVerified: false,
        riderIncome: fin.riderShare + fin.tip,
        riderOwe: fin.platformShare,
        riderPaid: false
      });

      await db.collection('riders').doc(currentUser.uid).update({
        totalJobs: firebase.firestore.FieldValue.increment(1),
        totalIncome: firebase.firestore.FieldValue.increment(fin.riderShare + fin.tip)
      });

      showToast('✅ ส่งสำเร็จ!');
      closeModal();
      stopGPS();
    } catch (err) {
      showToast('ไม่สำเร็จ: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '✅ ยืนยัน';
    }
  });
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

  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 รายละเอียดงาน</h2>
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-weight:900;font-size:15px;margin-bottom:8px">${esc(job.title || 'งาน')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);line-height:1.9">
        <div>👤 ลูกค้า: <b>${esc(job.userName || '—')}</b></div>
        <div>📞 เบอร์: <b>${esc(job.userPhone || '—')}</b></div>
        <div>📍 ${esc(job.address || job.destination || '—')}</div>
        <div>🕐 ${fmtDateTime(job.createdAt)}</div>
      </div>
    </div>
    ${job.note ? `<div style="background:var(--orange-light);border-left:4px solid var(--orange);padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:12px;color:#E65100;font-weight:700">📌 ${esc(job.note)}</div>` : ''}
    <div style="background:var(--green-light);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0">
        <span>💰 ค่าบริการ</span><span style="font-weight:900">฿${fmt(fin.fare)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0;color:var(--green)">
        <span>คุณได้รับ (80%)</span><span style="font-weight:900">฿${fmt(fin.totalRider)}</span>
      </div>
    </div>
    <div class="job-actions two" style="margin-bottom:10px">
      ${job.userPhone ? `<a href="tel:${esc(job.userPhone)}" class="action-btn-big btn-blue-big ripple" style="text-decoration:none;color:#fff">📞 โทรหา</a>` : ''}
      ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="action-btn-big btn-orange-big ripple" style="text-decoration:none;color:#fff">📍 นำทาง</a>` : ''}
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
      <div>👤 <strong>${esc(job.userName || 'ลูกค้า')}</strong></div>
      <div>📞 <strong>${esc(job.userPhone || '—')}</strong></div>
      <div>📍 ${esc(job.address || job.destination || '—')}</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
        💰 ค่าบริการ: <strong style="color:var(--brand);font-size:18px">฿${fmt(fin.fare)}</strong>
      </div>
      <div style="font-size:11px;color:var(--green);font-weight:800;margin-top:4px">
        คุณจะได้ ${fin.tip > 0 ? '80% + ทิป' : '80%'} = ฿${fmt(fin.totalRider)}
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
  const newStatus = newState ? 'active' : 'inactive';
  try {
    await db.collection('riders').doc(currentUser.uid).update({
      status: newStatus,
      lastToggle: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(newState ? '🟢 ออนไลน์' : '⚫ ออฟไลน์');
    if (newState) scheduleGPSIfActive();
    else stopGPS();
  } catch (err) { showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error'); }
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
        showToast('📍 ถึงร้านแล้ว — แจ้งลูกค้าเรียบร้อย');
      }
    }

    if (job.status === 'on_the_way' && job.lat && job.lng
      && !nearNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.lat, job.lng) * 1000;
      if (dist <= NEAR_CUSTOMER_RADIUS_M) {
        nearNotifiedOrderIds.add(job.id);
        soundNearCustomer();
        showToast('🔔 ใกล้ถึงลูกค้า 100 ม. — แจ้งเตือนแล้ว');

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
}