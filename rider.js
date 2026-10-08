/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO RIDER — v3.3.3 (ULTIMATE EDITION)
   Full-featured Production JavaScript
   ═══════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
//  1. FIREBASE CONFIG
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
//  2. GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════
let currentUser = null;
let riderProfile = null;
let allJobs = [];
let allHistory = [];
let myProfileUnsub = null;
let myJobsUnsub = null;
let myHistoryUnsub = null;
let activeChatId = null;
let activeChatUnsub = null;
let newJobPopupId = null;
let seenJobIds = new Set();
let audioCtx = null;
let gpsWatchId = null;
let isOnline = false;
let currentHistoryFilter = 'all';

// ═══════════════════════════════════════════════════════════════════
//  3. CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const RIDER_SHARE = 0.80;       // ไรเดอร์ได้ 80%
const PLATFORM_SHARE = 0.20;    // แอปได้ 20%
const MAX_SLIP_SIZE = 5 * 1024 * 1024; // 5MB
const JOB_TIMEOUT_MINUTES = 30; // งานค้างเกิน 30 นาที เตือน

const ACHIEVEMENTS = {
  firstJob: { icon: '🥇', name: 'งานแรก', desc: 'ทำงานสำเร็จ 1 งาน' },
  tenJobs: { icon: '🔥', name: 'ขยัน', desc: 'ทำงานสำเร็จ 10 งาน' },
  fiftyJobs: { icon: '💪', name: 'มืออาชีพ', desc: 'ทำงานสำเร็จ 50 งาน' },
  hundredJobs: { icon: '🏆', name: 'ตำนาน', desc: 'ทำงานสำเร็จ 100 งาน' },
  fiveStar: { icon: '⭐', name: 'ไรเดอร์ 5 ดาว', desc: 'ได้ Rating 5 ดาว' }
};

// ═══════════════════════════════════════════════════════════════════
//  4. HELPERS
// ═══════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const jsStr = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const fmtTime = (t) => {
  if (!t) return '—';
  const d = t.toDate ? t.toDate() : new Date(t);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

const fmtDate = (t) => {
  if (!t) return '—';
  const d = t.toDate ? t.toDate() : new Date(t);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
};

const fmtDateTime = (t) => `${fmtDate(t)} ${fmtTime(t)}`;

const toDate = (t) => {
  if (!t) return null;
  const d = t.toDate ? t.toDate() : new Date(t);
  return isNaN(d) ? null : d;
};

const isToday = (t) => {
  const d = toDate(t);
  if (!d) return false;
  const now = new Date();
  return d.toDateString() === now.toDateString();
};

const isThisWeek = (t) => {
  const d = toDate(t);
  if (!d) return false;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return d >= weekAgo;
};

const isThisMonth = (t) => {
  const d = toDate(t);
  if (!d) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
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

// ─── Debug Console ───
function logToScreen(msg, isError = false) {
  const el = $('debugConsole');
  if (el) {
    el.classList.add('show');
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${esc(msg)}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}

// ─── Toast ───
function showToast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ─── Sound & Vibration ───
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [880, 1108, 1318, 1108].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(f, audioCtx.currentTime + i * 0.18);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.18 + 0.18);
      o.start(audioCtx.currentTime + i * 0.18);
      o.stop(audioCtx.currentTime + i * 0.18 + 0.18);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
  } catch (e) {}
}

// ─── Image Compression ───
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

// ─── Compute Rider Cut ───
function computeCut(fare) {
  fare = Number(fare || 0);
  return {
    fare,
    rider: Math.round(fare * RIDER_SHARE * 100) / 100,
    platform: Math.round(fare * PLATFORM_SHARE * 100) / 100
  };
}

