// ═══════════════════════════════════════════════════════════════════
//  🛵 CHAUAT GO RIDER — v3.3.3 (Production)
//  ระบบไรเดอร์: รับงาน, GPS, รายได้, 80/20 split, แชท
// ═══════════════════════════════════════════════════════════════════

// ─── Firebase Config ───
firebase.initializeApp({
  apiKey: "AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM",
  authDomain: "chauat-go-b9841.firebaseapp.com",
  projectId: "chauat-go-b9841",
  storageBucket: "chauat-go-b9841.firebasestorage.app",
  messagingSenderId: "282197694521",
  appId: "1:282197694521:web:0528c22747a0c04bd815e8"
});

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('[Rider] persistence:', e.code));

// ─── Constants ───
const PLATFORM_RATE = 0.20;   // แพลตฟอร์ม 20%
const RIDER_RATE = 0.80;      // ไรเดอร์ 80%
const DEADLINE_HOUR = 21;     // ต้องโอนก่อน 21:00
const GPS_MIN_DISTANCE = 30;  // เมตร — อัปเดต GPS ทุก 30 เมตร
const GPS_MIN_INTERVAL = 15000; // 15 วินาที
const MAX_ACCEPT_RADIUS_KM = 5; // ระยะรับงานสูงสุด 5 กม.

// ─── State ───
let currentUser = null;
let riderProfile = null;
let allOrders = [];
let myActiveOrders = [];
let myDoneOrders = [];
let newAvailableOrders = [];
let unsubOrders = null;
let unsubRider = null;
let unsubChats = null;
let watchId = null;
let lastGpsUpdate = 0;
let onlineStatus = false;
let map = null;
let riderMarker = null;
let acceptTimeout = null;
let pendingAcceptOrderId = null;
let audioCtx = null;

// ─── Helpers ───
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsStr = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = n => Number(n || 0).toLocaleString('th-TH');

function ts(o) { return o?.createdAt?.seconds || 0; }
function toDate(t) { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? null : d; }
function fmtTime(t) {
  if (!t) return '—';
  const d = toDate(t);
  return d ? d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
function fmtTimeShort(t) {
  if (!t) return '';
  const d = toDate(t);
  return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
}
function isToday(t) {
  if (!t) return false;
  const d = toDate(t);
  if (!d) return false;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return d >= now;
}
function itemsText(i) {
  if (Array.isArray(i)) return i.map(x => `${x.name} x${x.qty || 1}`).join(', ');
  return String(i ?? '');
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Toast ───
function showToast(msg, type) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ─── Debug Console ───
function logToScreen(msg, isError = false) {
  const el = $('debugConsole');
  if (el) {
    el.classList.add('show');
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${msg}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}
window.logToScreen = logToScreen;

// ─── Sound Notification ───
function playNewJobSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [880, 1100, 1320, 1100, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(f, audioCtx.currentTime + i * 0.15);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + i * 0.15 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.15);
      o.start(audioCtx.currentTime + i * 0.15);
      o.stop(audioCtx.currentTime + i * 0.15 + 0.15);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
  } catch (e) { console.warn('[Sound]', e); }
}

// ═══════════════════════════════════════════════════════════════════
//  🔐 AUTH
// ═══════════════════════════════════════════════════════════════════

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-signup').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
  $('login-error').textContent = '';
}
window.switchAuthTab = switchAuthTab;

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('login-submit');
  const email = $('login-email').value.trim();
  const pw = $('login-password').value;
  $('login-error').textContent = '';
  btn.disabled = true;
  btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';

  try {
    await auth.signInWithEmailAndPassword(email, pw);
    logToScreen('✅ ล็อกอินสำเร็จ: ' + email);
  } catch (err) {
    logToScreen('❌ ล็อกอินล้มเหลว: ' + err.code, true);
    $('login-error').textContent = mapAuthErr(err.code);
    btn.disabled = false;
    btn.textContent = '🔓 เข้าสู่ระบบ';
  }
}
window.handleLogin = handleLogin;

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('signup-submit');
  const name = $('su-name').value.trim();
  const phone = $('su-phone').value.trim();
  const vehicle = $('su-vehicle').value.trim();
  const email = $('su-email').value.trim();
  const pw1 = $('su-password').value;
  const pw2 = $('su-password2').value;
  const gpsConsent = $('gps-consent').checked;

  $('login-error').textContent = '';

  if (!name || !phone || !vehicle || !email || !pw1) {
    $('login-error').textContent = '⚠️ กรอกข้อมูลให้ครบ';
    return;
  }
  if (phone.replace(/\D/g, '').length < 9) {
    $('login-error').textContent = '⚠️ เบอร์โทรไม่ถูกต้อง';
    return;
  }
  if (pw1.length < 6) {
    $('login-error').textContent = '⚠️ รหัสผ่านอย่างน้อย 6 ตัว';
    return;
  }
  if (pw1 !== pw2) {
    $('login-error').textContent = '⚠️ รหัสผ่านไม่ตรงกัน';
    return;
  }
  if (!gpsConsent) {
    $('login-error').textContent = '⚠️ กรุณายอมรับนโยบาย GPS';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ กำลังสมัคร...';

  let createdUser = null;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw1);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: name });

    // สร้าง Document ใน users
    await db.collection('users').doc(createdUser.uid).set({
      uid: createdUser.uid,
      name,
      phone,
      email,
      role: 'rider',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // สร้าง Document ใน riders
    await db.collection('riders').doc(createdUser.uid).set({
      uid: createdUser.uid,
      name,
      phone,
      vehicle,
      email,
      status: 'inactive',
      verified: false,
      rating: 0,
      totalRatings: 0,
      totalJobs: 0,
      totalEarned: 0,
      gpsConsentedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      registeredVia: 'rider.html'
    });

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ', 'success');
  } catch (err) {
    logToScreen('❌ สมัครล้มเหลว: ' + err.code, true);
    if (createdUser && err.code !== 'auth/email-already-in-use') {
      try { await createdUser.delete(); } catch (_) { }
    }
    $('login-error').textContent = mapAuthErr(err.code);
    btn.disabled = false;
    btn.textContent = '✅ สมัครเป็นไรเดอร์';
  }
}
window.handleSignup = handleSignup;

