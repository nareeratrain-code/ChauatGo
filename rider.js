// ═══════════════════════════════════════════════════════════════════
//  🛵 CHAUAT GO RIDER v3.3.3 — Production
// ═══════════════════════════════════════════════════════════════════

// ═══ Force Auto-Update v3.3.3 ═══
(function() {
  const APP_VERSION = 'v3.3.3';
  const savedVersion = localStorage.getItem('chauat_rider_version');
  if (savedVersion && savedVersion !== APP_VERSION) {
    console.log('[Update]', savedVersion, '→', APP_VERSION);
    localStorage.setItem('chauat_rider_version', APP_VERSION);
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('FORCE_UPDATE');
    }
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => location.reload(true));
    } else location.reload(true);
    return;
  }
  localStorage.setItem('chauat_rider_version', APP_VERSION);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then(reg => {
          setInterval(() => reg.update(), 30000);
          reg.update();
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (!newSW) return;
            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                newSW.postMessage('SKIP_WAITING');
                setTimeout(() => location.reload(true), 500);
              }
            });
          });
        }).catch(err => console.warn('[SW]', err));
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'SW_UPDATED') location.reload(true);
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload(true);
      });
    });
  }
})();

// ═══ Firebase Config ═══
const firebaseConfig = {
  apiKey: "AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM",
  authDomain: "chauat-go-b9841.firebaseapp.com",
  projectId: "chauat-go-b9841",
  storageBucket: "chauat-go-b9841.firebasestorage.app",
  messagingSenderId: "282197694521",
  appId: "1:282197694521:web:0528c22747a0c04bd815e8",
  measurementId: "G-6E2QEFWK6P"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn('[Rider] persistence:', err.code));

// ═══ State ═══
let currentUser = null;
let riderProfile = null;
let allOrders = [];
let unsubscribeOrders = null;
let unsubscribeProfile = null;
let unsubscribeRatings = null;
let unsubscribeDebt = null;
let chatUnsub = null;
let soundEnabled = true;
let currentNewJobId = null;
let currentChatOrderId = null;
let isOnline = false;
let locationUpdateInterval = null;
let myRatings = [];
let currentDebtData = null;
let lastActionTime = 0;
let lastPopupTime = 0;
let activeMaps = {};
let deadlineTimer = null;
let lastDeadlineWarning = 0;
let audioCtx = null;
let deferredPrompt = null;

const DEADLINE_HOUR = 21;
const PLATFORM_FEE_RATE = 0.20;

// ═══ Helpers ═══
const $ = id => document.getElementById(id);
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const jsStr = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

function logToScreen(msg, isError = false) {
  const el = $('debugConsole');
  if (el) {
    el.style.display = 'block';
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#0f0'}">> ${msg}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}
function showToast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 2500);
}
function showError(msg) { $('login-error').textContent = msg || ''; }
function checkRateLimit() {
  const now = Date.now();
  if (now - lastActionTime < 1500) { showToast('⚠️ กรุณารอสักครู่', 'info'); return false; }
  lastActionTime = now;
  return true;
}
function toDate(t) {
  if (!t) return null;
  const d = t.toDate ? t.toDate() : new Date(t);
  return isNaN(d) ? null : d;
}
function getOrderMapKey(id) {
  return 'map-' + String(id).replace(/[^a-zA-Z0-9]/g, '_');
}

// ═══ Auth State ═══
auth.onAuthStateChanged(async user => {
  if (!user) { showLogin(); return; }
  logToScreen(`🔐 ผู้ใช้: ${user.email}`, false);

  try {
    const snap = await db.collection('riders').doc(user.uid).get();
    if (!snap.exists) {
      logToScreen('❌ ไม่พบใน riders', true);
      await auth.signOut();
      showError('❌ ไม่พบข้อมูลไรเดอร์ — กรุณาสมัครใหม่');
      showLogin();
      switchAuthTab('signup');
      return;
    }
    riderProfile = { uid: user.uid, ...snap.data() };
    logToScreen(`✅ Rider: ${riderProfile.name}, verified: ${riderProfile.verified}`);
  } catch (e) {
    logToScreen('❌ Error: ' + e.message, true);
    await auth.signOut();
    showError('⚠️ ตรวจสอบสิทธิ์ไม่สำเร็จ');
    showLogin();
    return;
  }

  currentUser = user;
  isOnline = riderProfile.status === 'available' && riderProfile.verified === true;
  $('rider-name').textContent = riderProfile.name || 'ไรเดอร์';
  $('rider-id-header').textContent = '🆔 ' + (user.uid || '').slice(0, 12) + '...';
  updatePendingBanner();
  updateOnlineUI();
  updateHeaderBadge();
  showApp();
  listenOrders();
  listenProfile();
  listenRatings();
  listenDebt();
  startDeadlineCountdown();

  if (isOnline) setTimeout(startLocationTracking, 1000);

  window.addEventListener('beforeunload', () => {
    stopLocationTracking();
    if (currentUser && isOnline) {
      db.collection('riders').doc(currentUser.uid).update({ status: 'offline' }).catch(() => {});
    }
  });
});

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-signup').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
  $('login-subtitle').textContent = isLogin ? 'สำหรับไรเดอร์เท่านั้น' : 'สมัครใหม่ — รอการอนุมัติจากแอดมิน';
  $('login-hint').innerHTML = isLogin
    ? '🔐 หลังสมัครแล้ว แอดมินจะต้องอนุมัติก่อน<br>จึงจะเริ่มรับงานได้'
    : '⚠️ กรอกข้อมูลให้ครบถ้วน<br>หลังสมัครแล้วจะรอแอดมินอนุมัติ';
  showError('');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('login-submit');
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  showError('');
  btn.disabled = true; btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  try {
    await auth.signInWithEmailAndPassword(email, password);
    showToast('✅ เข้าสู่ระบบสำเร็จ', 'success');
  } catch (err) {
    logToScreen('❌ Login: ' + err.code, true);
    showError(mapAuthError(err.code));
    btn.disabled = false; btn.textContent = '🔓 เข้าสู่ระบบ';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('signup-submit');
  const name = $('su-name').value.trim();
  const phone = $('su-phone').value.trim();
  const vehicle = $('su-vehicle').value.trim();
  const email = $('su-email').value.trim();
  const pw1 = $('su-password').value;
  const pw2 = $('su-password2').value;

  showError('');
  if (name.length < 2) return showError('⚠️ กรุณากรอกชื่อ-นามสกุล');
  if (phone.replace(/\D/g,'').length < 9) return showError('⚠️ เบอร์โทรต้องมีอย่างน้อย 9 หลัก');
  if (!vehicle) return showError('⚠️ กรุณากรอกข้อมูลรถ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('⚠️ อีเมลไม่ถูกต้อง');
  if (pw1.length < 6) return showError('⚠️ รหัสผ่านอย่างน้อย 6 ตัวอักษร');
  if (pw1 !== pw2) return showError('⚠️ รหัสผ่านทั้ง 2 ช่องไม่ตรงกัน');
  if (!$('gps-consent').checked) return showError('⚠️ กรุณายอมรับนโยบาย GPS ก่อนสมัคร');

  btn.disabled = true; btn.textContent = '⏳ กำลังสมัคร...';
  let createdUser = null;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw1);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: name });

    await db.collection('riders').doc(createdUser.uid).set({
      riderId: createdUser.uid,
      name, phone, vehicle, email,
      status: 'offline', verified: false,
      rating: 0, totalRatings: 0, ratingSum: 0,
      rating5: 0, rating4: 0, rating3: 0, rating2: 0, rating1: 0,
      totalTrips: 0,
      gpsConsent: true,
      gpsConsentAt: firebase.firestore.FieldValue.serverTimestamp(),
      gpsConsentVersion: '1.0',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      registeredVia: 'rider.html'
    });
    logToScreen('✅ สมัครสำเร็จ: ' + email);
    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ', 'success');
  } catch (err) {
    logToScreen('❌ Signup: ' + err.code, true);
    if (createdUser && (err.code === 'permission-denied' || err.message?.includes('firestore'))) {
      try { await createdUser.delete(); } catch (e) {}
      showError('❌ สร้างข้อมูลไรเดอร์ไม่สำเร็จ — ลองใหม่');
    } else {
      showError(mapAuthError(err.code));
    }
    btn.disabled = false; btn.textContent = '✅ สมัครเป็นไรเดอร์';
  }
}