// ═══════════════════════════════════════════════════════════════════
//  5. AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-signup').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
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
    logToScreen('🔐 ล็อกอิน: ' + email);
    await auth.signInWithEmailAndPassword(email, pw);
    logToScreen('✅ ล็อกอินสำเร็จ');
    $('login-error').textContent = '';
  } catch (err) {
    logToScreen('❌ ล็อกอินล้มเหลว: ' + err.code, true);
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

    // บันทึกใน riders
    await db.collection('riders').doc(createdUser.uid).set({
      riderId: createdUser.uid,
      name, phone, email, vehicle, plate,
      verified: false,
      status: 'inactive',
      rating: 0, totalRatings: 0,
      totalJobs: 0, totalIncome: 0,
      achievements: [],
      gpsConsent: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // บันทึกใน users (สำหรับ Auth Guard)
    await db.collection('users').doc(createdUser.uid).set({
      role: 'rider',
      name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ', 'success');
  } catch (err) {
    logToScreen('❌ Signup Error: ' + err.code, true);
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
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว', 'success');
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
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  allJobs = [];
  allHistory = [];
  seenJobIds.clear();
  await auth.signOut();
}

// ═══════════════════════════════════════════════════════════════════
//  6. AUTH STATE
// ═══════════════════════════════════════════════════════════════════
auth.onAuthStateChanged(async (user) => {
  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();
  if (myHistoryUnsub) myHistoryUnsub();

  if (!user) {
    logToScreen('⛔ ยังไม่ได้ล็อกอิน');
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    return;
  }

  currentUser = user;
  logToScreen('👤 ผู้ใช้: ' + user.email);

  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'rider') {
      logToScreen('❌ Role ไม่ใช่ rider', true);
      showToast('บัญชีนี้ไม่ใช่ไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    const riderDoc = await db.collection('riders').doc(user.uid).get();
    if (!riderDoc.exists) {
      logToScreen('❌ ไม่พบข้อมูลไรเดอร์', true);
      showToast('ไม่พบข้อมูลไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    riderProfile = { uid: user.uid, ...riderDoc.data() };
    logToScreen('✅ Rider: ' + riderProfile.name + ' | verified: ' + riderProfile.verified);

    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    initApp();
  } catch (err) {
    logToScreen('❌ Auth Error: ' + err.message, true);
    showToast('เกิดข้อผิดพลาด', 'error');
    await auth.signOut();
  }
});

// ═══════════════════════════════════════════════════════════════════
//  7. INIT APP
// ═══════════════════════════════════════════════════════════════════
function initApp() {
  updateHeader();
  updatePendingBanner();
  subscribeProfile();
  subscribeJobs();
  subscribeHistory();
  setupNetworkWatcher();
  setupPWAInstall();
  setupPullToRefresh();
  requestNotificationPermission();
}

// ─── Subscribe: Profile ───
function subscribeProfile() {
  if (myProfileUnsub) myProfileUnsub();
  myProfileUnsub = db.collection('riders').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prevVerified = riderProfile?.verified;
    riderProfile = { uid: currentUser.uid, ...snap.data() };

    if (prevVerified === false && riderProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว!', 'success');
      playNotificationSound();
    }

    updateHeader();
    updatePendingBanner();
    updateOnlineToggle();
    updateHeroStats();
  });
}

// ─── Subscribe: Jobs ───
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
        return {
          id: d.id,
          ...data,
          createdAt: toDate(data.createdAt)
        };
      });

      // แจ้งเตือนงานใหม่
      const newJobs = allJobs.filter(j =>
        !prevIds.has(j.id) &&
        j.status === 'searching' &&
        !j.riderId &&
        riderProfile?.verified === true &&
        isOnline
      );

      if (newJobs.length > 0 && prevIds.size > 0) {
        playNotificationSound();
        showNewJobPopup(newJobs[0]);
      }

      seenJobIds = new Set(allJobs.map(j => j.id));
      renderJobs();
      updateHeroStats();
    }, err => {
      logToScreen('❌ Jobs: ' + err.code, true);
    });
}

// ─── Subscribe: History ───
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
    }, err => {
      logToScreen('❌ History: ' + err.code, true);
    });
}

// ─── Notification Permission ───
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  8. UI UPDATES
// ═══════════════════════════════════════════════════════════════════
function updateHeader() {
  if (!riderProfile) return;
  $('rider-name').textContent = riderProfile.name || 'ไรเดอร์';
  $('rider-id-header').textContent = 'ID: ' + (currentUser?.uid || '').slice(0, 12) + '...';
  $('sheet-rider-email').textContent = riderProfile.email || '';
  updateOnlineToggle();
}