async function handleForgot() {
  const email = $('login-email').value.trim();
  if (!email) {
    $('login-error').textContent = '⚠️ กรอกอีเมลก่อน';
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว', 'success');
  } catch (err) {
    $('login-error').textContent = '❌ ส่งไม่สำเร็จ';
  }
}
window.handleForgot = handleForgot;

function mapAuthErr(code) {
  return ({
    'auth/user-not-found': '❌ ไม่พบอีเมลนี้ในระบบ',
    'auth/wrong-password': '❌ รหัสผ่านไม่ถูกต้อง',
    'auth/invalid-credential': '❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/invalid-email': '❌ รูปแบบอีเมลไม่ถูกต้อง',
    'auth/email-already-in-use': '❌ อีเมลนี้ถูกใช้แล้ว',
    'auth/weak-password': '❌ รหัสผ่านสั้นเกินไป',
    'auth/too-many-requests': '⏳ ลองหลายครั้งเกินไป รอ 5 นาที',
    'auth/network-request-failed': '❌ ไม่มีการเชื่อมต่อ'
  })[code] || '❌ เข้าสู่ระบบไม่สำเร็จ (' + code + ')';
}

// ═══════════════════════════════════════════════════════════════════
//  🔄 AUTH STATE
// ═══════════════════════════════════════════════════════════════════

auth.onAuthStateChanged(async user => {
  stopAllListeners();

  if (!user) {
    logToScreen('⛔ ยังไม่ได้ล็อกอิน');
    $('login-screen').style.display = 'flex';
    $('app').style.display = 'none';
    const btn = $('login-submit');
    if (btn) { btn.disabled = false; btn.textContent = '🔓 เข้าสู่ระบบ'; }
    const btn2 = $('signup-submit');
    if (btn2) { btn2.disabled = false; btn2.textContent = '✅ สมัครเป็นไรเดอร์'; }
    return;
  }

  logToScreen('🔐 ผู้ใช้: ' + user.email);

  try {
    // เช็ค role ใน users
    const userSnap = await db.collection('users').doc(user.uid).get();
    if (!userSnap.exists) {
      logToScreen('❌ ไม่พบ users/' + user.uid, true);
      await auth.signOut();
      $('login-error').textContent = '❌ ไม่พบข้อมูลผู้ใช้';
      return;
    }

    const userData = userSnap.data();
    if (userData.role !== 'rider') {
      logToScreen('❌ Role ไม่ใช่ rider: ' + userData.role, true);
      await auth.signOut();
      $('login-error').textContent = '❌ บัญชีนี้ไม่ใช่ไรเดอร์';
      return;
    }

    // เช็ค rider document
    const riderSnap = await db.collection('riders').doc(user.uid).get();
    if (!riderSnap.exists) {
      logToScreen('❌ ไม่พบ riders/' + user.uid, true);
      await auth.signOut();
      $('login-error').textContent = '❌ ไม่พบข้อมูลไรเดอร์';
      return;
    }

    currentUser = user;
    riderProfile = { id: user.uid, ...riderSnap.data() };
    logToScreen('✅ Rider: ' + (riderProfile.name || 'ไม่ระบุ') + ', verified: ' + riderProfile.verified);

    // แสดง App
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';

    // Init
    initApp();

  } catch (err) {
    logToScreen('❌ Auth Error: ' + err.code + ' - ' + err.message, true);
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
});

// ═══════════════════════════════════════════════════════════════════
//  🚀 INIT APP
// ═══════════════════════════════════════════════════════════════════

function initApp() {
  updateHeaderUI();
  updatePendingBanner();
  subscribeRiderProfile();
  subscribeOrders();
  subscribeChats();
  setupOnlineToggle();
  setupPWABanner();
  setupNetworkDetection();
  setupVisibilityHandler();
  startDeadlineTimer();
  logToScreen('🚀 App พร้อมใช้งาน');
}

function setupOnlineToggle() {
  const btn = $('online-btn');
  if (!btn) return;
  btn.disabled = riderProfile?.verified !== true;
}

function setupNetworkDetection() {
  window.addEventListener('online', () => {
    $('offline-bar').classList.remove('show');
    showToast('🟢 กลับมาออนไลน์', 'success');
    if (onlineStatus) startGpsTracking();
  });
  window.addEventListener('offline', () => {
    $('offline-bar').classList.add('show');
  });
  if (!navigator.onLine) $('offline-bar').classList.add('show');
}

function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && onlineStatus && !watchId) {
      startGpsTracking();
    }
  });
}

