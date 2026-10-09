/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO RIDER — v3.4.7.1
   Full-featured Production JavaScript
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
let mapPickerMap = null;
let isOnline = false;
let currentHistoryFilter = 'all';
let cameraFile = null;
let nearNotifiedOrderIds = new Set();
let arrivedShopNotifiedOrderIds = new Set();

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
const GPS_UPDATE_INTERVAL = 10000;

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
  if (!d) return '—';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

const fmtDate = (t) => {
  const d = toDate(t);
  if (!d) return '—';
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
};

const fmtDateTime = (t) => `${fmtDate(t)} ${fmtTime(t)}`;

const isToday = (t) => {
  const d = toDate(t);
  if (!d) return false;
  return d.toDateString() === new Date().toDateString();
};

const timeAgo = (t) => {
  const d = toDate(t);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'เมื่อกี้';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(diff / 86400)} วันที่แล้ว`;
};

const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const debugLog = (msg, isError) => {
  if (typeof window.CHAUAT_RIDER_DEBUG !== 'undefined' && window.CHAUAT_RIDER_DEBUG) {
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
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return null; }
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
   9. FINANCE CALC
   ═══════════════════════════════════════════════════════════════════ */
function calcServiceFee(distanceKm) {
  const base = SERVICE_BASE;
  const extraKm = Math.max(0, distanceKm - FREE_KM);
  const extra = Math.ceil(extraKm * SERVICE_PER_KM);
  return base + extra;
}

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
    isCash,
    totalCustomerPay: fare + foodAmount + tip
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
      'auth/user-not-found': 'ไม่พบอีเมลนี้ในระบบ',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป รอ 5 นาที',
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
      verified: false,
      status: 'inactive',
      rating: 0, totalRatings: 0,
      totalJobs: 0, totalIncome: 0,
      trustScore: 100,
      gpsConsent: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('users').doc(createdUser.uid).set({
      role: 'rider',
      name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ');
  } catch (err) {
    if (createdUser) {
      try { await createdUser.delete(); } catch (e) {}
    }
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
  } catch (err) {
    showToast('ส่งไม่สำเร็จ: ' + err.message, 'error');
  }
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
    .where('status', 'in', ['searching', 'pending', 'accepted', 'picked_up', 'on_the_way'])
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
        j.status === 'searching' &&
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
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
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
   ═══════════════════════════════════════════════════════════════════ */
function renderJobs() {
  const myId = currentUser?.uid;

  const newJobs = allJobs.filter(j =>
    j.status === 'searching' && !j.riderId &&
    riderProfile?.verified && isOnline
  );

  const activeJobs = allJobs.filter(j =>
    j.riderId === myId &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
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
  const statusLabel = {
    searching: '🔔 ใหม่', accepted: '🛵 รับแล้ว',
    picked_up: '📦 รับของ', on_the_way: '🚀 กำลังส่ง', done: '✅ เสร็จ'
  }[j.status] || j.status;

  const cashBadge = fin.isCash
    ? `<div class="cash-badge">💵 เงินสด • ต้องมี ฿${fmt(fin.foodAmount)}</div>`
    : `<div class="cash-badge" style="background:var(--blue-light);color:#1976D2">💳 โอน • ลูกค้าจ่าย ฿${fmt(fin.totalCustomerPay)}</div>`;

  let actions = '';
  if (isNew) {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-green-big ripple" data-accept="${esc(j.id)}">✅ รับงาน</button>
      <button class="action-btn-big btn-gray-big ripple" data-skip="${esc(j.id)}">⏭️ ข้าม</button>
    </div>`;
  } else if (j.status === 'accepted') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-orange-big ripple" data-arrived="${esc(j.id)}">📍 ถึงร้าน</button>
      <button class="action-btn-big btn-blue-big ripple" data-detail="${esc(j.id)}">📋 รายละเอียด</button>
    </div>`;
  } else if (j.status === 'picked_up') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-blue-big ripple" data-ontheway="${esc(j.id)}">🚀 เริ่มส่ง</button>
      <button class="action-btn-big btn-gray-big ripple" data-chat="${esc(j.id)}">💬 แชท</button>
    </div>`;
  } else if (j.status === 'on_the_way') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-green-big ripple" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="action-btn-big btn-blue-big ripple" data-chat="${esc(j.id)}">💬 แชท</button>
    </div>`;
  } else if (j.status === 'done') {
    actions = `<div class="job-actions">
      <button class="action-btn-big btn-gray-big ripple" data-detail="${esc(j.id)}">📄 ดูรายละเอียด</button>
    </div>`;
  }

  return `
    <div class="job-card status-${j.status} ${isNew ? 'is-new' : ''}">
      <div class="job-top">
        <div class="job-emoji">🛵</div>
        <div class="job-info">
          <div class="job-title">${esc(j.title || 'งานใหม่')}</div>
          <div class="job-meta">👤 ${esc(j.userName || 'ลูกค้า')}</div>
          <div class="job-meta">📍 ${esc((j.address || j.destination || '').slice(0, 60))}</div>
          <div class="job-meta">🕐 ${timeAgo(j.createdAt)} • ${statusLabel}</div>
          ${cashBadge}
        </div>
      </div>
      <div class="job-price">
        <div>
          <div class="lbl">💰 ค่าบริการ</div>
          <div class="lbl" style="opacity:.8;font-size:10px">คุณได้ 80% = ฿${fmt(fin.riderShare)}${fin.tip > 0 ? ` + ทิป ฿${fin.tip}` : ''}</div>
        </div>
        <div class="amt">฿${fmt(fin.totalRider)}</div>
      </div>
      ${actions}
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
    showToast('รับงานไม่สำเร็จ', 'error');
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

    // แจ้งร้านค้าผ่าน order
    const jobSnap = await db.collection('orders').doc(jobId).get();
    if (jobSnap.exists && jobSnap.data().merchantId) {
      await db.collection('orders').doc(jobId).update({
        merchantNotifiedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
}

async function onTheWayJob(jobId) {
  try {
    await db.collection('orders').doc(jobId).update({
      status: 'on_the_way',
      onTheWayAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🚀 เริ่มส่ง');
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
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
   20. ONLINE/OFFLINE + GPS
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
  } catch (err) {
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

function scheduleGPSIfActive() {
  const hasActive = allJobs.some(j =>
    j.riderId === currentUser?.uid &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
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
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
  );

  for (const job of myActive) {
    // ถึงร้าน
    if (job.status === 'accepted' && job.shopPlaceLat && job.shopPlaceLng
      && !arrivedShopNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.shopPlaceLat, job.shopPlaceLng) * 1000;
      if (dist <= ARRIVAL_RADIUS_M) {
        arrivedShopNotifiedOrderIds.add(job.id);
        soundArrivedShop();
        showToast('📍 ถึงร้านแล้ว — แจ้งลูกค้าเรียบร้อย');
      }
    }

    // ใกล้ถึงลูกค้า
    if (job.status === 'on_the_way' && job.lat && job.lng
      && !nearNotifiedOrderIds.has(job.id)) {
      const dist = haversine(myLat, myLng, job.lat, job.lng) * 1000;
      if (dist <= NEAR_CUSTOMER_RADIUS_M) {
        nearNotifiedOrderIds.add(job.id);
        soundNearCustomer();
        showToast('🔔 ใกล้ถึงลูกค้า 100 ม. — แจ้งเตือนแล้ว');

        // บันทึก flag ลง Firestore ให้ลูกค้าเห็น
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
    (pos) => {
      showToast(`📍 ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
    },
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

function showTransferShop() {
  showToast('💡 ระบบโอนร้านค้า — เร็ว ๆ นี้', 'info');
}

function showTransferApp() {
  showToast('💡 ระบบโอน chauatgo — เร็ว ๆ นี้', 'info');
}

function showGPIncome() {
  showToast('💎 GP 2% รอรับจาก chauatgo ทุก 15 วัน', 'info');
}

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
  const filtered = currentHistoryFilter === 'all' ? allHistory : allHistory;
  const mc = $('modalContent');
  if (!mc) return;
  mc.innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 ประวัติงาน (${filtered.length})</h2>
    <div style="max-height:400px;overflow-y:auto">
    ${filtered.length === 0 ? '<p style="text-align:center;color:var(--text-light);padding:20px">ยังไม่มีงาน</p>' :
      filtered.slice(0, 50).map(j => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer" data-detail="${esc(j.id)}">
          <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
            <span>${esc(j.title || 'งาน')}</span>
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
   23. CHAT (Rider ↔ Customer)
   ═══════════════════════════════════════════════════════════════════ */
async function openChatWithCustomer(orderId) {
  const job = allJobs.find(j => j.id === orderId) || allHistory.find(j => j.id === orderId);
  if (!job) return showToast('ไม่พบออเดอร์', 'error');

  activeChatId = orderId;
  activeChatPartnerPhone = job.userPhone || null;
  activeChatPartnerName = job.userName || 'ลูกค้า';

  // สร้าง chat doc ถ้าไม่มี
  try {
    const chatRef = db.collection('chats').doc(orderId);
    const snap = await chatRef.get();
    if (!snap.exists) {
      await chatRef.set({
        orderId: orderId,
        userId: job.userId,
        userName: job.userName || 'ลูกค้า',
        riderId: currentUser.uid,
        riderName: riderProfile.name,
        lastMessage: '',
        lastSenderId: '',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {}

  const cn = $('chatName'); if (cn) cn.textContent = activeChatPartnerName;
  const cs = $('chatSub'); if (cs) cs.textContent = job.title || 'ออเดอร์';
  $('chatContainer')?.classList.add('show');
  closeModal();

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
      senderRole: 'rider',
      senderName: riderProfile.name,
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
  if (file.size > MAX_SLIP_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
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
      senderRole: 'rider',
      senderName: riderProfile.name,
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
   24. CAMERA (ถ่ายรูปอาหาร)
   ═══════════════════════════════════════════════════════════════════ */
function openCamera() {
  $('cameraModal')?.classList.add('show');
  cameraFile = null;
  const preview = $('cameraPreview');
  if (preview) preview.style.display = 'none';
  const placeholder = $('cameraPlaceholder');
  if (placeholder) placeholder.style.display = 'block';
  const sendBtn = $('cameraSendBtn');
  if (sendBtn) sendBtn.style.display = 'none';
}

function closeCamera() {
  $('cameraModal')?.classList.remove('show');
  cameraFile = null;
}

function previewFoodImage(file) {
  if (!file) return;
  cameraFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = $('cameraPreview');
    if (preview) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    }
    const placeholder = $('cameraPlaceholder');
    if (placeholder) placeholder.style.display = 'none';
    const sendBtn = $('cameraSendBtn');
    if (sendBtn) sendBtn.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function sendFoodImage() {
  if (!cameraFile || !activeChatId) {
    showToast('ไม่มีรูป', 'warning');
    return;
  }
  try {
    await sendChatImage(cameraFile);
    closeCamera();
    closeChat();
    showToast('✅ ส่งรูปอาหารให้ลูกค้าแล้ว');
  } catch (err) {
    showToast('ส่งไม่สำเร็จ', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   25. NETWORK & PWA
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
   26. EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-skip],[data-arrived],[data-ontheway],[data-deliver],[data-detail],[data-chat]');
  if (!t) return;

  try {
    if (t.dataset.accept) await acceptJob(t.dataset.accept);
    else if (t.dataset.skip) skipJob(t.dataset.skip);
    else if (t.dataset.arrived) await arrivedAtShop(t.dataset.arrived);
    else if (t.dataset.ontheway) await onTheWayJob(t.dataset.ontheway);
    else if (t.dataset.deliver) await deliverJob(t.dataset.deliver);
    else if (t.dataset.detail) showJobDetail(t.dataset.detail);
    else if (t.dataset.chat) openChatWithCustomer(t.dataset.chat);
  } catch (err) {}
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .job-card');
  if (btn && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════════
   27. INIT
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  runSplash();
});

/* ═══════════════════════════════════════════════════════════════════
   28. EXPOSE GLOBALS
   ═══════════════════════════════════════════════════════════════════ */
window.toggleTheme = toggleTheme;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleForgotPassword = handleForgotPassword;
window.handleLogout = handleLogout;
window.toggleOnline = toggleOnline;
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
window.closeChat = closeChat;
window.callChatPartner = callChatPartner;
window.sendChatText = sendChatText;
window.sendChatImage = sendChatImage;
window.autoResize = autoResize;
window.requestGPS = requestGPS;
window.installPWA = installPWA;
window.dismissPWA = dismissPWA;
window.openCamera = openCamera;
window.closeCamera = closeCamera;
window.previewFoodImage = previewFoodImage;
window.sendFoodImage = sendFoodImage;

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