function updatePendingBanner() {
  const banner = $('pending-banner');
  const isVerified = riderProfile?.verified === true;
  banner.classList.toggle('show', !isVerified);
}

function updateOnlineToggle() {
  const btn = $('online-toggle-btn');
  const lbl = $('toggle-label');
  const st = $('rider-status');

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
  const week = allHistory.filter(j => isThisWeek(j.doneAt || j.createdAt));
  const month = allHistory.filter(j => isThisMonth(j.doneAt || j.createdAt));

  const todayIncome = today.reduce((s, j) => s + Number(j.riderIncome || 0), 0);
  const todayCollected = today.reduce((s, j) => s + Number(j.collected || j.total || 0), 0);
  const todayOwe = today.filter(j => !j.riderPaid).reduce((s, j) => s + Number(j.riderOwe || 0), 0);

  $('hero-income').textContent = '฿' + fmt(todayIncome);
  $('hero-sub').textContent = `จาก ${today.length} งานเสร็จสิ้นวันนี้`;
  $('hero-collected').textContent = '฿' + fmt(todayCollected);
  $('hero-owe').textContent = '฿' + fmt(todayOwe);

  // Stats mini
  const activeCount = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
  ).length;

  $('stat-done').textContent = today.length;
  $('stat-active').textContent = activeCount;
  $('stat-total').textContent = riderProfile?.totalJobs || allHistory.length;

  // Update weekly/monthly (ถ้ามี element)
  const weekEl = $('stat-week-income');
  if (weekEl) weekEl.textContent = '฿' + fmt(week.reduce((s, j) => s + Number(j.riderIncome || 0), 0));
  const monthEl = $('stat-month-income');
  if (monthEl) monthEl.textContent = '฿' + fmt(month.reduce((s, j) => s + Number(j.riderIncome || 0), 0));
}

// ═══════════════════════════════════════════════════════════════════
//  9. RENDER JOBS
// ═══════════════════════════════════════════════════════════════════
function renderJobs() {
  const myId = currentUser?.uid;

  const newJobs = allJobs.filter(j =>
    j.status === 'searching' &&
    !j.riderId &&
    riderProfile?.verified &&
    isOnline
  );

  const activeJobs = allJobs.filter(j =>
    j.riderId === myId &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
  );

  const doneTodayJobs = allHistory.filter(j => isToday(j.doneAt || j.createdAt));

  // Show/hide sections
  $('new-job-section').style.display = newJobs.length > 0 ? 'block' : 'none';
  $('active-job-section').style.display = activeJobs.length > 0 ? 'block' : 'none';
  $('done-job-section').style.display = doneTodayJobs.length > 0 ? 'block' : 'none';
  $('empty-state').style.display =
    newJobs.length + activeJobs.length + doneTodayJobs.length === 0 ? 'block' : 'none';

  $('new-count').textContent = newJobs.length;
  $('active-count').textContent = activeJobs.length;
  $('done-count').textContent = doneTodayJobs.length;

  $('new-jobs-list').innerHTML = newJobs.map(j => renderJobCard(j, 'new')).join('');
  $('active-jobs-list').innerHTML = activeJobs.map(j => renderJobCard(j, 'active')).join('');
  $('done-jobs-list').innerHTML = doneTodayJobs.slice(0, 10).map(j => renderJobCard(j, 'done')).join('');
}