function setupPWABanner() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  const dismissed = localStorage.getItem('pwa_dismissed');
  if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 3600 * 1000) return;

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('pwa-install-banner').classList.remove('hidden');
  });

  window.installPWA = async () => {
    if (!deferredPrompt) {
      showToast('กรุณาใช้เมนู "เพิ่มไปยังหน้าจอหลัก"', 'info');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('✅ ติดตั้งสำเร็จ', 'success');
    }
    deferredPrompt = null;
    $('pwa-install-banner').classList.add('hidden');
  };

  window.dismissPWA = () => {
    localStorage.setItem('pwa_dismissed', String(Date.now()));
    $('pwa-install-banner').classList.add('hidden');
  };
}

// ═══════════════════════════════════════════════════════════════════
//  📡 SUBSCRIBE RIDER PROFILE
// ═══════════════════════════════════════════════════════════════════

function subscribeRiderProfile() {
  unsubRider = db.collection('riders').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prev = riderProfile?.verified;
    riderProfile = { id: currentUser.uid, ...snap.data() };

    if (prev === false && riderProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว! เปิดรับงานได้', 'success');
      playNewJobSound();
    }

    updateHeaderUI();
    updatePendingBanner();
    updateOnlineToggleUI();
  }, err => logToScreen('❌ [rider] ' + err.code, true));
}

function updateHeaderUI() {
  if (!riderProfile) return;
  $('rider-name').textContent = riderProfile.name || 'ไรเดอร์';
  $('rider-id-header').textContent = '🆔 ' + currentUser.uid.slice(0, 12) + '...';

  // Rating
  const rating = Number(riderProfile.rating || 0);
  if (rating > 0 || riderProfile.totalRatings > 0) {
    $('rating-box').style.display = 'block';
    $('my-rating').textContent = rating.toFixed(1);
    $('my-rating-stars').textContent = getStars(rating);
    $('my-rating-count').textContent = 'จาก ' + (riderProfile.totalRatings || 0) + ' รีวิว';
    $('my-level-text').textContent = getLevelText(rating);
  }
}

function getStars(r) {
  const full = Math.floor(r);
  const half = (r - full) >= 0.5;
  let s = '★'.repeat(full);
  if (half) s += '⯨';
  return s + '☆'.repeat(Math.max(0, 5 - s.length));
}

function getLevelText(r) {
  if (r >= 4.8) return '⭐⭐⭐ ระดับเพชร';
  if (r >= 4.5) return '⭐⭐ ระดับทอง';
  if (r >= 4.0) return '⭐ ระดับเงิน';
  if (r >= 3.5) return 'ระดับทองแดง';
  return 'มือใหม่';
}

function updatePendingBanner() {
  const banner = $('pending-banner');
  const isVerified = riderProfile?.verified === true;
  banner.classList.toggle('show', !isVerified);
}