async function handleForgot() {
  const email = $('login-email').value.trim();
  if (!email) return showToast('⚠️ กรอกอีเมลก่อน', 'warning');
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว', 'success');
  } catch (e) { showToast('❌ ส่งไม่สำเร็จ', 'error'); }
}

function mapAuthError(code) {
  return ({
    'auth/user-not-found': 'ไม่พบอีเมลนี้ในระบบ',
    'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
    'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง',
    'auth/email-already-in-use': 'อีเมลนี้ถูกใช้แล้ว — ลองเข้าสู่ระบบ',
    'auth/weak-password': 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร',
    'auth/too-many-requests': 'พยายามหลายครั้งเกินไป',
    'auth/network-request-failed': 'ไม่มีการเชื่อมต่อเครือข่าย'
  })[code] || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

function showLogin() {
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
  const b = $('login-submit');
  b.disabled = false; b.textContent = '🔓 เข้าสู่ระบบ';
  const s = $('signup-submit');
  s.disabled = false; s.textContent = '✅ สมัครเป็นไรเดอร์';
}
function showApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
}

// ═══ Online / GPS ═══
function updatePendingBanner() {
  const banner = $('pending-banner');
  const emptyMsg = $('empty-msg');
  const isVerified = riderProfile?.verified === true;
  banner.classList.toggle('show', !isVerified);
  if (emptyMsg) emptyMsg.textContent = isVerified ? 'เปิดสถานะ "ออนไลน์" เพื่อรับงานใหม่' : 'รอแอดมินอนุมัติก่อน';
}

