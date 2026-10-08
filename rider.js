/* ═══════════════════════════════════════════════════════════════
   🛵 CHAUAT GO RIDER — v3.3.3
   Full JavaScript — Production Ready
   ═══════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════
//  1. FIREBASE CONFIG
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
//  2. GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let riderProfile = null;
let allJobs = [];
let myProfileUnsub = null;
let myJobsUnsub = null;
let activeChatId = null;
let activeChatUnsub = null;
let newJobPopupId = null;
let seenJobIds = new Set();
let audioCtx = null;
let gpsWatchId = null;
let isOnline = false;

// ═══════════════════════════════════════════════════════════════
//  3. HELPERS
// ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
};
const isToday = (t) => {
  if (!t) return false;
  const d = t.toDate ? t.toDate() : new Date(t);
  const now = new Date();
  return d.toDateString() === now.toDateString();
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
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ─── Sound ───
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

// ═══════════════════════════════════════════════════════════════
//  4. AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════════════
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
  const email = $('login-email').value.trim();
  const pw = $('login-password').value;

  if (!email || !pw) return showToast('กรอกอีเมลและรหัสผ่าน', 'error');

  btn.disabled = true;
  btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';

  try {
    logToScreen('🔐 ล็อกอิน: ' + email);
    await auth.signInWithEmailAndPassword(email, pw);
    logToScreen('✅ ล็อกอินสำเร็จ');
  } catch (err) {
    logToScreen('❌ ล็อกอินล้มเหลว: ' + err.code, true);
    const msg = {
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบอีเมลนี้ในระบบ',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป รอ 5 นาที'
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
  const email = $('su-email').value.trim();
  const pw = $('su-password').value;
  const pw2 = $('su-password2').value;

  if (!name) return showToast('กรอกชื่อ', 'error');
  if (phone.replace(/\D/g, '').length < 9) return showToast('เบอร์ไม่ถูกต้อง', 'error');
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

    // สร้าง Document ใน riders
    await db.collection('riders').doc(createdUser.uid).set({
      name,
      phone,
      email,
      vehicle,
      plate,
      verified: false,
      status: 'inactive',
      rating: 0,
      totalRatings: 0,
      totalJobs: 0,
      totalIncome: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // สร้าง Document ใน users (สำหรับ Auth Guard)
    await db.collection('users').doc(createdUser.uid).set({
      role: 'rider',
      name,
      email,
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
    showToast('ส่งไม่สำเร็จ', 'error');
  }
}

async function handleLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeSheet();
  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();
  if (activeChatUnsub) activeChatUnsub();
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  await auth.signOut();
}

// ═══════════════════════════════════════════════════════════════
//  5. AUTH STATE
// ═══════════════════════════════════════════════════════════════
auth.onAuthStateChanged(async (user) => {
  // Reset
  if (myProfileUnsub) myProfileUnsub();
  if (myJobsUnsub) myJobsUnsub();

  if (!user) {
    logToScreen('⛔ ยังไม่ได้ล็อกอิน');
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    return;
  }

  currentUser = user;
  logToScreen('👤 ผู้ใช้: ' + user.email);

  try {
    // ตรวจสอบ Role
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'rider') {
      logToScreen('❌ Role ไม่ใช่ rider', true);
      showToast('บัญชีนี้ไม่ใช่ไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    // ดึงข้อมูล Rider
    const riderDoc = await db.collection('riders').doc(user.uid).get();
    if (!riderDoc.exists) {
      logToScreen('❌ ไม่พบข้อมูลไรเดอร์', true);
      showToast('ไม่พบข้อมูลไรเดอร์', 'error');
      await auth.signOut();
      return;
    }

    riderProfile = { uid: user.uid, ...riderDoc.data() };
    logToScreen('✅ Rider: ' + riderProfile.name + ', verified: ' + riderProfile.verified);

    // แสดง App
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    // เริ่มต้นระบบ
    initApp();
  } catch (err) {
    logToScreen('❌ Auth Error: ' + err.message, true);
    showToast('เกิดข้อผิดพลาด', 'error');
    await auth.signOut();
  }
});

// ═══════════════════════════════════════════════════════════════
//  6. INIT APP
// ═══════════════════════════════════════════════════════════════
function initApp() {
  updateHeader();
  updatePendingBanner();
  subscribeProfile();
  subscribeJobs();
  setupNetworkWatcher();
  setupPWAInstall();
}

// ─── Subscribe Profile ───
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

// ─── Subscribe Jobs ───
function subscribeJobs() {
  if (myJobsUnsub) myJobsUnsub();

  // งานที่ตัวเองรับไว้ + งานที่ยังว่าง
  myJobsUnsub = db.collection('orders')
    .where('status', 'in', ['searching', 'pending', 'accepted', 'picked_up', 'on_the_way', 'done'])
    .orderBy('createdAt', 'desc')
    .limit(100)
    .onSnapshot(snap => {
      const prevIds = seenJobIds;
      allJobs = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt || Date.now())
        };
      });

      // หางานใหม่ที่ควรแจ้งเตือน
      const newJobs = allJobs.filter(j =>
        !prevIds.has(j.id) &&
        j.status === 'searching' &&
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

// ═══════════════════════════════════════════════════════════════
//  7. UI UPDATES
// ═══════════════════════════════════════════════════════════════
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

  isOnline = riderProfile?.status === 'active' && riderProfile?.verified === true;
  btn.classList.toggle('online', isOnline);
  btn.disabled = riderProfile?.verified !== true;
  lbl.textContent = isOnline ? 'ออนไลน์' : 'ออฟไลน์';
  st.textContent = riderProfile?.verified !== true ? '⏳ รอการอนุมัติ' : (isOnline ? '🟢 พร้อมรับงาน' : '⚫ ออฟไลน์');
}

function updateHeroStats() {
  const todayDone = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    j.status === 'done' &&
    isToday(j.createdAt)
  );

  let todayIncome = 0;
  let todayCollected = 0;
  let todayOwe = 0;

  todayDone.forEach(j => {
    const fare = Number(j.fare || 0);
    const myCut = Math.round(fare * 0.80 * 100) / 100;
    const owe = Math.round(fare * 0.20 * 100) / 100;
    todayIncome += myCut;
    todayCollected += Number(j.collected || j.total || 0);
    if (!j.riderPaid) todayOwe += owe;
  });

  $('hero-income').textContent = '฿' + fmt(todayIncome);
  $('hero-sub').textContent = `จาก ${todayDone.length} งานเสร็จสิ้นวันนี้`;
  $('hero-collected').textContent = '฿' + fmt(todayCollected);
  $('hero-owe').textContent = '฿' + fmt(todayOwe);

  const activeCount = allJobs.filter(j =>
    j.riderId === currentUser?.uid &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
  ).length;

  $('stat-done').textContent = todayDone.length;
  $('stat-active').textContent = activeCount;
  $('stat-total').textContent = riderProfile?.totalJobs || 0;
}

// ═══════════════════════════════════════════════════════════════
//  8. RENDER JOBS
// ═══════════════════════════════════════════════════════════════
function renderJobs() {
  const myId = currentUser?.uid;

  // งานใหม่ที่ยังไม่มีคนรับ + Verified + Online
  const newJobs = allJobs.filter(j =>
    j.status === 'searching' &&
    !j.riderId &&
    riderProfile?.verified &&
    isOnline
  );

  // งานที่ตัวเองรับไว้
  const activeJobs = allJobs.filter(j =>
    j.riderId === myId &&
    ['accepted', 'picked_up', 'on_the_way'].includes(j.status)
  );

  // งานที่ตัวเองเสร็จวันนี้
  const doneJobs = allJobs.filter(j =>
    j.riderId === myId &&
    j.status === 'done' &&
    isToday(j.createdAt)
  );

  // แสดง/ซ่อน section
  $('new-job-section').style.display = newJobs.length > 0 ? 'block' : 'none';
  $('active-job-section').style.display = activeJobs.length > 0 ? 'block' : 'none';
  $('done-job-section').style.display = doneJobs.length > 0 ? 'block' : 'none';
  $('empty-state').style.display =
    newJobs.length + activeJobs.length + doneJobs.length === 0 ? 'block' : 'none';

  $('new-count').textContent = newJobs.length;
  $('active-count').textContent = activeJobs.length;
  $('done-count').textContent = doneJobs.length;

  $('new-jobs-list').innerHTML = newJobs.map(j => renderJobCard(j, 'new')).join('');
  $('active-jobs-list').innerHTML = activeJobs.map(j => renderJobCard(j, 'active')).join('');
  $('done-jobs-list').innerHTML = doneJobs.slice(0, 10).map(j => renderJobCard(j, 'done')).join('');
}

function renderJobCard(j, type) {
  const isNew = type === 'new';
  const fare = Number(j.fare || 0);
  const myCut = Math.round(fare * 0.80 * 100) / 100;
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
      <button class="action-btn-big btn-blue-big ripple" data-chat="${esc(j.id)}">💬 แชท</button>
    </div>`;
  } else if (j.status === 'picked_up') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-blue-big ripple" data-ontheway="${esc(j.id)}">🚀 เริ่มส่ง</button>
      <button class="action-btn-big btn-gray-big ripple" data-chat="${esc(j.id)}">💬 แชท</button>
    </div>`;
  } else if (j.status === 'on_the_way') {
    actions = `<div class="job-actions two">
      <button class="action-btn-big btn-green-big ripple" data-deliver="${esc(j.id)}">✅ ส่งสำเร็จ</button>
      <button class="action-btn-big btn-gray-big ripple" data-chat="${esc(j.id)}">💬 แชท</button>
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
          <div class="job-meta">🕐 ${fmtTime(j.createdAt)} • ${statusLabel}</div>
        </div>
      </div>
      <div class="job-price">
        <div>
          <div class="lbl">💰 ค่าบริการ</div>
          <div class="lbl" style="opacity:.8;font-size:10px">คุณได้ 80% = ฿${fmt(myCut)}</div>
        </div>
        <div class="amt">฿${fmt(fare)}</div>
      </div>
      ${actions}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  9. JOB ACTIONS
// ═══════════════════════════════════════════════════════════════
async function acceptJob(jobId) {
  try {
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

  const fare = Number(job.fare || 0);
  const myCut = Math.round(fare * 0.80 * 100) / 100;
  const owe = Math.round(fare * 0.20 * 100) / 100;

  // ⭐ เปิด Modal ให้ไรเดอร์กรอก/อัปโหลดสลิปโอนเงินเข้าร้าน
  openDeliverModal(job, myCut, owe);
}

function openDeliverModal(job, myCut, owe) {
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
        <span style="font-weight:900">฿${fmt(job.fare)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0;color:#00A651">
        <span>คุณได้ (80%)</span>
        <span style="font-weight:900">฿${fmt(myCut)}</span>
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
    <input type="file" id="slip-input" accept="image/*" style="display:none">
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

  // Handle file input
  $('slip-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('รูปใหญ่เกิน 5MB', 'error');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = $('slip-preview');
      preview.src = ev.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Handle confirm
  $('confirm-deliver-btn').addEventListener('click', async () => {
    const file = $('slip-input').files[0];
    const btn = $('confirm-deliver-btn');

    btn.disabled = true;
    btn.textContent = '⏳ กำลังบันทึก...';

    try {
      let slipUrl = null;

      // อัปโหลดสลิปถ้ามี
      if (file) {
        const progress = $('slip-progress');
        const bar = $('slip-progress-bar');
        progress.style.display = 'block';

        const path = `slips/riders/${currentUser.uid}/${job.id}_${Date.now()}.jpg`;
        const ref = storage.ref(path);
        const task = ref.put(file);
        task.on('state_changed', (s) => {
          bar.style.width = (s.bytesTransferred / s.totalBytes * 100) + '%';
        });
        await task;
        slipUrl = await ref.getDownloadURL();
      }

      // อัปเดต Order
      await db.collection('orders').doc(job.id).update({
        status: 'done',
        doneAt: firebase.firestore.FieldValue.serverTimestamp(),
        riderSlipUrl: slipUrl,
        riderSlipPath: slipUrl ? `slips/riders/${currentUser.uid}/${job.id}_${Date.now()}.jpg` : null,
        riderSlipVerified: false,
        riderIncome: myCut,
        riderOwe: owe,
        riderPaid: false
      });

      // อัปเดตสถิติ Rider
      await db.collection('riders').doc(currentUser.uid).update({
        totalJobs: firebase.firestore.FieldValue.increment(1),
        totalIncome: firebase.firestore.FieldValue.increment(myCut)
      });

      showToast('✅ ส่งสำเร็จ!', 'success');
      closeModal();
    } catch (err) {
      logToScreen('❌ Deliver Error: ' + err.message, true);
      showToast('ไม่สำเร็จ: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '✅ ยืนยัน';
    }
  });
}

async function skipJob(jobId) {
  // ไม่ทำอะไร แค่ปิด popup
  closeNewJobPopup();
  showToast('ข้ามงานนี้', 'info');
}

// ═══════════════════════════════════════════════════════════════
//  10. NEW JOB POPUP
// ═══════════════════════════════════════════════════════════════
function showNewJobPopup(job) {
  newJobPopupId = job.id;
  $('new-job-detail').innerHTML = `
    <div>👤 <strong>${esc(job.userName || 'ลูกค้า')}</strong></div>
    <div>📞 <strong>${esc(job.userPhone || '—')}</strong></div>
    <div>📍 ${esc(job.address || job.destination || '—')}</div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ddd">
      💰 ค่าบริการ: <strong style="color:#FF6B35;font-size:18px">฿${fmt(job.fare)}</strong>
    </div>
    <div style="font-size:11px;color:#00A651;font-weight:800;margin-top:4px">
      คุณจะได้ 80% = ฿${fmt(Number(job.fare) * 0.8)}
    </div>
  `;
  $('newJobPopup').classList.add('show');
}

function closeNewJobPopup() {
  $('newJobPopup').classList.remove('show');
  newJobPopupId = null;
}

function acceptFromPopup() {
  if (newJobPopupId) acceptJob(newJobPopupId);
}

// ═══════════════════════════════════════════════════════════════
//  11. ONLINE / OFFLINE
// ═══════════════════════════════════════════════════════════════
async function toggleOnline() {
  if (!currentUser || riderProfile?.verified !== true) {
    return showToast('รอแอดมินอนุมัติก่อน', 'warning');
  }

  const newState = !isOnline;
  try {
    await db.collection('riders').doc(currentUser.uid).update({
      status: newState ? 'active' : 'inactive',
      lastToggle: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(newState ? '🟢 ออนไลน์' : '⚫ ออฟไลน์', 'success');

    if (newState) {
      startGPS();
    } else {
      stopGPS();
    }
  } catch (err) {
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  12. GPS
// ═══════════════════════════════════════════════════════════════
function startGPS() {
  if (!navigator.geolocation) return;
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
}

function stopGPS() {
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

function requestGPS() {
  if (!navigator.geolocation) return showToast('ไม่รองรับ GPS', 'error');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      showToast(`📍 ตำแหน่ง: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'success');
    },
    (err) => {
      showToast('ไม่สามารถเข้าถึง GPS', 'error');
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  13. SHEET
// ═══════════════════════════════════════════════════════════════
function openSheet() {
  $('sheetOverlay').classList.add('show');
}
function closeSheet() {
  $('sheetOverlay').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════
//  14. MODAL
// ═══════════════════════════════════════════════════════════════
function closeModal() {
  $('modalOverlay').classList.remove('show');
  $('modalContent').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════
//  15. PROFILE / INCOME / HISTORY
// ═══════════════════════════════════════════════════════════════
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
      <p><b>Rating:</b> ⭐ ${(riderProfile.rating || 0).toFixed(1)}</p>
      <p><b>งานทั้งหมด:</b> ${riderProfile.totalJobs || 0} งาน</p>
      <p><b>รายได้รวม:</b> ฿${fmt(riderProfile.totalIncome || 0)}</p>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showIncome() {
  const doneJobs = allJobs.filter(j => j.riderId === currentUser?.uid && j.status === 'done');
  const totalIncome = doneJobs.reduce((s, j) => s + Number(j.riderIncome || j.fare * 0.8 || 0), 0);
  const pendingOwe = doneJobs.filter(j => !j.riderPaid).reduce((s, j) => s + Number(j.riderOwe || j.fare * 0.2 || 0), 0);

  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">💰 รายได้ & GP</h2>
    <div style="background:linear-gradient(135deg,#FF6B35,#E55A2B);color:#fff;border-radius:16px;padding:20px;margin-bottom:16px">
      <div style="font-size:12px;opacity:.9;font-weight:700">รายได้รวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;margin-top:4px">฿${fmt(totalIncome)}</div>
      <div style="font-size:12px;opacity:.9;margin-top:6px;font-weight:700">จาก ${doneJobs.length} งาน</div>
    </div>
    <div style="background:#FFFBEB;border-left:4px solid #E65100;border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;color:#92400e;font-weight:800">GP ค้างโอนให้แอป</div>
      <div style="font-size:24px;font-weight:900;color:#E65100;margin-top:4px">฿${fmt(pendingOwe)}</div>
    </div>
    <button class="action-btn-big btn-gray-big ripple" style="width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

function showHistory() {
  const doneJobs = allJobs.filter(j => j.riderId === currentUser?.uid && j.status === 'done');

  $('modalContent').innerHTML = `
    <h2 style="font-size:18px;font-weight:900;margin-bottom:16px">📋 ประวัติงาน (${doneJobs.length})</h2>
    ${doneJobs.length === 0 ? '<p style="text-align:center;color:#999;padding:20px">ยังไม่มีงาน</p>' :
      doneJobs.slice(0, 30).map(j => `
        <div style="padding:12px 0;border-bottom:1px solid #f0f0f0">
          <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
            <span>${esc(j.title || 'งาน')}</span>
            <span style="color:#00A651">฿${fmt(j.riderIncome || j.fare * 0.8 || 0)}</span>
          </div>
          <div style="font-size:11px;color:#6B7280;font-weight:600;margin-top:4px">
            🕐 ${fmtDate(j.createdAt)} • ${esc(j.userName || '')}
          </div>
        </div>
      `).join('')
    }
    <button class="action-btn-big btn-gray-big ripple" style="margin-top:16px;width:100%" onclick="closeModal()">ปิด</button>
  `;
  $('modalOverlay').classList.add('show');
}

// ═══════════════════════════════════════════════════════════════
//  16. CHAT
// ═══════════════════════════════════════════════════════════════
async function openChat(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;

  const chatId = job.chatId || `chat_${job.merchantId}_${job.riderId || currentUser.uid}`;
  activeChatId = chatId;

  $('chatName').textContent = 'ร้านค้า';
  $('chatSub').textContent = job.title || 'งาน';
  $('chatContainer').classList.add('show');

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(100)
    .onSnapshot(snap => {
      renderChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    const d = m.createdAt?.toDate?.() || new Date();
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
  if (file.size > 5 * 1024 * 1024) return showToast('รูปใหญ่เกิน 5MB', 'error');

  showToast('⏳ กำลังอัปโหลด...', 'info');

  try {
    const path = `chats/${activeChatId}/${Date.now()}.jpg`;
    const ref = storage.ref(path);
    await ref.put(file);
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

// ═══════════════════════════════════════════════════════════════
//  17. NETWORK & PWA
// ═══════════════════════════════════════════════════════════════
function setupNetworkWatcher() {
  window.addEventListener('online', () => {
    $('offlineBar').classList.remove('show');
    showToast('🟢 กลับมาออนไลน์', 'success');
  });
  window.addEventListener('offline', () => {
    $('offlineBar').classList.add('show');
  });
  if (!navigator.onLine) $('offlineBar').classList.add('show');
}

function setupPWAInstall() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    logToScreen('📱 PWA พร้อมติดตั้ง');
  });
}

// ═══════════════════════════════════════════════════════════════
//  18. EVENT DELEGATION
// ═══════════════════════════════════════════════════════════════
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-accept],[data-skip],[data-pickup],[data-ontheway],[data-deliver],[data-chat]');
  if (!t) return;

  if (t.dataset.accept) await acceptJob(t.dataset.accept);
  else if (t.dataset.skip) skipJob(t.dataset.skip);
  else if (t.dataset.pickup) await pickupJob(t.dataset.pickup);
  else if (t.dataset.ontheway) await onTheWayJob(t.dataset.ontheway);
  else if (t.dataset.deliver) await deliverJob(t.dataset.deliver);
  else if (t.dataset.chat) openChat(t.dataset.chat);
});

// Haptic feedback
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .job-card');
  if (btn && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// ═══════════════════════════════════════════════════════════════
//  19. INIT LOG
// ═══════════════════════════════════════════════════════════════
console.log('%c🛵 Chauat Go Rider v3.3.3', 'color:#FF6B35;font-weight:900;font-size:16px');
console.log('%c✓ Real-time Jobs | ✓ GPS | ✓ Chat | ✓ Slip Upload', 'color:#00A651;font-weight:700');