function renderJobCard(j, type) {
  const isNew = type === 'new';
  const cut = computeCut(j.fare);
  const statusLabel = {
    searching: '🔔 ใหม่',
    accepted: '🛵 รับแล้ว',
    picked_up: '📦 รับของ',
    on_the_way: '🚀 กำลังส่ง',
    done: '✅ เสร็จ'
  }[j.status] || j.status;

  let actions = '';
  if (isNew) {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-green-big ripple" data-accept="${esc(j.id)}">✅ รับงาน</button>
      <button class="action-btn-big btn-gray-big ripple" data-skip="${esc(j.id)}">⏭️ ข้าม</button>
    </div>`;
  } else if (j.status === 'accepted') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-orange-big ripple" data-pickup="${esc(j.id)}">📦 รับของแล้ว</button>
      <button class="action-btn-big btn-blue-big ripple" data-detail="${esc(j.id)}">📍 นำทาง</button>
    </div>`;
  } else if (j.status === 'picked_up') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-blue-big ripple" data-ontheway="${esc(j.id)}">🚀 เริ่มส่ง</button>
      <button class="action-btn-big btn-gray-big ripple" data-detail="${esc(j.id)}">📍 นำทาง</button>
    </div>`;
  } else if (j.status === 'on_the_way') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-green-big ripple" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="action-btn-big btn-gray-big ripple" data-detail="${esc(j.id)}">📍 นำทาง</button>
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
        </div>
      </div>
      <div class="job-price">
        <div>
          <div class="lbl">💰 ค่าบริการ</div>
          <div class="lbl" style="opacity:.8;font-size:10px">คุณได้ 80% = ฿${fmt(cut.rider)}</div>
        </div>
        <div class="amt">฿${fmt(cut.fare)}</div>
      </div>
      ${actions}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  10. JOB ACTIONS
// ═══════════════════════════════════════════════════════════════════
async function acceptJob(jobId) {
  try {
    // ตรวจสอบว่ามีคนรับไปแล้วหรือยัง
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
    showToast('✅ รับงานแล้ว!', 'success');
    closeNewJobPopup();
  } catch (err) {
    logToScreen('❌ Accept: ' + err.message, true);
    showToast('รับงานไม่สำเร็จ', 'error');
  }
}

async function pickupJob(jobId) {
  try {
    await db.collection('orders').doc(jobId).update({
      status: 'picked_up',
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('📦 รับของแล้ว', 'success');
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
    showToast('🚀 เริ่มส่ง', 'success');
  } catch (err) {
    showToast('ไม่สำเร็จ', 'error');
  }
}

async function deliverJob(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;
  const cut = computeCut(job.fare);
  openDeliverModal(job, cut);
}

// ═══════════════════════════════════════════════════════════════════
//  11. DELIVER MODAL (Slip Upload)
// ═══════════════════════════════════════════════════════════════════
function openDeliverModal(job, cut) {
  const modal = $('modalContent');
  modal.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:48px">✅</div>
      <h2 style="font-size:20px;font-weight:900;margin-top:8px">ยืนยันส่งสำเร็จ</h2>
      <p style="color:#6B7280;font-size:13px;font-weight:600;margin-top:4px">กรุณาแนบสลิปโอนเงินให้ร้านค้า</p>
    </div>

    <div style="background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0">
        <span>ค่าบริการทั้งหมด</span>
        <span style="font-weight:900">฿${fmt(cut.fare)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#00A651">
        <span>คุณได้ (80%)</span>
        <span style="font-weight:900">฿${fmt(cut.rider)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#E65100;border-top:1px dashed #ddd;margin-top:6px;padding-top:8px">
        <span>ต้องโอนร้าน (80% ของค่าอาหาร)</span>
        <span style="font-weight:900">฿${fmt(Number(job.foodTotal || job.fare) * 0.80)}</span>
      </div>
    </div>

    <div class="slip-upload-box" onclick="$('slip-input').click()">
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

  // Preview รูป
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

  // Confirm
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

        // Compress image
        const compressedBlob = await compressImage(file, 1000, 0.8);

        slipPath = `slips/riders/${currentUser.uid}/${job.id}_${Date.now()}.jpg`;
        const ref = storage.ref(slipPath);
        const task = ref.put(compressedBlob);
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
        riderIncome: cut.rider,
        riderOwe: cut.platform,
        riderPaid: false
      });

      // Update rider stats + achievements
      await updateRiderStats(cut.rider);

      showToast('✅ ส่งสำเร็จ!', 'success');
      closeModal();

      // Check achievements
      checkAchievements();
    } catch (err) {
      logToScreen('❌ Deliver: ' + err.message, true);
      showToast('ไม่สำเร็จ: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '✅ ยืนยัน';
    }
  });
}

async function updateRiderStats(income) {
  try {
    await db.collection('riders').doc(currentUser.uid).update({
      totalJobs: firebase.firestore.FieldValue.increment(1),
      totalIncome: firebase.firestore.FieldValue.increment(income)
    });
  } catch (err) {
    console.warn('Update stats failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  12. JOB DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════
function showJobDetail(jobId) {
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;

  const cut = computeCut(job.fare);
  const mapUrl = job.lat && job.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
    : (job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null);

  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 รายละเอียดงาน</h2>

    <div style="background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-weight:900;font-size:15px;margin-bottom:8px">${esc(job.title || 'งาน')}</div>
      <div style="font-size:13px;font-weight:700;color:#6B7280;line-height:1.8">
        <div>👤 ลูกค้า: <b>${esc(job.userName || '—')}</b></div>
        <div>📞 เบอร์: <b>${esc(job.userPhone || '—')}</b></div>
        <div>📍 ${esc(job.address || job.destination || '—')}</div>
        <div>🕐 ${fmtDateTime(job.createdAt)}</div>
      </div>
    </div>

    ${job.note ? `<div style="background:#FFFDE7;border-left:4px solid #FFA500;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:12px;color:#5D4037;font-weight:700">
      📌 ${esc(job.note)}
    </div>` : ''}

    <div style="background:linear-gradient(135deg,#FFF8E1,#FFECB3);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0">
        <span>💰 ค่าบริการ</span>
        <span style="font-weight:900">฿${fmt(cut.fare)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:4px 0;color:#00A651">
        <span>คุณได้รับ (80%)</span>
        <span style="font-weight:900">฿${fmt(cut.rider)}</span>
      </div>
    </div>

    <div class="job-actions two" style="margin-bottom:10px">
      ${job.userPhone ? `<a href="tel:${esc(job.userPhone)}" class="action-btn-big btn-blue-big ripple" style="text-decoration:none">📞 โทรหา</a>` : ''}
      ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="action-btn-big btn-orange-big ripple" style="text-decoration:none">📍 นำทาง</a>` : ''}
    </div>

    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