async function toggleOnline() {
  if (!currentUser) return;
  if (riderProfile?.verified !== true) { showToast('⏳ รอแอดมินอนุมัติก่อน', 'error'); return; }

  const btn = $('online-btn');
  const lbl = $('online-label');
  const originalLabel = lbl.textContent;
  lbl.textContent = '⏳ กำลังหาพิกัด...';
  btn.disabled = true;

  try {
    if (!isOnline) {
      if (!navigator.geolocation) {
        lbl.textContent = originalLabel; btn.disabled = false;
        showToast('⚠️ เบราว์เซอร์ไม่รองรับ GPS', 'error');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async pos => {
          try {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            await db.collection('riders').doc(currentUser.uid).update({
              status: 'available', riderLat: lat, riderLng: lng,
              lastLocationUpdate: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('rider_locations').doc(currentUser.uid).set({
              name: riderProfile.name || 'ไรเดอร์', status: 'available', lat, lng,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            isOnline = true;
            updateOnlineUI();
            startLocationTracking();
            playBeep();
            showToast('✅ เปิดรับงานแล้ว', 'success');
          } catch (e) {
            logToScreen('❌ Open online: ' + e.message, true);
            lbl.textContent = originalLabel; btn.disabled = false;
            showToast('❌ เปิดออนไลน์ไม่สำเร็จ', 'error');
          }
        },
        err => {
          lbl.textContent = originalLabel; btn.disabled = false;
          const msg = { 1: '⚠️ กรุณาอนุญาต GPS', 2: '⚠️ ตำแหน่งใช้ไม่ได้', 3: '⏱️ หมดเวลา' }[err.code] || '⚠️ เข้าถึง GPS ไม่ได้';
          showToast(msg, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    } else {
      await db.collection('riders').doc(currentUser.uid).update({
        status: 'offline', lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        riderLat: firebase.firestore.FieldValue.delete(),
        riderLng: firebase.firestore.FieldValue.delete(),
        lastLocationUpdate: firebase.firestore.FieldValue.delete()
      });
      await db.collection('rider_locations').doc(currentUser.uid).set({
        name: riderProfile.name || 'ไรเดอร์', status: 'offline',
        lat: firebase.firestore.FieldValue.delete(),
        lng: firebase.firestore.FieldValue.delete(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      isOnline = false;
      updateOnlineUI();
      stopLocationTracking();
      showToast('⏸️ ปิดรับงาน — ลบพิกัดแล้ว', 'info');
    }
  } catch (e) {
    logToScreen('❌ Toggle online: ' + e.message, true);
    lbl.textContent = originalLabel; btn.disabled = false;
    showToast('❌ เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

function updateOnlineUI() {
  const btn = $('online-btn');
  const lbl = $('online-label');
  const st = $('rider-status');
  const isVerified = riderProfile?.verified === true;
  btn.classList.toggle('online', isOnline && isVerified);
  btn.disabled = !isVerified;
  lbl.textContent = !isVerified ? 'รออนุมัติ' : (isOnline ? 'ออนไลน์' : 'ออฟไลน์');
  st.textContent = !isVerified ? '⏳ รอการอนุมัติ' : (isOnline ? '🟢 พร้อมรับงาน' : '⚫ ปิดรับงาน');
}

function startLocationTracking() {
  if (!navigator.geolocation) return;
  stopLocationTracking();
  const updateLoc = () => {
    if (!currentUser || !isOnline) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        db.collection('riders').doc(currentUser.uid).update({
          riderLat: lat, riderLng: lng,
          lastLocationUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => logToScreen('GPS riders: ' + err.message, true));
        db.collection('rider_locations').doc(currentUser.uid).set({
          name: riderProfile?.name || 'ไรเดอร์', status: 'available', lat, lng,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => logToScreen('GPS loc: ' + err.message, true));
      },
      err => console.warn('[GPS]', err.code),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };
  updateLoc();
  locationUpdateInterval = setInterval(updateLoc, 20000);
}

function stopLocationTracking() {
  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }
  if (currentUser) {
    db.collection('rider_locations').doc(currentUser.uid).set({
      name: riderProfile?.name || '', status: 'offline',
      lat: firebase.firestore.FieldValue.delete(),
      lng: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
}

// ═══ Listeners ═══
function listenProfile() {
  if (unsubscribeProfile) unsubscribeProfile();
  unsubscribeProfile = db.collection('riders').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const oldVerified = riderProfile?.verified;
    riderProfile = { uid: currentUser.uid, ...snap.data() };
    if (oldVerified === false && riderProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว! เปิดรับงานได้เลย', 'success');
      playBeep();
    }
    updatePendingBanner();
    updateOnlineUI();
    updateHeaderBadge();
  });
}

function listenOrders() {
  if (unsubscribeOrders) unsubscribeOrders();
  unsubscribeOrders = db.collection('orders').where('riderId', '==', currentUser.uid).onSnapshot(snap => {
    const prevIds = new Set(allOrders.map(o => o.id));
    allOrders = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, ...x, createdAt: toDate(x.createdAt) || new Date() };
    }).sort((a,b) => b.createdAt - a.createdAt);

    const newPending = allOrders.find(o => o.status === 'pending' && !prevIds.has(o.id) && prevIds.size > 0);
    if (newPending && !currentNewJobId && riderProfile?.verified === true && (Date.now() - lastPopupTime > 3000)) {
      lastPopupTime = Date.now();
      if (soundEnabled) playBeep();
      showNewJobPopup(newPending);
    }
    render();
    updateHeroAndActions();
  }, err => {
    logToScreen('Orders: ' + err.code, true);
    if (err.code === 'failed-precondition') showToast('⚠️ ต้องสร้าง Index (riderId + createdAt)', 'error');
  });
}

function listenRatings() {
  if (unsubscribeRatings) unsubscribeRatings();
  if (!currentUser) return;
  unsubscribeRatings = db.collection('ratings').where('riderId', '==', currentUser.uid).orderBy('createdAt', 'desc').limit(50).onSnapshot(snap => {
    myRatings = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || new Date() }));
    updateRatingBox();
  }, err => console.warn('[ratings]', err));
}

function listenDebt() {
  if (unsubscribeDebt) unsubscribeDebt();
  if (!currentUser) return;
  unsubscribeDebt = db.collection('rider_debts').doc(currentUser.uid).onSnapshot(snap => {
    if (snap.exists) {
      currentDebtData = snap.data();
      if (currentDebtData.suspended === true && !window._suspendedShown) {
        window._suspendedShown = true;
        showToast(`🚫 บัญชีถูกระงับ: ${currentDebtData.suspendedReason || 'มียอดค้างจ่าย'}`, 'error');
        if (isOnline) toggleOnline();
      }
      if (currentDebtData.suspended === false) window._suspendedShown = false;
    }
    updateHeroAndActions();
  }, err => console.warn('[debt listener]', err));
}

// ═══ Deadline 21:00 ═══
function startDeadlineCountdown() {
  if (deadlineTimer) clearInterval(deadlineTimer);
  updateDeadline();
  deadlineTimer = setInterval(updateDeadline, 1000);
}

function updateDeadline() {
  const strip = $('deadline-strip');
  if (!strip) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const todaysOrders = allOrders.filter(o => o.status === 'done' && o.createdAt >= today);
  const amountOwed = todaysOrders.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.appEarning ?? (Math.round(fare * PLATFORM_FEE_RATE * 100) / 100));
  }, 0);

  if (amountOwed <= 0) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';

  const now = new Date();
  const deadline = new Date();
  deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
  if (now >= deadline) deadline.setDate(deadline.getDate() + 1);

  const diffMs = deadline - now;
  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const timeStr = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  $('deadline-time').textContent = timeStr;

  strip.classList.remove('urgent', 'warning', 'safe');
  let icon = '⏰', note = 'โปรดโอนเพื่อไม่ให้บัญชีถูกระงับ';

  if (hours < 1) {
    strip.classList.add('urgent');
    icon = '🚨';
    note = '⚠️ เร่งด่วนมาก! โอนทันที';
  } else if (hours < 3) {
    strip.classList.add('warning');
    icon = '⚠️';
    note = 'ใกล้ deadline — โอนภายในวันนี้';
  } else {
    strip.classList.add('safe');
  }

  $('deadline-icon').textContent = icon;
  $('deadline-note').textContent = note;

  if (hours < 1) {
    const totalMin = Math.floor(totalSec / 60);
    if ([60, 30, 15].includes(totalMin) && lastDeadlineWarning !== totalMin) {
      lastDeadlineWarning = totalMin;
      playBeep();
      showToast(`🚨 อีก ${totalMin} นาทีถึง deadline โอนเงิน!`, 'error');
    }
  }
}

// ═══ Hero + Actions ═══
function updateHeroAndActions() {
  const today = new Date(); today.setHours(0,0,0,0);
  const doneToday = allOrders.filter(o => o.status === 'done' && o.createdAt >= today);
  const activeJobs = allOrders.filter(o => ['accepted','picked_up','on_the_way'].includes(o.status));
  const newJobs = allOrders.filter(o => o.status === 'pending');

  const riderEarning = doneToday.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.riderEarning ?? (Math.round(fare * (1 - PLATFORM_FEE_RATE) * 100) / 100));
  }, 0);

  const totalCollected = doneToday.reduce((s, o) => s + Number(o.total || 0), 0);

  const amountOwed = doneToday.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.appEarning ?? (Math.round(fare * PLATFORM_FEE_RATE * 100) / 100));
  }, 0);

  $('hero-earn').textContent = '฿' + riderEarning.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('hero-sub').textContent = `จาก ${doneToday.length} งานเสร็จสิ้นวันนี้`;
  $('hero-collected').textContent = '฿' + totalCollected.toLocaleString('th-TH', { maximumFractionDigits: 0 });
  $('hero-owed').textContent = '฿' + amountOwed.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  $('stat-done').textContent = doneToday.length;
  $('stat-active').textContent = activeJobs.length;
  $('stat-total').textContent = riderProfile?.totalTrips || 0;

  const actionItems = [];

  if (amountOwed > 0) {
    const now = new Date();
    const deadline = new Date();
    deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
    if (now >= deadline) deadline.setDate(deadline.getDate() + 1);
    const hoursLeft = (deadline - now) / 1000 / 3600;

    let cardClass = 'warn', btnClass = 'orange', btnText = 'โอนเงิน →';
    if (hoursLeft < 1) { cardClass = 'danger'; btnClass = 'red'; btnText = '🚨 โอนทันที!'; }
    else if (hoursLeft < 3) { cardClass = 'warn'; btnClass = 'orange'; btnText = '⚠️ โอนเลย →'; }

    actionItems.push(`
      <div class="action-card ${cardClass} ripple" onclick="showDebtDetail()">
        <div class="action-icon">💰</div>
        <div class="action-info">
          <div class="action-title">ต้องโอนให้แอป (20%)</div>
          <div class="action-value">฿${amountOwed.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="action-sub">ภายใน 21:00 น. — จาก ${doneToday.length} งาน</div>
        </div>
        <button class="action-btn ${btnClass}">${btnText}</button>
      </div>
    `);
  }

  if (newJobs.length > 0) {
    actionItems.push(`
      <div class="action-card orange ripple" onclick="scrollToSection('new-jobs')">
        <div class="action-icon">🔔</div>
        <div class="action-info">
          <div class="action-title">มีงานใหม่รอรับ</div>
          <div class="action-value">${newJobs.length} งาน</div>
          <div class="action-sub">กดเพื่อดูรายละเอียด</div>
        </div>
        <button class="action-btn orange">ดูงาน →</button>
      </div>
    `);
  }

  if (activeJobs.length > 0) {
    actionItems.push(`
      <div class="action-card blue ripple" onclick="scrollToSection('active-jobs')">
        <div class="action-icon">🛵</div>
        <div class="action-info">
          <div class="action-title">งานที่กำลังทำ</div>
          <div class="action-value">${activeJobs.length} งาน</div>
          <div class="action-sub">อัปเดตสถานะและนำทาง</div>
        </div>
        <button class="action-btn blue">ไปที่งาน →</button>
      </div>
    `);
  }

  if (!isOnline && riderProfile?.verified === true) {
    actionItems.push(`
      <div class="action-card green ripple" onclick="toggleOnline()">
        <div class="action-icon">⚫</div>
        <div class="action-info">
          <div class="action-title">คุณกำลังออฟไลน์</div>
          <div class="action-value">เปิดรับงาน</div>
          <div class="action-sub">แตะเพื่อเปิดออนไลน์</div>
        </div>
        <button class="action-btn green">เปิดเลย →</button>
      </div>
    `);
  }

  if (actionItems.length === 0) {
    if (isOnline) {
      actionItems.push(`
        <div class="action-card green" style="text-align:center;flex-direction:column;gap:6px;padding:24px">
          <div style="font-size:48px">✅</div>
          <div class="action-title" style="font-size:15px">ทุกอย่างเรียบร้อย!</div>
          <div class="action-sub">รอรับงานใหม่ — ไม่มียอดค้าง</div>
        </div>
      `);
    } else {
      actionItems.push(`
        <div class="action-card orange">
          <div class="action-icon">💤</div>
          <div class="action-info">
            <div class="action-title">ยังไม่พร้อมรับงาน</div>
            <div class="action-sub">เปิดออนไลน์เพื่อเริ่มรับงาน</div>
          </div>
        </div>
      `);
    }
  }

  $('action-cards').innerHTML = actionItems.join('');
  updateDeadline();
}