function updateOnlineToggleUI() {
  const btn = $('online-btn');
  const lbl = $('online-label');
  const stat = $('rider-status');

  if (!btn) return;
  const isVerified = riderProfile?.verified === true;
  btn.disabled = !isVerified;

  if (onlineStatus) {
    btn.classList.add('online');
    lbl.textContent = 'ออนไลน์';
    stat.textContent = '🟢 ออนไลน์';
  } else {
    btn.classList.remove('online');
    lbl.textContent = 'ออฟไลน์';
    stat.textContent = isVerified ? '⚫ ออฟไลน์' : '⏳ รอการอนุมัติ';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  🟢 ONLINE / OFFLINE TOGGLE
// ═══════════════════════════════════════════════════════════════════

async function toggleOnline() {
  if (riderProfile?.verified !== true) {
    showToast('⏳ รอแอดมินอนุมัติก่อน', 'warning');
    return;
  }

  onlineStatus = !onlineStatus;

  try {
    if (onlineStatus) {
      await db.collection('riders').doc(currentUser.uid).update({
        status: 'active',
        isOnline: true,
        onlineAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      });
      startGpsTracking();
      showToast('🟢 เปิดรับงานแล้ว', 'success');
      // ขอ Notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => { });
      }
    } else {
      await db.collection('riders').doc(currentUser.uid).update({
        status: 'inactive',
        isOnline: false,
        offlineAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      stopGpsTracking();
      // ลบพิกัด
      try {
        await db.collection('rider_locations').doc(currentUser.uid).delete();
      } catch (_) { }
      showToast('⚫ ปิดรับงานแล้ว', 'info');
    }
    updateOnlineToggleUI();
  } catch (err) {
    onlineStatus = !onlineStatus;
    logToScreen('❌ Toggle online: ' + err.message, true);
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.toggleOnline = toggleOnline;

// ═══════════════════════════════════════════════════════════════════
//  📍 GPS TRACKING
// ═══════════════════════════════════════════════════════════════════

function startGpsTracking() {
  if (watchId) return;
  if (!navigator.geolocation) {
    logToScreen('❌ ไม่รองรับ Geolocation', true);
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    async pos => {
      const now = Date.now();
      if (now - lastGpsUpdate < GPS_MIN_INTERVAL) return;
      lastGpsUpdate = now;

      const { latitude, longitude, accuracy } = pos.coords;
      try {
        await db.collection('rider_locations').doc(currentUser.uid).set({
          riderId: currentUser.uid,
          name: riderProfile?.name || 'ไรเดอร์',
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          isOnline: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await db.collection('riders').doc(currentUser.uid).update({
          lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
          lastLat: latitude,
          lastLng: longitude
        }).catch(() => { });

        updateMapMarker(latitude, longitude);
      } catch (err) {
        logToScreen('❌ GPS save: ' + err.code, true);
      }
    },
    err => {
      logToScreen('❌ GPS error: ' + err.message, true);
      showToast('⚠️ ไม่สามารถเข้าถึง GPS ได้', 'warning');
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 30000
    }
  );

  logToScreen('📍 เริ่มติดตาม GPS');
}

function stopGpsTracking() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    logToScreen('📍 หยุดติดตาม GPS');
  }
}

function updateMapMarker(lat, lng) {
  if (riderMarker) {
    riderMarker.setLatLng([lat, lng]);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  📦 SUBSCRIBE ORDERS
// ═══════════════════════════════════════════════════════════════════

function subscribeOrders() {
  if (unsubOrders) unsubOrders();

  // ดึงออเดอร์ที่เกี่ยวข้อง 3 กลุ่ม:
  // 1. ออเดอร์ของตัวเอง (active + done)
  // 2. ออเดอร์ใหม่ที่ยังไม่มีคนรับ (สำหรับไรเดอร์ออนไลน์)
  unsubOrders = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const myUid = currentUser.uid;

      // ออเดอร์ของฉัน
      myActiveOrders = all.filter(o =>
        o.riderId === myUid &&
        !['done', 'cancelled'].includes(o.status)
      );
      myDoneOrders = all.filter(o =>
        o.riderId === myUid &&
        o.status === 'done' &&
        isToday(o.createdAt)
      );

      // ออเดอร์ใหม่ที่ยังไม่มีคนรับ (แสดงเฉพาะถ้าออนไลน์ + verified)
      newAvailableOrders = (onlineStatus && riderProfile?.verified === true)
        ? all.filter(o =>
          !o.riderId &&
          ['pending', 'searching'].includes(o.status) &&
          !['cancelled', 'done'].includes(o.status)
        )
        : [];

      renderOrders();
      updateStats();
      updateHero();
      checkNewJobs();
    }, err => {
      logToScreen('❌ [orders] ' + err.code, true);
      if (err.code === 'permission-denied') {
        showToast('⚠️ ไม่มีสิทธิ์อ่านออเดอร์', 'error');
      } else if (err.code === 'failed-precondition') {
        showToast('⚠️ ต้องสร้าง Firestore Index', 'warning');
      }
    });
}

// ═══════════════════════════════════════════════════════════════════
//  🎨 RENDER ORDERS
// ═══════════════════════════════════════════════════════════════════

function renderOrders() {
  // New available
  $('cnt-new').textContent = newAvailableOrders.length;
  $('new-jobs').innerHTML = newAvailableOrders.length
    ? newAvailableOrders.slice(0, 5).map(o => renderNewJobCard(o)).join('')
    : '';

  // Active
  $('cnt-active').textContent = myActiveOrders.length;
  $('active-jobs').innerHTML = myActiveOrders.length
    ? myActiveOrders.map(o => renderActiveJobCard(o)).join('')
    : '';

  // Done today
  $('cnt-done').textContent = myDoneOrders.length;
  $('done-jobs').innerHTML = myDoneOrders.length
    ? myDoneOrders.slice(0, 10).map(o => renderDoneJobCard(o)).join('')
    : '';

  // Empty state
  const total = newAvailableOrders.length + myActiveOrders.length + myDoneOrders.length;
  $('empty-all').style.display = total === 0 ? 'block' : 'none';
  if (total === 0) {
    if (!onlineStatus) {
      $('empty-msg').textContent = 'เปิดสถานะ "ออนไลน์" เพื่อรับงานใหม่';
    } else if (!riderProfile?.verified) {
      $('empty-msg').textContent = 'รอแอดมินอนุมัติก่อน';
    } else {
      $('empty-msg').textContent = 'ยังไม่มีงานใหม่ รอสักครู่';
    }
  }
}

function renderNewJobCard(o) {
  return `
    <div class="job-card is-new">
      <div class="job-top">
        <div class="job-emoji">🔔</div>
        <div class="job-info">
          <div class="job-title">${esc(o.title || 'ออเดอร์ใหม่')}</div>
          <div class="job-meta">
            📍 ${esc((o.address || '').slice(0, 50))}${(o.address || '').length > 50 ? '...' : ''}<br>
            💰 ค่าส่ง ฿${fmt(o.fare || 0)} • 📏 ${o.distance ? o.distance.toFixed(1) + ' กม.' : '—'}<br>
            🕐 ${fmtTime(o.createdAt)}
          </div>
        </div>
      </div>
      <div class="job-price">
        <div class="lbl">💰 รับสุทธิ (80%)</div>
        <div class="amt">฿${fmt((Number(o.fare) || 0) * RIDER_RATE)}</div>
      </div>
      <div class="job-actions two">
        <button class="action-btn-big btn-green-big ripple" onclick="acceptJob('${jsStr(o.id)}')">✅ รับงาน</button>
        <button class="action-btn-big btn-gray-big ripple" onclick="skipJob('${jsStr(o.id)}')">⏭️ ข้าม</button>
      </div>
    </div>`;
}

function renderActiveJobCard(o) {
  const status = o.status || 'accepted';
  const statusLabel = {
    accepted: '🍳 กำลังเตรียม',
    cooking: '🍳 กำลังทำอาหาร',
    ready: '✅ พร้อมรับของ',
    picked_up: '📦 รับของแล้ว',
    on_the_way: '🚀 กำลังส่ง'
  }[status] || status;

  const hasSlip = o.riderSlipUrl;
  const slipVerified = o.riderSlipVerified;

  let actions = '';

  if (status === 'ready' || status === 'accepted' || status === 'cooking') {
    if (!hasSlip) {
      actions = `<button class="action-btn-big btn-blue-big ripple" onclick="openSlipUpload('${jsStr(o.id)}')">📸 แนบสลิปโอนร้าน</button>`;
    } else if (!slipVerified) {
      actions = `<div class="slip-status-banner pending">⏳ รอร้านตรวจสอบสลิป</div>
        <button class="action-btn-big btn-gray-big ripple" onclick="viewSlip('${jsStr(o.id)}')">👁️ ดูสลิปที่ส่งไป</button>`;
    } else {
      actions = `<div class="slip-status-banner ok">✅ ร้านยืนยันรับเงินแล้ว</div>
        <button class="action-btn-big btn-green-big ripple" onclick="confirmPickup('${jsStr(o.id)}')">📦 รับของจากร้าน</button>`;
    }
  } else if (status === 'picked_up') {
    actions = `<button class="action-btn-big btn-green-big ripple" onclick="startDelivery('${jsStr(o.id)}')">🚀 เริ่มส่งลูกค้า</button>`;
  } else if (status === 'on_the_way') {
    actions = `<button class="action-btn-big btn-green-big ripple" onclick="markDelivered('${jsStr(o.id)}')">✅ ส่งสำเร็จ</button>`;
  }

  return `
    <div class="job-card">
      <div class="job-top">
        <div class="job-emoji">🛵</div>
        <div class="job-info">
          <div class="job-title">${esc(o.title || 'ออเดอร์')}</div>
          <div class="job-meta">
            👤 ${esc(o.userName || '—')} • 📞 ${esc(o.userPhone || '—')}<br>
            📍 ${esc((o.address || '').slice(0, 60))}${(o.address || '').length > 60 ? '...' : ''}<br>
            🏪 ร้าน: ${esc(o.merchantName || '—')}<br>
            สถานะ: ${statusLabel}
          </div>
        </div>
      </div>
      <div class="job-price">
        <div class="lbl">💰 ค่าส่งทั้งหมด</div>
        <div class="amt">฿${fmt(o.fare || 0)}</div>
      </div>
      <div class="job-actions">
        ${actions}
      </div>
    </div>`;
}

function renderDoneJobCard(o) {
  return `
    <div class="job-card" style="border-left-color:#00A651;opacity:.9">
      <div class="job-top">
        <div class="job-emoji" style="background:#E8F5E9">✅</div>
        <div class="job-info">
          <div class="job-title">${esc(o.title || 'ออเดอร์')}</div>
          <div class="job-meta">
            🕐 ${fmtTime(o.createdAt)} • 📞 ${esc(o.userPhone || '—')}<br>
            สถานะ: ✅ ส่งสำเร็จ
          </div>
        </div>
      </div>
      <div class="job-price">
        <div class="lbl">💰 รายได้สุทธิ (80%)</div>
        <div class="amt">฿${fmt((Number(o.fare) || 0) * RIDER_RATE)}</div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  📊 UPDATE STATS + HERO
// ═══════════════════════════════════════════════════════════════════

function updateStats() {
  $('stat-done').textContent = myDoneOrders.length;
  $('stat-active').textContent = myActiveOrders.length;
  $('stat-total').textContent = riderProfile?.totalJobs || 0;
}

function updateHero() {
  let totalEarn = 0;
  let totalCollected = 0;

  myDoneOrders.forEach(o => {
    const fare = Number(o.fare) || 0;
    totalEarn += fare * RIDER_RATE;
    totalCollected += fare;
  });

  // 20% ที่ต้องโอนแอป (เฉพาะงานที่ยังไม่ชำระ)
  const owed = myDoneOrders
    .filter(o => !o.riderPaid)
    .reduce((sum, o) => sum + (Number(o.fare) || 0) * PLATFORM_RATE, 0);

  $('hero-earn').textContent = '฿' + fmt(totalEarn);
  $('hero-sub').textContent = 'จาก ' + myDoneOrders.length + ' งานเสร็จสิ้นวันนี้';
  $('hero-collected').textContent = '฿' + fmtInt(totalCollected);
  $('hero-owed').textContent = '฿' + fmt(owed);

  // Deadline strip
  if (owed > 0) {
    $('deadline-strip').style.display = 'flex';
  } else {
    $('deadline-strip').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ⏰ DEADLINE TIMER (21:00)
// ═══════════════════════════════════════════════════════════════════

function startDeadlineTimer() {
  setInterval(() => {
    const now = new Date();
    const deadline = new Date();
    deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
    if (deadline < now) deadline.setDate(deadline.getDate() + 1);

    const diff = deadline - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const el = $('deadline-time');
    if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // เตือน 30 นาทีก่อน deadline
    if (h === 0 && m === 30 && s === 0) {
      showToast('⚠️ เหลือ 30 นาที ต้องโอน 20%', 'warning');
      playNewJobSound();
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════════
//  🔔 NEW JOB DETECTION
// ═══════════════════════════════════════════════════════════════════

let seenOrderIds = new Set();

function checkNewJobs() {
  if (!onlineStatus || riderProfile?.verified !== true) return;

  const currentIds = new Set(newAvailableOrders.map(o => o.id));
  const fresh = newAvailableOrders.filter(o => !seenOrderIds.has(o.id));

  if (fresh.length > 0 && seenOrderIds.size > 0) {
    const job = fresh[0];
    playNewJobSound();
    showNewJobPopup(job);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🔔 งานใหม่!', {
          body: `${job.title || 'ออเดอร์'} • ฿${fmt((job.fare || 0) * RIDER_RATE)}`,
          icon: 'icons/icon-512.png',
          tag: 'job-' + job.id
        });
      } catch (_) { }
    }
  }

  seenOrderIds = currentIds;
}

function showNewJobPopup(job) {
  pendingAcceptOrderId = job.id;
  const detail = `
    <div>📍 <strong>${esc(job.title || 'ออเดอร์')}</strong></div>
    <div>🏪 ร้าน: ${esc(job.merchantName || '—')}</div>
    <div>📏 ระยะ: ${job.distance ? job.distance.toFixed(1) + ' กม.' : '—'}</div>
    <div>💰 รับสุทธิ: <strong style="color:#00A651">฿${fmt((Number(job.fare) || 0) * RIDER_RATE)}</strong></div>
    <div style="font-size:11px;color:#666;margin-top:6px">⏱️ กรุณาตอบภายใน 30 วินาที</div>
  `;
  $('new-job-detail').innerHTML = detail;
  $('new-job-popup').classList.add('show');

  if (acceptTimeout) clearTimeout(acceptTimeout);
  acceptTimeout = setTimeout(() => {
    closeNewJobPopup();
    showToast('⏰ หมดเวลารับงาน', 'warning');
  }, 30000);
}

function closeNewJobPopup() {
  $('new-job-popup').classList.remove('show');
  if (acceptTimeout) { clearTimeout(acceptTimeout); acceptTimeout = null; }
  pendingAcceptOrderId = null;
}
window.closeNewJobPopup = closeNewJobPopup;

function acceptNewJob() {
  if (pendingAcceptOrderId) {
    acceptJob(pendingAcceptOrderId);
  }
  closeNewJobPopup();
}
window.acceptNewJob = acceptNewJob;

// ═══════════════════════════════════════════════════════════════════
//  ✅ JOB ACTIONS
// ═══════════════════════════════════════════════════════════════════

async function acceptJob(orderId) {
  if (!onlineStatus) { showToast('ต้องออนไลน์ก่อน', 'warning'); return; }
  if (riderProfile?.verified !== true) { showToast('รออนุมัติก่อน', 'warning'); return; }

  try {
    await db.collection('orders').doc(orderId).update({
      riderId: currentUser.uid,
      riderName: riderProfile.name,
      riderPhone: riderProfile.phone,
      status: 'accepted',
      acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ รับงานสำเร็จ!', 'success');
    playNewJobSound();
  } catch (err) {
    logToScreen('❌ acceptJob: ' + err.message, true);
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.acceptJob = acceptJob;

function skipJob(orderId) {
  seenOrderIds.add(orderId);
  showToast('⏭️ ข้ามงานนี้', 'info');
}
window.skipJob = skipJob;

async function openSlipUpload(orderId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('⚠️ รูปใหญ่เกิน 5MB', 'warning'); return; }

    const order = [...myActiveOrders, ...newAvailableOrders].find(o => o.id === orderId);
    if (!order) { showToast('❌ ไม่พบออเดอร์', 'error'); return; }

    try {
      showToast('⏳ กำลังอัปโหลดสลิป...', 'info');
      const path = `slips/orders/${orderId}/rider-${Date.now()}.jpg`;
      const ref = storage.ref(path);
      await ref.put(file);
      const url = await ref.getDownloadURL();

      await db.collection('orders').doc(orderId).update({
        riderSlipUrl: url,
        riderSlipPath: path,
        riderSlipVerified: false,
        riderSlipAt: firebase.firestore.FieldValue.serverTimestamp(),
        riderPaid: false
      });

      showToast('✅ ส่งสลิปแล้ว รอร้านตรวจสอบ', 'success');
    } catch (err) {
      logToScreen('❌ Upload slip: ' + err.message, true);
      showToast('อัปโหลดไม่สำเร็จ: ' + err.message, 'error');
    }
  };
  input.click();
}
window.openSlipUpload = openSlipUpload;

function viewSlip(orderId) {
  const o = myActiveOrders.find(x => x.id === orderId);
  if (!o || !o.riderSlipUrl) return;
  showModal(`<div style="text-align:center">
    <h3 style="margin-bottom:12px">📸 สลิปที่ส่งไป</h3>
    <img src="${esc(o.riderSlipUrl)}" style="width:100%;border-radius:12px;margin-bottom:12px">
    <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="width:100%">ปิด</button>
  </div>`);
}
window.viewSlip = viewSlip;

async function confirmPickup(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'picked_up',
      pickedUpAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('📦 รับของจากร้านแล้ว', 'success');
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.confirmPickup = confirmPickup;

async function startDelivery(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'on_the_way',
      deliveryStartedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('🚀 เริ่มส่งลูกค้า', 'success');
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.startDelivery = startDelivery;

async function markDelivered(orderId) {
  if (!confirm('ยืนยันส่งสำเร็จ?')) return;
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'done',
      deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
      riderEarn: (Number(myActiveOrders.find(o => o.id === orderId)?.fare) || 0) * RIDER_RATE
    });

    // อัปเดต stat rider
    await db.collection('riders').doc(currentUser.uid).update({
      totalJobs: firebase.firestore.FieldValue.increment(1),
      totalEarned: firebase.firestore.FieldValue.increment(
        (Number(myActiveOrders.find(o => o.id === orderId)?.fare) || 0) * RIDER_RATE
      )
    }).catch(() => { });

    showToast('✅ ส่งสำเร็จ!', 'success');
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.markDelivered = markDelivered;

// ═══════════════════════════════════════════════════════════════════
//  💬 CHATS
// ═══════════════════════════════════════════════════════════════════

function subscribeChats() {
  if (unsubChats) unsubChats();
  unsubChats = db.collection('chats')
    .where('participantIds', 'array-contains', currentUser.uid)
    .onSnapshot(snap => {
      // อาจใช้สำหรับ unread count
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unread = chats.reduce((sum, c) => sum + (c[`unread_${currentUser.uid}`] || 0), 0);
      // อัปเดต badge ที่เมนู (ถ้ามี)
    }, err => logToScreen('❌ [chats] ' + err.code, true));
}

let activeChatId = null;
let activeChatUnsub = null;

function showMyChats() {
  closeMenu();
  const chats = [];
  // ในอนาคตดึงจาก Firestore
  showModal(`
    <h3 style="margin-bottom:12px">💬 แชทของฉัน</h3>
    <div class="empty" style="padding:20px">
      <p style="font-size:13px;color:#666">ยังไม่มีการสนทนา</p>
      <p style="font-size:11px;color:#999;margin-top:6px">เมื่อคุณรับงาน แชทกับลูกค้าจะปรากฏที่นี่</p>
    </div>
    <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="width:100%;margin-top:12px">ปิด</button>
  `);
}
window.showMyChats = showMyChats;

// ═══════════════════════════════════════════════════════════════════
//  📋 MENU & MODAL
// ═══════════════════════════════════════════════════════════════════

function openMenu() {
  $('menu-sheet').classList.add('show');
}
window.openMenu = openMenu;

function closeMenu() {
  $('menu-sheet').classList.remove('show');
}
window.closeMenu = closeMenu;

function showModal(html) {
  $('modal-body').innerHTML = html;
  $('modal').classList.add('show');
}
window.showModal = showModal;

function closeModal() {
  $('modal').classList.remove('show');
}
window.closeModal = closeModal;

function showMyInfo() {
  closeMenu();
  showModal(`
    <h3 style="margin-bottom:16px">👤 ข้อมูลของฉัน</h3>
    <div style="background:#f8f9fa;padding:16px;border-radius:12px;margin-bottom:12px;line-height:2;font-size:13px">
      <div>👤 <strong>${esc(riderProfile?.name || '—')}</strong></div>
      <div>📞 ${esc(riderProfile?.phone || '—')}</div>
      <div>🛵 ${esc(riderProfile?.vehicle || '—')}</div>
      <div>📧 ${esc(riderProfile?.email || '—')}</div>
      <div>🆔 <code style="font-size:11px">${esc(currentUser.uid)}</code></div>
      <div>⭐ ${Number(riderProfile?.rating || 0).toFixed(1)} (${riderProfile?.totalRatings || 0} รีวิว)</div>
      <div>📦 งานสะสม: ${riderProfile?.totalJobs || 0}</div>
      <div>💰 รายได้สะสม: ฿${fmt(riderProfile?.totalEarned || 0)}</div>
      <div>📅 สมัครเมื่อ: ${fmtTime(riderProfile?.createdAt)}</div>
    </div>
    <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="width:100%">ปิด</button>
  `);
}
window.showMyInfo = showMyInfo;

function showDebtDetail() {
  closeMenu();
  const owed = myDoneOrders.filter(o => !o.riderPaid).reduce((s, o) => s + (Number(o.fare) || 0) * PLATFORM_RATE, 0);

  const rows = myDoneOrders.filter(o => !o.riderPaid).map(o => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:12px">
      <div>
        <div style="font-weight:800">${esc(o.title || '—')}</div>
        <div style="color:#999;font-size:10px">${fmtTime(o.createdAt)}</div>
      </div>
      <div style="font-weight:900;color:#FF6B35">฿${fmt((Number(o.fare) || 0) * PLATFORM_RATE)}</div>
    </div>
  `).join('');

  showModal(`
    <h3 style="margin-bottom:16px">💰 ยอดค้างจ่าย (20%)</h3>
    <div style="background:#FFF3E0;padding:16px;border-radius:12px;margin-bottom:12px;text-align:center">
      <div style="font-size:12px;color:#8D4A00;font-weight:800">ต้องโอนทั้งหมด</div>
      <div style="font-size:32px;font-weight:900;color:#E65100;margin-top:4px">฿${fmt(owed)}</div>
      <div style="font-size:11px;color:#8D4A00;margin-top:6px">⏰ ภายใน 21:00 น. วันนี้</div>
    </div>
    ${rows || '<div style="text-align:center;padding:20px;color:#999;font-size:13px">ไม่มีรายการค้างจ่าย 🎉</div>'}
    <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="width:100%;margin-top:12px">ปิด</button>
  `);
}
window.showDebtDetail = showDebtDetail;

function showMyReviews() {
  closeMenu();
  showModal(`
    <h3 style="margin-bottom:12px">⭐ รีวิวของฉัน</h3>
    <div style="text-align:center;padding:20px;background:#FFF8E1;border-radius:12px;margin-bottom:12px">
      <div style="font-size:40px;font-weight:900;color:#E65100">${Number(riderProfile?.rating || 0).toFixed(1)}</div>
      <div style="font-size:20px;color:#FFA000;margin-top:4px">${getStars(Number(riderProfile?.rating || 0))}</div>
      <div style="font-size:12px;color:#8D4A00;margin-top:8px">จาก ${riderProfile?.totalRatings || 0} รีวิว</div>
    </div>
    <div style="text-align:center;padding:20px;color:#999;font-size:12px">ยังไม่มีรายละเอียดรีวิว</div>
    <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="width:100%;margin-top:12px">ปิด</button>
  `);
}
window.showMyReviews = showMyReviews;

function openEditProfile() {
  closeMenu();
  showModal(`
    <h3 style="margin-bottom:16px">✏️ แก้ไขโปรไฟล์</h3>
    <div class="form-field">
      <label>ชื่อ-นามสกุล</label>
      <input type="text" id="edit-name" value="${esc(riderProfile?.name || '')}">
    </div>
    <div class="form-field">
      <label>เบอร์โทรศัพท์</label>
      <input type="tel" id="edit-phone" value="${esc(riderProfile?.phone || '')}">
    </div>
    <div class="form-field">
      <label>ยี่ห้อรถ / ทะเบียน</label>
      <input type="text" id="edit-vehicle" value="${esc(riderProfile?.vehicle || '')}">
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="action-btn-big btn-gray-big" onclick="closeModal()" style="flex:1">ยกเลิก</button>
      <button class="action-btn-big btn-orange-big" onclick="saveProfile()" style="flex:1">💾 บันทึก</button>
    </div>
  `);
}
window.openEditProfile = openEditProfile;

async function saveProfile() {
  const name = $('edit-name')?.value.trim();
  const phone = $('edit-phone')?.value.trim();
  const vehicle = $('edit-vehicle')?.value.trim();

  if (!name || !phone) { showToast('กรอกข้อมูลให้ครบ', 'warning'); return; }

  try {
    await db.collection('riders').doc(currentUser.uid).update({
      name, phone, vehicle,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('users').doc(currentUser.uid).update({ name, phone }).catch(() => { });
    showToast('✅ บันทึกสำเร็จ', 'success');
    closeModal();
  } catch (err) {
    showToast('ไม่สำเร็จ: ' + err.message, 'error');
  }
}
window.saveProfile = saveProfile;

async function handleRiderLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeMenu();
  try {
    if (onlineStatus) {
      await db.collection('riders').doc(currentUser.uid).update({
        status: 'inactive',
        isOnline: false,
        offlineAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      try { await db.collection('rider_locations').doc(currentUser.uid).delete(); } catch (_) { }
    }
    stopAllListeners();
    await auth.signOut();
  } catch (err) {
    console.error(err);
  }
}
window.handleRiderLogout = handleRiderLogout;

// ═══════════════════════════════════════════════════════════════════
//  🛑 STOP LISTENERS
// ═══════════════════════════════════════════════════════════════════

function stopAllListeners() {
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
  if (unsubRider) { unsubRider(); unsubRider = null; }
  if (unsubChats) { unsubChats(); unsubChats = null; }
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  stopGpsTracking();
  onlineStatus = false;
  allOrders = [];
  myActiveOrders = [];
  myDoneOrders = [];
  newAvailableOrders = [];
  seenOrderIds.clear();
}

// ═══════════════════════════════════════════════════════════════════
//  🖐️ HAPTIC + RIPPLE
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('click', e => {
  const el = e.target.closest('button, .action-btn-big, .action-btn, .job-card, .sheet-item');
  if (el && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// ═══════════════════════════════════════════════════════════════════
//  📱 PWA SERVICE WORKER (ไม่ใช้ SW ใน rider เพราะต้องการข้อมูลสด)
// ═══════════════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(reg => {
        setInterval(() => reg.update(), 60000);
      })
      .catch(err => console.warn('[SW]', err));
  });
}

// ═══════════════════════════════════════════════════════════════════
//  🎉 READY
// ═══════════════════════════════════════════════════════════════════

console.log('%c🛵 Chauat Go Rider v3.3.3', 'color:#FF6B35;font-weight:900;font-size:16px');
console.log('%c✓ GPS Tracking | ✓ Job Accept | ✓ 80/20 Split | ✓ Slip Upload', 'color:#1565C0;font-weight:700');
logToScreen('🚀 rider.js v3.3.3 โหลดสำเร็จ');