// ═══════════════════════════════════════════════════════════════════
//  13. NEW JOB POPUP
// ═══════════════════════════════════════════════════════════════════
function showNewJobPopup(job) {
  newJobPopupId = job.id;
  const cut = computeCut(job.fare);

  $('new-job-detail').innerHTML = `
    <div>👤 <strong>${esc(job.userName || 'ลูกค้า')}</strong></div>
    <div>📞 <strong>${esc(job.userPhone || '—')}</strong></div>
    <div>📍 ${esc(job.address || job.destination || '—')}</div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ddd">
      💰 ค่าบริการ: <strong style="color:#FF6B35;font-size:18px">฿${fmt(cut.fare)}</strong>
    </div>
    <div style="font-size:11px;color:#00A651;font-weight:800;margin-top:4px">
      คุณจะได้ 80% = ฿${fmt(cut.rider)}
    </div>
  `;
  $('newJobPopup').classList.add('show');

  // Push notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('🔔 งานใหม่!', {
        body: `${job.userName || 'ลูกค้า'} - ฿${fmt(cut.fare)}`,
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

async function skipJob(jobId) {
  closeNewJobPopup();
  showToast('ข้ามงานนี้', 'info');
}

// ═══════════════════════════════════════════════════════════════════
//  14. ONLINE/OFFLINE + GPS
// ═══════════════════════════════════════════════════════════════════
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
    showToast(newState ? '🟢 ออนไลน์' : '⚫ ออฟไลน์', 'success');

    if (newState) {
      startGPS();
    } else {
      stopGPS();
    }
  } catch (err) {
    logToScreen('❌ Toggle: ' + err.message, true);
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

function startGPS() {
  if (!navigator.geolocation) return showToast('ไม่รองรับ GPS', 'error');
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

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
      } catch (err) {
        logToScreen('GPS write: ' + err.code, true);
      }
    },
    (err) => {
      logToScreen('GPS error: ' + err.message, true);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );

  logToScreen('📍 GPS started');
}

function stopGPS() {
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    logToScreen('📍 GPS stopped');
  }
}