function scrollToSection(id) {
  const el = $(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══ Render ═══
function render() {
  const today = new Date(); today.setHours(0,0,0,0);
  const newJobs = allOrders.filter(o => o.status === 'pending');
  const activeJobs = allOrders.filter(o => ['accepted','picked_up','on_the_way'].includes(o.status));
  const doneJobs = allOrders.filter(o => o.status === 'done' && o.createdAt >= today).slice(0, 10);

  $('cnt-new').textContent = newJobs.length;
  $('cnt-active').textContent = activeJobs.length;
  $('cnt-done').textContent = doneJobs.length;

  $('new-jobs').innerHTML = newJobs.map(o => renderCard(o, 'new')).join('');
  $('active-jobs').innerHTML = activeJobs.map(o => renderCard(o, 'active')).join('');
  $('done-jobs').innerHTML = doneJobs.map(o => renderCard(o, 'done')).join('');
  $('empty-all').style.display = allOrders.length > 0 ? 'none' : 'block';

  setTimeout(initMiniMaps, 200);
}

function renderCard(o, group) {
  const time = o.createdAt.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
  const date = o.createdAt.toLocaleDateString('th-TH', {day:'2-digit', month:'short'});
  const items = String(o.items || '');
  const custPhone = o.userPhone || '';
  const shopPhone = o.shopPhone || o.merchantPhone || '';
  const distStr = o.distance ? Number(o.distance).toFixed(1) + ' กม.' : '—';
  const statusIcon = { pending:'🔔', accepted:'🛵', picked_up:'📦', on_the_way:'🚀', done:'✅' }[o.status] || '📦';
  const typeIcon = { food:'🍽️', shopping:'🛒', dinein:'🍴', express:'📦', map:'🗺️' }[o.type] || '📦';

  let actionBtns = '', quickActions = '', miniMapHtml = '';
  const mapKey = getOrderMapKey(o.id);

  const hasGps = o.pickupLat && o.pickupLng && o.dropoffLat && o.dropoffLng;
  if (group === 'active' && hasGps) {
    miniMapHtml = `<div class="mini-map-container" id="${mapKey}-container"><div class="map-loading" id="${mapKey}-loader">กำลังโหลดแผนที่...</div><div id="${mapKey}" style="width:100%;height:100%"></div></div>`;
  }

  if (['accepted','picked_up','on_the_way'].includes(o.status)) {
    const shopQuery = encodeURIComponent(o.pickupAddress || o.title || 'ร้านค้า');
    const homeQuery = encodeURIComponent(o.address || 'ปลายทาง');

    quickActions = `
      <div class="nav-buttons-row">
        <a href="https://www.google.com/maps/search/?api=1&query=${shopQuery}" target="_blank" class="nav-btn-small btn-nav-shop ripple">🏪 ไปรับของ</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${homeQuery}" target="_blank" class="nav-btn-small btn-nav-home ripple">🏠 ส่งถึงบ้าน</a>
      </div>
      <div class="quick-actions">
        ${custPhone ? `<a href="tel:${escHtml(custPhone)}" class="quick-btn ripple">📞 โทรลูกค้า</a>` : `<button class="quick-btn" disabled>📞 ไม่มีเบอร์</button>`}
        ${shopPhone ? `<a href="tel:${escHtml(shopPhone)}" class="quick-btn ripple">🏪 โทรหาร้าน</a>` : `<button class="quick-btn" disabled>🏪 ไม่มีเบอร์ร้าน</button>`}
        <button class="quick-btn ripple" onclick="openChat('${jsStr(o.id)}')">💬 แชทลูกค้า</button>
        <button class="quick-btn ripple" style="color:#E53935;background:#FFEBEE" onclick="openReportIssue('${jsStr(o.id)}')">⚠️ แจ้งปัญหา</button>
      </div>
    `;
  }

  if (group === 'new') {
    actionBtns = `<div class="actions-grid two">
      <button class="action-btn-big btn-green-big ripple" onclick="acceptOrder('${jsStr(o.id)}')">✅ รับงาน</button>
      <button class="action-btn-big btn-gray-big ripple" onclick="rejectOrder('${jsStr(o.id)}')">✕ ปฏิเสธ</button>
    </div>`;
  } else if (o.status === 'accepted') {
    actionBtns = `<button class="action-btn-big btn-orange-big ripple" onclick="updateStatus('${jsStr(o.id)}','picked_up')">📦 รับของแล้ว — ไปส่ง</button>`;
  } else if (o.status === 'picked_up') {
    actionBtns = `<button class="action-btn-big btn-blue-big ripple" onclick="updateStatus('${jsStr(o.id)}','on_the_way')">🛵 กำลังเดินทาง</button>`;
  } else if (o.status === 'on_the_way') {
    actionBtns = `<button class="action-btn-big btn-green-big ripple" onclick="updateStatus('${jsStr(o.id)}','done')">✅ ส่งสำเร็จ — เก็บเงินแล้ว</button>`;
  }

  return `<div class="order-card ${o.status} ${group === 'new' ? 'is-new' : ''}">
    <div class="card-head">
      <div class="card-icon">${statusIcon}</div>
      <div class="card-title">
        <h3>${typeIcon} ${escHtml(o.title || '—')}</h3>
        <div class="sub">${date} • ${time}</div>
      </div>
      ${group === 'new' ? '<span class="card-badge">ใหม่</span>' : ''}
    </div>
    ${miniMapHtml}
    <div class="info-row"><div class="ico">👤</div><div class="txt"><strong>${escHtml(o.userName || 'ลูกค้า')}</strong></div></div>
    <div class="info-row"><div class="ico">🏠</div><div class="txt">${escHtml(o.address || '—')}</div></div>
    <div class="info-row"><div class="ico">📏</div><div class="txt">ระยะทาง <strong>${distStr}</strong></div></div>
    ${o.note ? `<div class="info-row"><div class="ico">📌</div><div class="txt">${escHtml(o.note)}</div></div>` : ''}
    <div class="items-box"><strong>รายการ</strong>${escHtml(items)}</div>
    <div class="money-row">
      <div class="lbl">💰 เก็บเงินจากลูกค้า</div>
      <div class="amt">${Number(o.total || 0)}฿</div>
    </div>
    ${actionBtns}
    ${quickActions}
  </div>`;
}

// ═══ Order Actions ═══
async function acceptOrder(orderId) {
  if (!checkRateLimit()) return;
  await updateOrder(orderId, {
    status: 'accepted',
    acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, '✅ รับงานแล้ว — ไปที่ร้าน');
  if (currentUser) {
    db.collection('rider_locations').doc(currentUser.uid).set({
      status: 'busy', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
}

async function rejectOrder(orderId) {
  if (!checkRateLimit()) return;
  if (!confirm('ปฏิเสธงานนี้?\nงานจะถูกส่งคืนให้แอดมินมอบหมายใหม่')) return;
  await updateOrder(orderId, {
    status: 'searching',
    riderId: firebase.firestore.FieldValue.delete(),
    rider: firebase.firestore.FieldValue.delete(),
    rejectedBy: currentUser.uid,
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, '↩️ ส่งคืนงานแล้ว');
}

async function updateStatus(orderId, newStatus) {
  if (!checkRateLimit()) return;
  const updates = { status: newStatus };
  if (newStatus === 'picked_up') updates.pickedUpAt = firebase.firestore.FieldValue.serverTimestamp();
  if (newStatus === 'on_the_way') updates.onTheWayAt = firebase.firestore.FieldValue.serverTimestamp();
  if (newStatus === 'done') updates.deliveredAt = firebase.firestore.FieldValue.serverTimestamp();

  const successMsg = {
    picked_up: '📦 อัพเดตแล้ว — กำลังไปส่ง',
    on_the_way: '🛵 กำลังเดินทาง',
    done: '🎉 ส่งสำเร็จ!'
  }[newStatus] || '✅ อัพเดตแล้ว';

  await updateOrder(orderId, updates, successMsg);

  if (newStatus === 'done' && currentUser && isOnline) {
    db.collection('rider_locations').doc(currentUser.uid).set({
      status: 'available', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
}

async function updateOrder(orderId, updates, successMsg) {
  try {
    await db.collection('orders').doc(orderId).update(updates);
    showToast(successMsg || '✅ สำเร็จ', 'success');
    closeNewJobPopup();
  } catch (e) {
    logToScreen('Update order: ' + e.message, true);
    showToast(e.code === 'permission-denied' ? '❌ ไม่มีสิทธิ์แก้ไข' : '❌ อัพเดตไม่สำเร็จ', 'error');
  }
}

// ═══ New Job Popup ═══
function showNewJobPopup(o) {
  currentNewJobId = o.id;
  const distStr = o.distance ? Number(o.distance).toFixed(1) + ' กม.' : '—';
  $('new-job-detail').innerHTML = `
    <div>🏪 <strong>${escHtml(o.title || '—')}</strong></div>
    <div>👤 ${escHtml(o.userName || 'ลูกค้า')}</div>
    <div>🏠 ${escHtml((o.address||'').slice(0, 60))}</div>
    <div>📏 ${distStr}</div>
    <div style="margin-top:10px;color:#FF6B35;font-weight:900;font-size:18px">💰 ${Number(o.total||0)}฿</div>
  `;
  $('new-job-popup').classList.add('active');
}
function closeNewJobPopup() {
  $('new-job-popup').classList.remove('active');
  currentNewJobId = null;
}
function acceptNewJob() {
  if (!currentNewJobId) return;
  acceptOrder(currentNewJobId);
}

// ═══ Sound ═══
function playBeep() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [880, 1100, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.15);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.15);
      osc.start(audioCtx.currentTime + i * 0.15);
      osc.stop(audioCtx.currentTime + i * 0.15 + 0.15);
    });
  } catch (e) {}
}

// ═══ Mini Maps ═══
function initMiniMaps() {
  document.querySelectorAll('.mini-map-container').forEach(container => {
    const containerId = container.id;
    const mapKey = containerId.replace('-container', '');

    const order = allOrders.find(o => getOrderMapKey(o.id) === mapKey);
    if (!order || !order.pickupLat || !order.pickupLng || !order.dropoffLat || !order.dropoffLng) return;
    if (activeMaps[mapKey]) return;

    try {
      const loader = $(`${mapKey}-loader`);
      const mapEl = $(mapKey);
      if (!mapEl) return;

      const map = L.map(mapKey, {
        zoomControl: false, dragging: true, scrollWheelZoom: false, attributionControl: false
      }).setView([order.pickupLat, order.pickupLng], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

      const pickupIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,.3)'>🏪</div>",
        iconSize: [30, 30], iconAnchor: [15, 30]
      });
      const dropoffIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,.3)'>🏠</div>",
        iconSize: [30, 30], iconAnchor: [15, 30]
      });

      L.marker([order.pickupLat, order.pickupLng], { icon: pickupIcon }).addTo(map);
      L.marker([order.dropoffLat, order.dropoffLng], { icon: dropoffIcon }).addTo(map);

      const bounds = [[order.pickupLat, order.pickupLng], [order.dropoffLat, order.dropoffLng]];
      map.fitBounds(bounds, { padding: [30, 30] });
      L.polyline(bounds, { color: '#FF6B35', weight: 3, dashArray: '5, 10' }).addTo(map);

      if (loader) loader.remove();
      activeMaps[mapKey] = map;
    } catch (e) {
      logToScreen(`Map ${mapKey}: ${e.message}`, true);
    }
  });
}

function destroyAllMaps() {
  Object.keys(activeMaps).forEach(id => {
    try { activeMaps[id].remove(); } catch (e) {}
  });
  activeMaps = {};
}

// ═══ Menu & Modal ═══
function openMenu() { $('menu-sheet').classList.add('active'); }
function closeMenu() { $('menu-sheet').classList.remove('active'); }
function closeModal() {
  $('modal').classList.remove('active');
  if (chatUnsub) { try { chatUnsub(); } catch (e) {} chatUnsub = null; }
  currentChatOrderId = null;
}

function showMyInfo() {
  closeMenu();
  const verified = riderProfile.verified ? '✅ อนุมัติแล้ว' : '⏳ รอการอนุมัติ';
  alert(`👤 ${riderProfile.name || 'ไรเดอร์'}\n📧 ${currentUser.email}\n📱 ${riderProfile.phone || '-'}\n🛵 ${riderProfile.vehicle || '-'}\n⭐ ${(riderProfile.rating || 0).toFixed(1)} (${riderProfile.totalRatings || 0} รีวิว)\n📦 ${riderProfile.totalTrips || 0} เที่ยว\n🔐 สถานะ: ${verified}`);
}

function openEditProfile() {
  closeMenu();
  $('modal-body').innerHTML = `
    <div class="modal-inner">
      <h2 style="font-size:20px;font-weight:900;margin-bottom:16px">✏️ แก้ไขโปรไฟล์</h2>
      <div class="form-field"><label>👤 ชื่อ-นามสกุล</label><input type="text" id="ep-name" value="${escHtml(riderProfile.name||'')}"></div>
      <div class="form-field"><label>📱 เบอร์โทรศัพท์</label><input type="tel" id="ep-phone" value="${escHtml(riderProfile.phone||'')}"></div>
      <div class="form-field"><label>🛵 ยี่ห้อรถ / ทะเบียน</label><input type="text" id="ep-vehicle" value="${escHtml(riderProfile.vehicle||'')}"></div>
      <button class="action-btn-big btn-green-big ripple" style="width:100%;margin-top:16px" onclick="saveEditProfile()">💾 บันทึก</button>
      <button class="action-btn-big btn-gray-big ripple" style="width:100%;margin-top:8px" onclick="closeModal()">ยกเลิก</button>
    </div>`;
  $('modal').classList.add('active');
}