function requestGPS() {
  if (!navigator.geolocation) return showToast('ไม่รองรับ GPS', 'error');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      showToast(`📍 ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'success');
    },
    (err) => {
      showToast('ไม่สามารถเข้าถึง GPS', 'error');
    }
  );
}

// ═══════════════════════════════════════════════════════════════════
//  15. SHEET / MODAL
// ═══════════════════════════════════════════════════════════════════
function openSheet() { $('sheetOverlay').classList.add('show'); }
function closeSheet() { $('sheetOverlay').classList.remove('show'); }

function closeModal() {
  $('modalOverlay').classList.remove('show');
  $('modalContent').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════
//  16. PROFILE / INCOME / HISTORY / ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════
function showProfile() {
  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">👤 ข้อมูลส่วนตัว</h2>
    <div style="line-height:2;font-size:14px">
      <p><b>ชื่อ:</b> ${esc(riderProfile.name)}</p>
      <p><b>เบอร์:</b> ${esc(riderProfile.phone || '—')}</p>
      <p><b>อีเมล:</b> ${esc(riderProfile.email || '—')}</p>
      <p><b>ประเภทยานพาหนะ:</b> ${esc(riderProfile.vehicle || '—')}</p>
      <p><b>ทะเบียน:</b> ${esc(riderProfile.plate || '—')}</p>
      <p><b>สถานะ:</b> ${riderProfile.verified ? '✅ อนุมัติแล้ว' : '⏳ รออนุมัติ'}</p>
      <p><b>Rating:</b> ⭐ ${(riderProfile.rating || 0).toFixed(1)} (${riderProfile.totalRatings || 0} รีวิว)</p>
      <p><b>งานทั้งหมด:</b> ${riderProfile.totalJobs || 0} งาน</p>
      <p><b>รายได้รวม:</b> ฿${fmt(riderProfile.totalIncome || 0)}</p>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showIncome() {
  const today = allHistory.filter(j => isToday(j.doneAt || j.createdAt));
  const week = allHistory.filter(j => isThisWeek(j.doneAt || j.createdAt));
  const month = allHistory.filter(j => isThisMonth(j.doneAt || j.createdAt));
  const all = allHistory;

  const sum = (arr) => arr.reduce((s, j) => s + Number(j.riderIncome || 0), 0);
  const pendingOwe = all.filter(j => !j.riderPaid).reduce((s, j) => s + Number(j.riderOwe || 0), 0);

  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">💰 รายได้ & GP</h2>

    <div style="background:linear-gradient(135deg,#FF6B35,#E55A2B);color:#fff;border-radius:16px;padding:20px;margin-bottom:12px">
      <div style="font-size:12px;opacity:.9;font-weight:700">รายได้วันนี้ (80%)</div>
      <div style="font-size:36px;font-weight:900;margin-top:4px">฿${fmt(sum(today))}</div>
      <div style="font-size:12px;opacity:.9;margin-top:6px;font-weight:700">จาก ${today.length} งาน</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:#fff;border-radius:12px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.04)">
        <div style="font-size:11px;color:#6B7280;font-weight:800">7 วันล่าสุด</div>
        <div style="font-size:20px;font-weight:900;color:#FF6B35;margin-top:4px">฿${fmt(sum(week))}</div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.04)">
        <div style="font-size:11px;color:#6B7280;font-weight:800">30 วันล่าสุด</div>
        <div style="font-size:20px;font-weight:900;color:#FF6B35;margin-top:4px">฿${fmt(sum(month))}</div>
      </div>
    </div>

    <div style="background:#FFFBEB;border-left:4px solid #E65100;border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-size:12px;color:#92400e;font-weight:800">GP ค้างโอนให้แอป</div>
      <div style="font-size:24px;font-weight:900;color:#E65100;margin-top:4px">฿${fmt(pendingOwe)}</div>
      <div style="font-size:11px;color:#92400e;font-weight:600;margin-top:2px">${all.filter(j => !j.riderPaid).length} งาน</div>
    </div>

    <div style="background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0">
        <span>รายได้รวมทั้งหมด</span>
        <span style="font-weight:900">฿${fmt(sum(all))}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0">
        <span>จากงานทั้งหมด</span>
        <span style="font-weight:900">${all.length} งาน</span>
      </div>
    </div>

    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showHistory() {
  const filtered = currentHistoryFilter === 'all' ? allHistory :
    currentHistoryFilter === 'today' ? allHistory.filter(j => isToday(j.doneAt)) :
    currentHistoryFilter === 'week' ? allHistory.filter(j => isThisWeek(j.doneAt)) :
    allHistory.filter(j => isThisMonth(j.doneAt));

  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:12px">📋 ประวัติงาน (${filtered.length})</h2>

    <div class="filter-bar" style="margin-bottom:12px">
      <button class="filter-chip ${currentHistoryFilter === 'all' ? 'active' : ''}" data-history-filter="all">ทั้งหมด</button>
      <button class="filter-chip ${currentHistoryFilter === 'today' ? 'active' : ''}" data-history-filter="today">วันนี้</button>
      <button class="filter-chip ${currentHistoryFilter === 'week' ? 'active' : ''}" data-history-filter="week">7 วัน</button>
      <button class="filter-chip ${currentHistoryFilter === 'month' ? 'active' : ''}" data-history-filter="month">เดือนนี้</button>
    </div>

    <div style="max-height:400px;overflow-y:auto">
    ${filtered.length === 0 ? '<p style="text-align:center;color:#999;padding:20px">ยังไม่มีงาน</p>' :
      filtered.slice(0, 50).map(j => `
        <div style="padding:12px 0;border-bottom:1px solid #f0f0f0;cursor:pointer" data-detail="${esc(j.id)}">
          <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
            <span>${esc(j.title || 'งาน')}</span>
            <span style="color:#00A651">฿${fmt(j.riderIncome || 0)}</span>
          </div>
          <div style="font-size:11px;color:#6B7280;font-weight:600;margin-top:4px">
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

function showAchievements() {
  const earned = riderProfile?.achievements || [];
  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">🏆 ความสำเร็จ</h2>
    ${Object.entries(ACHIEVEMENTS).map(([key, a]) => {
      const isEarned = earned.includes(key);
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:${isEarned ? '#F0FDF4' : '#f8f9fa'};border-radius:12px;margin-bottom:8px;${isEarned ? 'border-left:4px solid #00A651' : 'opacity:.5'}">
          <div style="font-size:32px">${a.icon}</div>
          <div style="flex:1">
            <div style="font-weight:900;font-size:14px">${a.name}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:600">${a.desc}</div>
          </div>
          ${isEarned ? '<span style="color:#00A651;font-weight:900">✅</span>' : ''}
        </div>
      `;
    }).join('')}
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

// ─── Check Achievements ───
async function checkAchievements() {
  try {
    const total = riderProfile?.totalJobs || 0;
    const earned = new Set(riderProfile?.achievements || []);
    const newOnes = [];

    if (total >= 1 && !earned.has('firstJob')) { earned.add('firstJob'); newOnes.push('firstJob'); }
    if (total >= 10 && !earned.has('tenJobs')) { earned.add('tenJobs'); newOnes.push('tenJobs'); }
    if (total >= 50 && !earned.has('fiftyJobs')) { earned.add('fiftyJobs'); newOnes.push('fiftyJobs'); }
    if (total >= 100 && !earned.has('hundredJobs')) { earned.add('hundredJobs'); newOnes.push('hundredJobs'); }

    if (newOnes.length > 0) {
      await db.collection('riders').doc(currentUser.uid).update({
        achievements: [...earned]
      });
      newOnes.forEach(key => {
        const a = ACHIEVEMENTS[key];
        setTimeout(() => showToast(`${a.icon} ${a.name}`, 'success'), 500);
      });
    }
  } catch (err) {
    console.warn('Achievements error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  17. CHAT SYSTEM
// ═══════════════════════════════════════════════════════════════════
async function openChatWithMerchant(jobId) {
  const job = allJobs.find(j => j.id === jobId) || allHistory.find(j => j.id === jobId);
  if (!job) return;

  const chatId = job.chatId || `chat_${[job.merchantId, currentUser.uid].sort().join('_')}`;
  activeChatId = chatId;

  // สร้าง chat document ถ้าไม่มี
  try {
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      await chatRef.set({
        participantIds: [currentUser.uid, job.merchantId].filter(Boolean),
        participants: [
          { uid: currentUser.uid, name: riderProfile.name, role: 'rider' },
          { uid: job.merchantId, name: job.merchantName || 'ร้านค้า', role: 'merchant' }
        ],
        type: 'rider_merchant',
        lastMessage: 'เริ่มสนทนา',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    console.warn('Chat init error:', err);
  }

  $('chatName').textContent = job.merchantName || 'ร้านค้า';
  $('chatSub').textContent = job.title || 'งาน';
  $('chatContainer').classList.add('show');

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(100)
    .onSnapshot(snap => {
      renderChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => {
      logToScreen('❌ Chat: ' + err.code, true);
    });
}

function closeChat() {
  $('chatContainer').classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function renderChatMessages(msgs) {
  const el = $('chatMessages');
  if (msgs.length === 0) {
    el.innerHTML = '<div class="chat-empty">เริ่มสนทนา</div>';
    return;
  }
  let lastDay = '';
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === currentUser.uid || m.senderRole === 'rider';
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) { dayDiv = `<div class="chat-day-divider">${day}</div>`; lastDay = day; }
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
  const text = $('chatInput').value.trim();
  if (!text || !activeChatId) return;
  $('chatInput').value = '';
  $('chatInput').style.height = 'auto';

  try {
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text,
      senderId: currentUser.uid,
      senderRole: 'rider',
      senderName: riderProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: `[ไรเดอร์] ${text}`,
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
      lastMessage: '[ไรเดอร์] 📷 รูปภาพ',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งรูปแล้ว', 'success');
  } catch (err) {
    showToast('อัปโหลดไม่สำเร็จ', 'error');
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ═══════════════════════════════════════════════════════════════════
//  18. NETWORK & PWA
// ═══════════════════════════════════════════════════════════════════
function setupNetworkWatcher() {
  window.addEventListener('online', () => {
    $('offlineBar')?.classList.remove('show');
    showToast('🟢 กลับมาออนไลน์', 'success');
  });
  window.addEventListener('offline', () => {
    $('offlineBar')?.classList.add('show');
  });
  if (!navigator.onLine) $('offlineBar')?.classList.add('show');
}

function setupPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    logToScreen('📱 PWA พร้อมติดตั้ง');
  });
}

// ─── Pull to Refresh ───
function setupPullToRefresh() {
  let startY = 0;
  let pullDist = 0;
  const threshold = 80;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (window.scrollY === 0 && startY) {
      pullDist = e.touches[0].clientY - startY;
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (pullDist > threshold) {
      showToast('🔄 กำลังรีเฟรช...', 'info');
      setTimeout(() => location.reload(), 500);
    }
    pullDist = 0;
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════════
//  19. EVENT DELEGATION
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-skip],[data-pickup],[data-ontheway],[data-deliver],[data-detail],[data-chat],[data-history-filter]');
  if (!t) return;

  try {
    if (t.dataset.accept) await acceptJob(t.dataset.accept);
    else if (t.dataset.skip) skipJob(t.dataset.skip);
    else if (t.dataset.pickup) await pickupJob(t.dataset.pickup);
    else if (t.dataset.ontheway) await onTheWayJob(t.dataset.ontheway);
    else if (t.dataset.deliver) await deliverJob(t.dataset.deliver);
    else if (t.dataset.detail) showJobDetail(t.dataset.detail);
    else if (t.dataset.chat) openChatWithMerchant(t.dataset.chat);
    else if (t.dataset.historyFilter) {
      currentHistoryFilter = t.dataset.historyFilter;
      showHistory();
    }
  } catch (err) {
    logToScreen('❌ Action: ' + err.message, true);
  }
});

// Haptic
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .job-card');
  if (btn && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// ═══════════════════════════════════════════════════════════════════
//  20. INIT LOG
// ═══════════════════════════════════════════════════════════════════
console.log('%c🛵 Chauat Go Rider v3.4.0 (ULTIMATE)', 'color:#FF6B35;font-weight:900;font-size:16px');
console.log('%c✓ Jobs | ✓ GPS | ✓ Chat | ✓ Slip | ✓ Wallet | ✓ Achievements', 'color:#00A651;font-weight:700');