async function saveEditProfile() {
  const name = $('ep-name').value.trim();
  const phone = $('ep-phone').value.trim();
  const vehicle = $('ep-vehicle').value.trim();
  if (!name || !phone) return showToast('⚠️ กรอกให้ครบ', 'warning');
  try {
    await db.collection('riders').doc(currentUser.uid).update({
      name, phone, vehicle,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (currentUser.displayName !== name) await currentUser.updateProfile({ displayName: name });
    closeModal();
    showToast('✅ บันทึกแล้ว', 'success');
  } catch (e) { showToast('❌ บันทึกไม่สำเร็จ', 'error'); }
}

// ═══ Debt ═══
function showDebtDetail() {
  closeMenu();
  const today = new Date(); today.setHours(0,0,0,0);
  const todaysOrders = allOrders.filter(o => o.status === 'done' && o.createdAt >= today);

  if (!todaysOrders.length) {
    showToast('✅ ไม่มียอดค้างจ่ายวันนี้', 'success');
    return;
  }

  const totalOrders = todaysOrders.length;
  const totalCollected = todaysOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalToShop = todaysOrders.reduce((s, o) => s + Number(o.price || 0), 0);
  const totalFare = todaysOrders.reduce((s, o) => s + Number(o.fare || 0), 0);

  const riderEarning = todaysOrders.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.riderEarning ?? (Math.round(fare * (1 - PLATFORM_FEE_RATE) * 100) / 100));
  }, 0);

  const amountOwed = todaysOrders.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.appEarning ?? (Math.round(fare * PLATFORM_FEE_RATE * 100) / 100));
  }, 0);

  const debt = currentDebtData || {};
  const lastPaid = debt.lastPaidAt?.toDate?.();
  const isPaidToday = lastPaid && lastPaid >= today;
  const isSuspended = debt.suspended === true;
  const dateStr = today.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

  let statusBlock = '';
  if (isSuspended) {
    statusBlock = `<div style="background:#FFEBEE;padding:14px;border-radius:12px;text-align:center;margin-bottom:16px;border:1px solid #EF9A9A"><div style="font-size:22px;margin-bottom:4px">🚫</div><div style="font-size:13px;font-weight:900;color:#C62828">บัญชีถูกระงับ</div><div style="font-size:11px;color:#B71C1C;margin-top:4px">${escHtml(debt.suspendedReason || 'กรุณาโอนเงินค้างจ่าย')}</div></div>`;
  } else if (isPaidToday) {
    statusBlock = `<div style="background:#E8F5E9;padding:14px;border-radius:12px;text-align:center;margin-bottom:16px"><div style="font-size:22px;margin-bottom:4px">✅</div><div style="font-size:13px;font-weight:900;color:#2E7D32">โอนเงินเรียบร้อยแล้ว</div><div style="font-size:11px;color:#558B2F;margin-top:4px">เวลา ${lastPaid.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div></div>`;
  } else {
    statusBlock = `<div style="background:#FFF3E0;padding:14px;border-radius:12px;text-align:center;margin-bottom:16px;border:1px solid #FFCC80"><div style="font-size:22px;margin-bottom:4px">⏰</div><div style="font-size:13px;font-weight:900;color:#E65100">ต้องโอนภายใน 21:00 น.</div></div>`;
  }

  $('modal-body').innerHTML = `
    <div class="modal-inner">
      <h2 style="font-size:20px;font-weight:900;margin-bottom:16px">💰 สรุปบัญชีวันนี้</h2>
      <div style="font-size:12px;color:#888;margin-bottom:12px;text-align:center;font-weight:700">${dateStr}</div>
      ${statusBlock}
      <div style="background:#f8f9fa;border-radius:14px;padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700"><span>📦 ออเดอร์วันนี้</span><strong>${totalOrders} รายการ</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700"><span>💵 เก็บจากลูกค้ารวม</span><strong>฿${totalCollected.toFixed(2)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700"><span>🏪 ค่าสินค้า (จ่ายร้าน)</span><strong style="color:#666">-฿${totalToShop.toFixed(2)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700;border-top:1px dashed #ddd;margin-top:6px;padding-top:10px"><span>🚚 ค่าส่งรวม</span><strong>฿${totalFare.toFixed(2)}</strong></div>
      </div>
      <div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;color:#2E7D32;font-weight:800;text-transform:uppercase">🛵 รายได้ของคุณ (80%)</div>
        <div style="font-size:28px;font-weight:900;color:#2E7D32;margin-top:4px">฿${riderEarning.toFixed(2)}</div>
        <div style="font-size:11px;color:#558B2F;margin-top:4px">เก็บไว้ใช้ได้เลย</div>
      </div>
      <div style="background:linear-gradient(135deg,#FFF3E0,#FFE0B2);border-radius:14px;padding:16px;margin-bottom:20px;border-left:4px solid #FF6B35">
        <div style="font-size:11px;color:#E65100;font-weight:800;text-transform:uppercase">💰 ต้องโอนให้แอป (20%)</div>
        <div style="font-size:32px;font-weight:900;color:#E65100;margin-top:4px">฿${amountOwed.toFixed(2)}</div>
        <div style="font-size:11px;color:#E65100;margin-top:4px;font-weight:700">⏰ ภายใน 21:00 น. วันนี้</div>
      </div>
      ${!isSuspended && !isPaidToday ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="action-btn-big btn-blue-big ripple" onclick="showTransferQR()">📱 โอนเงิน</button>
          <button class="action-btn-big btn-green-big ripple" onclick="markDebtPaid()">✅ แจ้งโอนแล้ว</button>
        </div>
      ` : ''}
      <button class="action-btn-big btn-gray-big ripple" onclick="closeModal()" style="width:100%;margin-top:8px">ปิด</button>
    </div>
  `;
  $('modal').classList.add('active');
}

function showTransferQR() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todaysOrders = allOrders.filter(o => o.status === 'done' && o.createdAt >= today);
  const amountOwed = todaysOrders.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.appEarning ?? (Math.round(fare * PLATFORM_FEE_RATE * 100) / 100));
  }, 0);

  $('modal-body').innerHTML = `
    <div class="modal-inner">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:50px;margin-bottom:8px">📱</div>
        <h2 style="font-size:20px;font-weight:900">โอนเงินให้แอดมิน</h2>
      </div>
      <div style="background:#f8f9fa;padding:20px;border-radius:16px;text-align:center;margin-bottom:16px">
        <div style="font-size:14px;color:#888;margin-bottom:8px">ยอดที่ต้องโอน</div>
        <div style="font-size:40px;font-weight:900;color:#FF6B35;line-height:1">฿${amountOwed.toFixed(2)}</div>
      </div>
      <div style="background:#fff;border:2px dashed #ddd;border-radius:16px;padding:20px;text-align:center;margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:12px">💳 PromptPay / โอนเข้าบัญชี</div>
        <div class="qr-placeholder">🏦</div>
        <div style="margin-top:14px;font-size:14px;font-weight:900">ชื่อบัญชี: <span style="color:#00A651">Chauat Go</span></div>
        <div style="margin-top:6px;font-size:16px;font-weight:900;font-family:monospace">📱 08X-XXX-XXXX</div>
      </div>
      <button class="action-btn-big btn-green-big ripple" style="width:100%" onclick="closeModal();markDebtPaid()">✅ ฉันโอนแล้ว</button>
      <button class="action-btn-big btn-gray-big ripple" style="width:100%;margin-top:8px" onclick="closeModal()">ยกเลิก</button>
    </div>
  `;
  $('modal').classList.add('active');
}

async function markDebtPaid() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todaysOrders = allOrders.filter(o => o.status === 'done' && o.createdAt >= today);
  const amount = todaysOrders.reduce((s, o) => {
    const fare = Number(o.fare || 0);
    return s + (o.appEarning ?? (Math.round(fare * PLATFORM_FEE_RATE * 100) / 100));
  }, 0);

  if (!amount || amount <= 0) { showToast('ไม่มียอดค้างจ่าย', 'info'); return; }
  if (!confirm(`ยืนยันว่าโอนเงิน ฿${amount.toFixed(2)} แล้ว?`)) return;

  try {
    const dateStr = today.toISOString().split('T')[0];
    const totalCollected = todaysOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const totalToShop = todaysOrders.reduce((s, o) => s + Number(o.price || 0), 0);
    const totalDeliveryFee = todaysOrders.reduce((s, o) => s + Number(o.fare || 0), 0);
    const riderEarning = todaysOrders.reduce((s, o) => {
      const fare = Number(o.fare || 0);
      return s + (o.riderEarning ?? (Math.round(fare * (1 - PLATFORM_FEE_RATE) * 100) / 100));
    }, 0);

    await db.collection('rider_debt_history').add({
      riderId: currentUser.uid,
      riderName: riderProfile.name || 'ไรเดอร์',
      date: dateStr,
      dateTs: firebase.firestore.Timestamp.fromDate(today),
      totalOrders: todaysOrders.length,
      totalCollected, totalToShop, totalDeliveryFee, riderEarning,
      amountOwed: amount, status: 'pending',
      markedAt: firebase.firestore.FieldValue.serverTimestamp(),
      paidAt: null, markedBy: null
    });

    await db.collection('rider_debts').doc(currentUser.uid).set({
      riderName: riderProfile.name || 'ไรเดอร์',
      lastNotifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    showToast('✅ แจ้งโอนแล้ว — รอแอดมินยืนยัน', 'success');
    closeModal();
  } catch (e) {
    logToScreen('markDebtPaid: ' + e.message, true);
    showToast('❌ แจ้งไม่สำเร็จ ลองใหม่', 'error');
  }
}

// ═══ Rating ═══
function getRiderLevel(rating, totalRatings) {
  if (!totalRatings || totalRatings < 5) return { key: 'new', icon: '🌱', label: 'ใหม่' };
  if (rating >= 4.9) return { key: 'elite', icon: '🏆', label: 'Elite' };
  if (rating >= 4.7) return { key: 'gold', icon: '🥇', label: 'Gold' };
  if (rating >= 4.5) return { key: 'silver', icon: '🥈', label: 'Silver' };
  if (rating >= 4.0) return { key: 'bronze', icon: '🥉', label: 'Bronze' };
  return { key: 'warn', icon: '⚠️', label: 'ปรับปรุง' };
}

function updateHeaderBadge() {
  const nameEl = document.querySelector('.header-info .name');
  if (!nameEl) return;
  const lv = getRiderLevel(riderProfile?.rating || 0, riderProfile?.totalRatings || 0);
  const baseName = (riderProfile?.name || 'ไรเดอร์').split(' ')[0];
  nameEl.innerHTML = `${escHtml(baseName)} <span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:900;vertical-align:middle;background:rgba(255,255,255,.2)">${lv.icon} ${lv.label}</span>`;
}

function updateRatingBox() {
  const box = $('rating-box');
  if (!box || !myRatings.length) { if (box) box.style.display = 'none'; return; }
  box.style.display = 'block';

  const totalStars = myRatings.reduce((s, r) => s + Number(r.stars || 0), 0);
  const avg = totalStars / myRatings.length;
  const avgRounded = Math.round(avg * 10) / 10;
  const fullStars = Math.floor(avgRounded);
  const hasHalf = (avgRounded - fullStars) >= 0.5;
  let starsStr = '★'.repeat(fullStars);
  if (hasHalf) starsStr += '☆';
  starsStr += '☆'.repeat(5 - fullStars - (hasHalf ? 1 : 0));

  $('my-rating').textContent = avgRounded.toFixed(1);
  $('my-rating-stars').textContent = starsStr;
  $('my-rating-count').textContent = `จาก ${myRatings.length} รีวิว`;

  const lv = getRiderLevel(avgRounded, myRatings.length);
  const levelText = $('my-level-text');
  if (levelText) {
    if (lv.key === 'new') levelText.textContent = `🌱 ต้องมีอีก ${5 - myRatings.length} รีวิว → Silver`;
    else if (lv.key === 'elite') levelText.textContent = `🏆 ระดับสูงสุดแล้ว!`;
    else {
      const targets = { gold: 4.9, silver: 4.7, bronze: 4.5, warn: 4.0 };
      const target = targets[lv.key];
      if (target) levelText.textContent = `${lv.icon} ${lv.label} • อีก ${(target - avgRounded).toFixed(1)}`;
    }
  }
}

function showMyReviews() {
  closeMenu();
  if (!myRatings.length) { showToast('ยังไม่มีรีวิว', 'info'); return; }
  const html = myRatings.slice(0, 20).map(r => {
    const stars = '⭐'.repeat(Number(r.stars || 0));
    const time = r.createdAt?.toLocaleDateString?.('th-TH') || '';
    return `<div style="background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:18px">${stars}</div>
        <div style="font-size:11px;color:#888">${time}</div>
      </div>
      ${r.comment ? `<div style="font-size:13px;color:#333;line-height:1.5;margin-bottom:6px">"${escHtml(r.comment)}"</div>` : ''}
      <div style="font-size:11px;color:#888">— ${escHtml(r.userName || 'ลูกค้า')}</div>
    </div>`;
  }).join('');

  $('modal-body').innerHTML = `
    <div class="modal-inner">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:50px">⭐</div>
        <h2 style="font-size:20px;font-weight:900;margin-top:8px">รีวิวของฉัน</h2>
        <p style="font-size:13px;color:#888;margin-top:4px">${myRatings.length} รีวิว (ล่าสุด 20)</p>
      </div>
      ${html}
      <button class="action-btn-big btn-green-big ripple" style="width:100%;margin-top:16px" onclick="closeModal()">ปิด</button>
    </div>
  `;
  $('modal').classList.add('active');
}

// ═══ Report Issue ═══
function openReportIssue(orderId) {
  $('modal-body').innerHTML = `
    <div class="modal-inner">
      <h2 style="font-size:20px;font-weight:900;margin-bottom:16px">⚠️ แจ้งปัญหาออเดอร์</h2>
      <div class="form-field">
        <label>เลือกปัญหาที่พบ</label>
        <select id="issue-reason">
          <option value="customer_no_answer">ลูกค้าไม่รับสาย / ติดต่อไม่ได้</option>
          <option value="shop_closed">ร้านปิด / หาไม่เจอ</option>
          <option value="wrong_address">ที่อยู่ไม่ตรง / หาไม่เจอ</option>
          <option value="other">อื่นๆ</option>
        </select>
      </div>
      <div class="form-field">
        <label>รายละเอียดเพิ่มเติม</label>
        <textarea id="issue-detail" rows="3" placeholder="อธิบายเพิ่มเติม..."></textarea>
      </div>
      <div class="actions-grid two" style="margin-top:16px">
        <button class="action-btn-big btn-gray-big ripple" onclick="closeModal()">ยกเลิก</button>
        <button class="action-btn-big btn-red-big ripple" onclick="submitReportIssue('${jsStr(orderId)}')" style="background:#E53935;color:#fff">📤 ส่งแจ้งปัญหา</button>
      </div>
    </div>
  `;
  $('modal').classList.add('active');
}

async function submitReportIssue(orderId) {
  const reason = $('issue-reason').value;
  const detail = $('issue-detail').value.trim();
  try {
    await db.collection('orders').doc(orderId).update({
      issueReported: true, issueReason: reason, issueDetail: detail,
      issueReportedAt: firebase.firestore.FieldValue.serverTimestamp(),
      issueReportedBy: currentUser.uid
    });
    showToast('✅ แจ้งปัญหาสำเร็จ', 'success');
    closeModal();
  } catch (e) {
    showToast('❌ แจ้งปัญหาไม่สำเร็จ', 'error');
  }
}

// ═══ Chat ═══
function showMyChats() {
  closeMenu();
  const activeOrders = allOrders.filter(o => ['accepted','picked_up','on_the_way'].includes(o.status));
  if (!activeOrders.length) { showToast('⚠️ ยังไม่มีงานที่กำลังทำ', 'info'); return; }
  openChat(activeOrders[0].id);
}

function openChat(orderId) {
  const order = allOrders.find(o => String(o.id) === String(orderId));
  if (!order) { showToast('⚠️ ไม่พบออเดอร์', 'error'); return; }
  currentChatOrderId = order.id;
  ensureChatDoc(order);

  $('modal-body').innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <button class="back-btn ripple" onclick="closeModal()">←</button>
        <div class="info">
          <div class="name">${escHtml(order.userName || 'ลูกค้า')}</div>
          <div class="status">👤 ลูกค้า • ${escHtml(order.title || '')}</div>
        </div>
        ${order.userPhone ? `<a href="tel:${escHtml(order.userPhone)}" style="background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);color:#fff;padding:10px 14px;border-radius:20px;font-size:12px;font-weight:900;text-decoration:none;min-height:44px;display:flex;align-items:center;font-family:inherit">📞 โทร</a>` : ''}
      </div>
      <div class="chat-quick-actions">
        <div class="quick-action" onclick="sendQuickMessage('ถึงหน้าร้านแล้วครับ 🏪')">🏪 ถึงร้าน</div>
        <div class="quick-action" onclick="sendQuickMessage('กำลังออกจากร้านครับ 🛵')">🚀 ออกร้าน</div>
        <div class="quick-action" onclick="sendQuickMessage('อีก 2-3 นาทีถึงครับ ⏱️')">⏱️ อีก 3 นาที</div>
        <div class="quick-action" onclick="sendQuickMessage('ถึงแล้วครับ 🏠')">🏠 ถึงแล้ว</div>
      </div>
      <div class="chat-messages" id="chat-messages"><div class="chat-msg system">เริ่มการสนทนาแล้ว</div></div>
      <div class="chat-input-area">
        <label for="chat-image-input" class="chat-attach-btn ripple">📷</label>
        <input type="file" id="chat-image-input" accept="image/*" capture="environment" style="display:none" onchange="handleImageUpload(this)">
        <input type="text" id="chat-input-text" placeholder="พิมพ์ข้อความ..." onkeypress="if(event.key==='Enter')sendChatMessage()">
        <button class="chat-send-btn ripple" onclick="sendChatMessage()">➤</button>
      </div>
    </div>`;
  $('modal').classList.add('active');
  setTimeout(() => {
    subscribeChatMessages(currentChatOrderId);
    setTimeout(scrollChatToBottom, 250);
  }, 100);
}

async function ensureChatDoc(order) {
  try {
    const chatRef = db.collection('chats').doc(order.id);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      await chatRef.set({
        orderId: order.id, userId: order.userId, userName: order.userName || '',
        riderId: order.riderId, riderName: order.rider?.name || '',
        lastMessage: '', lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        unreadByUser: 0, unreadByRider: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await chatRef.collection('