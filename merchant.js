/* ═══════════════════════════════════════════════════════════════
   🏪 CHAUAT GO MERCHANT — v3.3.3
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
  appId: "1:282197694521:web:0528c22747a0c04bd815e8",
  measurementId: "G-6E2QEFWK6P"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('[persistence]', e.code));

// ═══════════════════════════════════════════════════════════════
//  2. STATE
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let merchantProfile = null;
let allOrders = [];
let allHistory = [];
let myMenus = [];
let unsubOrders = null;
let unsubHistory = null;
let unsubMenus = null;
let unsubProfile = null;
let editingMenuId = null;
let menuImgFile = null;
let currentMenuImageUrl = null;
let newPopupOrderId = null;
let audioCtx = null;
let seenOrderIds = new Set();
let currentHistoryFilter = 'today';
let activeChatId = null;
let activeChatUnsub = null;
let deferredPrompt = null;

const GP_RATE = 0.03;
const GP_RIDER_RATE = 0.02;
const GP_PLATFORM_RATE = 0.01;
const GP_FREE_DAYS = 60;
const MAX_IMG_SIZE = 5 * 1024 * 1024;

const CAT_LABELS = {main:'จานหลัก', side:'กับข้าว', drink:'เครื่องดื่ม', dessert:'ของหวาน', other:'อื่นๆ'};
const CAT_ICONS = {main:'🍽️', side:'🥗', drink:'🥤', dessert:'🍰', other:'📦'};

// ═══════════════════════════════════════════════════════════════
//  3. HELPERS
// ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsStr = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const toDate = (t) => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? null : d; };
const fmtTime = (t) => { const d = toDate(t); return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'; };
const fmtDate = (t) => { const d = toDate(t); return d ? d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'; };
const fmtDateTime = (t) => `${fmtDate(t)} ${fmtTime(t)}`;
const isToday = (t) => { const d = toDate(t); if (!d) return false; const n = new Date(); n.setHours(0,0,0,0); return d >= n; };
const isYesterday = (t) => { const d = toDate(t); if (!d) return false; const today = new Date(); today.setHours(0,0,0,0); const yest = new Date(today); yest.setDate(yest.getDate()-1); return d >= yest && d < today; };
const isThisWeek = (t) => { const d = toDate(t); if (!d) return false; const n = new Date(); const w = new Date(n.getTime() - 7*24*60*60*1000); return d >= w; };
const isThisMonth = (t) => { const d = toDate(t); if (!d) return false; const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); };

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
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅';
  toast.innerHTML = `<span>${icon}</span><span>${esc(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ─── Sound ───
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [660, 880, 1100, 880].forEach((f, i) => {
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

// ─── Image Compress ───
function compressImage(file, maxWidth = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// ─── GP Calc ───
function isGPActive() {
  if (!merchantProfile?.createdAt) return false;
  const created = toDate(merchantProfile.createdAt);
  const diff = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= GP_FREE_DAYS;
}
function gpDaysLeft() {
  if (!merchantProfile?.createdAt) return GP_FREE_DAYS;
  const created = toDate(merchantProfile.createdAt);
  const diff = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(GP_FREE_DAYS - diff));
}
function calcGP(amount) {
  if (!isGPActive()) return { total: 0, rider: 0, platform: 0 };
  return {
    total: Math.round(amount * GP_RATE * 100) / 100,
    rider: Math.round(amount * GP_RIDER_RATE * 100) / 100,
    platform: Math.round(amount * GP_PLATFORM_RATE * 100) / 100
  };
}

// ─── Sheets ───
function openSheet(id) { document.getElementById(id).classList.add('active'); }
function closeSheet(id) { document.getElementById(id).classList.remove('active'); }

// ═══════════════════════════════════════════════════════════════
//  4. AUTH
// ═══════════════════════════════════════════════════════════════
auth.onAuthStateChanged(async user => {
  if (!user) { showLoginScreen(); return; }

  try {
    // เช็ค users collection (role)
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'merchant') {
      await auth.signOut();
      setLoginError('❌ บัญชีนี้ไม่มีสิทธิ์เข้าระบบร้านค้า');
      showLoginScreen();
      return;
    }

    // ดึง merchant profile
    const snap = await db.collection('merchants').doc(user.uid).get();
    if (!snap.exists) {
      await auth.signOut();
      setLoginError('❌ ไม่พบข้อมูลร้านค้า กรุณาสมัครใหม่');
      showLoginScreen();
      switchAuthTab('signup');
      return;
    }
    merchantProfile = { uid: user.uid, ...snap.data() };
    logToScreen('✅ Merchant: ' + merchantProfile.name);
  } catch (e) {
    logToScreen('❌ Auth: ' + e.message, true);
    await auth.signOut();
    setLoginError('⚠️ ตรวจสอบสิทธิ์ไม่สำเร็จ');
    showLoginScreen();
    return;
  }

  currentUser = user;
  showApp();
  initApp();
});

function showLoginScreen() {
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
  const bl = $('btn-login'); if (bl) { bl.disabled = false; bl.textContent = '🔓 เข้าสู่ระบบ'; }
  const bs = $('btn-signup'); if (bs) { bs.disabled = false; bs.textContent = '🏪 สมัครร้านค้า'; }
}
function showApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
}
function setLoginError(msg) { const el = $('login-error'); if (el) el.textContent = msg || ''; }

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-signup').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
  $('login-hint').innerHTML = isLogin
    ? '🔐 หลังสมัครแล้ว แอดมินจะอนุมัติภายใน 24 ชม.'
    : '⚠️ กรอกข้อมูลให้ครบถ้วน แอดมินจะติดต่อกลับ';
  setLoginError('');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('btn-login');
  const email = $('login-email').value.trim();
  const pw = $('login-password').value;
  setLoginError('');
  btn.disabled = true; btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  try {
    await auth.signInWithEmailAndPassword(email, pw);
  } catch (err) {
    logToScreen('❌ Login: ' + err.code, true);
    setLoginError(mapAuthErr(err.code));
    btn.disabled = false; btn.textContent = '🔓 เข้าสู่ระบบ';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('btn-signup');
  const name = $('su-shop-name').value.trim();
  const cat = $('su-category').value;
  const phone = $('su-phone').value.trim();
  const openTime = $('su-open-time').value || '07:00';
  const closeTime = $('su-close-time').value || '20:00';
  const address = $('su-address').value.trim();
  const email = $('su-email').value.trim();
  const pw1 = $('su-password').value;
  const pw2 = $('su-password2').value;

  setLoginError('');
  if (!name) return setLoginError('⚠️ กรุณากรอกชื่อร้าน');
  if (!cat) return setLoginError('⚠️ กรุณาเลือกประเภทร้าน');
  if (phone.replace(/\D/g, '').length < 9) return setLoginError('⚠️ เบอร์โทรไม่ถูกต้อง');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setLoginError('⚠️ อีเมลไม่ถูกต้อง');
  if (pw1.length < 6) return setLoginError('⚠️ รหัสผ่านอย่างน้อย 6 ตัวอักษร');
  if (pw1 !== pw2) return setLoginError('⚠️ รหัสผ่านไม่ตรงกัน');
  if (!$('gp-consent-check').checked) return setLoginError('⚠️ กรุณายอมรับเงื่อนไข GP 3%');

  btn.disabled = true; btn.textContent = '⏳ กำลังสมัคร...';
  let createdUser = null;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw1);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: name });

    const now = firebase.firestore.FieldValue.serverTimestamp();

    // ⭐ สร้างใน merchants
    await db.collection('merchants').doc(createdUser.uid).set({
      merchantId: createdUser.uid,
      name, category: cat, phone, address,
      openTime, closeTime,
      isOpen: false, verified: false,
      gpAccepted: true, gpAcceptedAt: now,
      gpFreeDays: GP_FREE_DAYS,
      totalSales: 0, totalGP: 0, totalOrders: 0,
      rating: 0, totalRatings: 0,
      achievements: [],
      createdAt: now,
      registeredVia: 'merchant.html'
    });

    // ⭐ สร้างใน users (สำหรับ Auth Guard)
    await db.collection('users').doc(createdUser.uid).set({
      role: 'merchant',
      name, email,
      createdAt: now
    });

    showToast('✅ สมัครสำเร็จ! รอแอดมินอนุมัติ', 'success');
  } catch (err) {
    logToScreen('❌ Signup: ' + err.code, true);
    if (createdUser) { try { await createdUser.delete(); } catch (e) {} }
    setLoginError(mapAuthErr(err.code));
    btn.disabled = false; btn.textContent = '🏪 สมัครร้านค้า';
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

function mapAuthErr(code) {
  return ({
    'auth/user-not-found': 'ไม่พบอีเมลนี้ในระบบ',
    'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
    'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง',
    'auth/email-already-in-use': 'อีเมลนี้ถูกใช้แล้ว',
    'auth/weak-password': 'รหัสผ่านอย่างน้อย 6 ตัวอักษร',
    'auth/too-many-requests': 'พยายามหลายครั้งเกินไป',
    'auth/network-request-failed': 'ไม่มีการเชื่อมต่อ'
  })[code] || 'เข้าสู่ระบบไม่สำเร็จ (' + code + ')';
}

async function handleMerchantLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeSheet('menu-sheet');
  if (unsubOrders) unsubOrders();
  if (unsubHistory) unsubHistory();
  if (unsubMenus) unsubMenus();
  if (unsubProfile) unsubProfile();
  if (activeChatUnsub) activeChatUnsub();
  await auth.signOut();
  allOrders = []; allHistory = []; myMenus = []; merchantProfile = null; seenOrderIds.clear();
}

// ═══════════════════════════════════════════════════════════════
//  5. INIT
// ═══════════════════════════════════════════════════════════════
function initApp() {
  updateHeader();
  updatePendingBanner();
  subscribeProfile();
  subscribeOrders();
  subscribeHistory();
  subscribeMenus();
  setupNetworkWatcher();
  setupPWAInstall();
  requestNotificationPermission();
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 3000);
  }
}

// ─── Profile ───
function subscribeProfile() {
  if (unsubProfile) unsubProfile();
  unsubProfile = db.collection('merchants').doc(currentUser.uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const prev = merchantProfile?.verified;
    merchantProfile = { uid: currentUser.uid, ...snap.data() };
    if (prev === false && merchantProfile.verified === true) {
      showToast('🎉 แอดมินอนุมัติแล้ว! เปิดร้านได้เลย', 'success');
      playNotificationSound();
    }
    updateHeader();
    updatePendingBanner();
  }, e => logToScreen('❌ Profile: ' + e.code, true));
}

function updateHeader() {
  if (!merchantProfile) return;
  $('shop-name').textContent = merchantProfile.name || 'ร้านค้า';
  const mid = merchantProfile.uid || merchantProfile.merchantId || '';
  $('shop-id-header').textContent = mid ? '🆔 ' + mid.slice(0, 12) + '...' : '';
  $('shop-id-full').textContent = mid || '—';
  updateShopToggle();
}

function updatePendingBanner() {
  $('pending-banner').classList.toggle('show', merchantProfile?.verified !== true);
}

function updateShopToggle() {
  const btn = $('shop-toggle-btn');
  const lbl = $('toggle-label');
  const st = $('shop-status');
  const isOpen = merchantProfile?.isOpen === true && merchantProfile?.verified === true;
  btn.classList.toggle('open', isOpen);
  btn.disabled = merchantProfile?.verified !== true;
  lbl.textContent = isOpen ? 'เปิดร้าน' : 'ปิดร้าน';
  st.textContent = merchantProfile?.verified !== true ? '⏳ รอการอนุมัติ' : (isOpen ? '🟢 เปิดรับออเดอร์' : '⚫ ปิดร้าน');
}

async function toggleShop() {
  if (!currentUser || merchantProfile?.verified !== true) {
    return showToast('⏳ รอแอดมินอนุมัติก่อน', 'warning');
  }
  const newState = !merchantProfile.isOpen;
  try {
    await db.collection('merchants').doc(currentUser.uid).update({
      isOpen: newState,
      toggledAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(newState ? '🟢 เปิดร้านรับออเดอร์แล้ว' : '⚫ ปิดร้านแล้ว', newState ? 'success' : 'info');
  } catch (e) {
    logToScreen('❌ Toggle: ' + e.message, true);
    showToast('เปลี่ยนสถานะไม่สำเร็จ', 'error');
  }
}

function copyShopId() {
  const mid = merchantProfile?.uid || merchantProfile?.merchantId || '';
  if (!mid) return showToast('❌ ไม่พบ Merchant ID', 'error');
  navigator.clipboard.writeText(mid).then(() => {
    showToast('📋 คัดลอก Merchant ID แล้ว', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = mid; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('📋 คัดลอกแล้ว', 'success'); } catch (e) {}
    document.body.removeChild(ta);
  });
}

function showShopInfo() {
  if (!merchantProfile) return;
  const verified = merchantProfile.verified ? '✅ อนุมัติแล้ว' : '⏳ รอการอนุมัติ';
  const gpStatus = isGPActive() ? '🟠 เริ่มคิด GP แล้ว' : '🟢 โปรโมชั่นฟรี GP';
  const mid = merchantProfile.uid || merchantProfile.merchantId || '—';
  alert(
    `🏪 ${merchantProfile.name || '-'}\n` +
    `🆔 Merchant ID:\n${mid}\n` +
    `📂 ประเภท: ${merchantProfile.category || '-'}\n` +
    `📱 เบอร์: ${merchantProfile.phone || '-'}\n` +
    `📍 ที่อยู่: ${merchantProfile.address || '-'}\n` +
    `⏰ เปิด: ${merchantProfile.openTime || '-'}-${merchantProfile.closeTime || '-'}\n` +
    `⭐ คะแนน: ${(merchantProfile.rating || 0).toFixed(1)} (${merchantProfile.totalRatings || 0} รีวิว)\n` +
    `📦 ออเดอร์ทั้งหมด: ${merchantProfile.totalOrders || 0}\n` +
    `💰 สถานะ: ${verified}\n` +
    `💸 GP: ${gpStatus}\n` +
    `⏰ เหลืออีก: ${gpDaysLeft()} วัน`
  );
}

// ─── Orders (Active) ───
function subscribeOrders() {
  if (unsubOrders) unsubOrders();
  unsubOrders = db.collection('orders')
    .where('merchantId', '==', currentUser.uid)
    .where('status', 'in', ['pending', 'accepted', 'cooking', 'ready', 'picked_up', 'on_the_way'])
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snap => {
      const prevIds = seenOrderIds;
      allOrders = snap.docs.map(d => {
        const x = d.data();
        return { id: d.id, ...x, createdAt: toDate(x.createdAt) };
      });

      const newOrders = allOrders.filter(o =>
        !prevIds.has(o.id) &&
        (o.status === 'pending' || o.merchantStatus === 'new') &&
        merchantProfile?.verified === true &&
        merchantProfile?.isOpen === true
      );

      if (newOrders.length > 0 && prevIds.size > 0) {
        const latest = newOrders[0];
        playNotificationSound();
        showNewOrderPopup(latest);
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('🔔 ออเดอร์ใหม่!', {
              body: `${latest.userName || 'ลูกค้า'} สั่งอาหาร`,
              icon: '/icons/icon-512.png',
              tag: 'new-order-' + latest.id
            });
          } catch (e) {}
        }
      }

      seenOrderIds = new Set(allOrders.map(o => o.id));
      renderOrders();
      updateStats();
      updateGP();
    }, err => {
      logToScreen('❌ Orders: ' + err.code, true);
      if (err.code === 'failed-precondition') showToast('⚠️ ต้องสร้าง Firestore Index', 'error');
    });
}

// ─── Orders (History) ───
function subscribeHistory() {
  if (unsubHistory) unsubHistory();
  unsubHistory = db.collection('orders')
    .where('merchantId', '==', currentUser.uid)
    .where('status', 'in', ['done', 'delivered', 'cancelled'])
    .orderBy('createdAt', 'desc')
    .limit(200)
    .onSnapshot(snap => {
      allHistory = snap.docs.map(d => {
        const x = d.data();
        return { id: d.id, ...x, createdAt: toDate(x.createdAt) };
      });
      renderHistory();
      updateStats();
      updateGP();
    }, err => logToScreen('❌ History: ' + err.code, true));
}

// ═══════════════════════════════════════════════════════════════
//  6. RENDER ORDERS
// ═══════════════════════════════════════════════════════════════
function renderOrders() {
  const newOrders = allOrders.filter(o => (o.status === 'pending' || o.merchantStatus === 'new'));
  const cookingOrders = allOrders.filter(o => o.merchantStatus === 'cooking' || (o.status === 'accepted' && o.merchantStatus !== 'ready'));
  const readyOrders = allOrders.filter(o => o.merchantStatus === 'ready');

  $('cnt-new').textContent = newOrders.length;
  $('cnt-cooking').textContent = cookingOrders.length + readyOrders.length;
  $('cnt-done').textContent = allHistory.filter(o => isToday(o.createdAt)).length;

  const navBadge = $('nav-orders-badge');
  if (newOrders.length > 0) {
    navBadge.style.display = 'flex';
    navBadge.textContent = newOrders.length;
  } else navBadge.style.display = 'none';

  $('new-orders-list').innerHTML = newOrders.map(o => renderOrderCard(o, 'new')).join('');
  $('cooking-orders-list').innerHTML = [...cookingOrders, ...readyOrders].map(o => renderOrderCard(o, 'cooking')).join('');
  $('done-orders-list').innerHTML = allHistory.filter(o => isToday(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done')).slice(0, 15).map(o => renderOrderCard(o, 'done')).join('');

  $('orders-empty').style.display = (allOrders.length + allHistory.length) > 0 ? 'none' : 'block';
}

function renderOrderCard(o, type) {
  const isNew = type === 'new';
  const statusCls = o.merchantStatus || o.status;
  const statusLabel = {
    pending: '🔔 ใหม่', accepted: '🍳 กำลังทำ', cooking: '🍳 กำลังทำ',
    ready: '✅ พร้อมส่ง', picked_up: '📦 ไรเดอร์รับแล้ว', on_the_way: '🚀 กำลังส่ง', done: '✅ เสร็จสิ้น'
  }[statusCls] || o.status;
  const statusBadge = {
    pending: 'pending', accepted: 'cooking', cooking: 'cooking', ready: 'ready',
    picked_up: 'done', on_the_way: 'done', done: 'done'
  }[statusCls] || 'done';

  let itemsList = '';
  if (Array.isArray(o.items)) {
    itemsList = o.items.map(it => `
      <div class="item-row">
        <span class="qty">×${it.qty || 1}</span>
        <span class="item-name">${esc(it.name || '—')}</span>
        <span class="item-price">${fmt(Number(it.price || 0) * Number(it.qty || 1))}฿</span>
      </div>`).join('');
  } else if (typeof o.items === 'string') {
    itemsList = `<div class="item-row"><span class="item-name">${esc(o.items)}</span></div>`;
  }

  let actionBtns = '';
  if (isNew || o.status === 'pending') {
    actionBtns = `<div class="order-actions two">
      <button class="order-btn btn-accept ripple" onclick="acceptOrder('${jsStr(o.id)}')">✅ รับออเดอร์</button>
      <button class="order-btn btn-reject ripple" onclick="rejectOrder('${jsStr(o.id)}')">✕ ปฏิเสธ</button>
    </div>`;
  } else if (o.merchantStatus === 'cooking') {
    actionBtns = `<button class="order-btn btn-ready ripple" onclick="markReady('${jsStr(o.id)}')">📦 อาหารพร้อม — แจ้งไรเดอร์</button>`;
  } else if (o.merchantStatus === 'ready') {
    actionBtns = `<button class="order-btn btn-done ripple" onclick="markDone('${jsStr(o.id)}')">✅ ส่งของแล้ว</button>`;
  }

  const hasSlip = o.riderSlipUrl;
  const slipBadge = hasSlip ? (o.riderSlipVerified ? '<span class="status-badge done" style="background:#dcfce7;color:#16a34a">📸 ✅ สลิปแล้ว</span>' : '<span class="status-badge pending" style="background:#FFF3E0;color:#E65100">📸 รอสลิป</span>') : '';

  return `<div class="order-card status-${statusBadge} ${isNew ? 'is-new' : ''}">
    <div class="order-top">
      <div class="order-emoji">🍽️</div>
      <div class="order-top-info">
        <div class="order-title">
          ${isNew ? '<span class="new-tag">ใหม่!</span>' : ''}
          <span>#${String(o.id).slice(-6).toUpperCase()}</span>
          <span class="oid">${fmtTime(o.createdAt)}</span>
        </div>
        <div class="order-sub">👤 ${esc(o.userName || 'ลูกค้า')}</div>
        ${slipBadge}
      </div>
      <span class="status-badge ${statusBadge}">${statusLabel}</span>
    </div>
    <div class="customer-box">
      <div class="cname">👤 ${esc(o.userName || 'ลูกค้า')}</div>
      <div class="cphone">${o.userPhone ? `<a href="tel:${esc(o.userPhone)}">📞 ${esc(o.userPhone)}</a>` : '📞 ไม่มีเบอร์'}</div>
      ${o.address ? `<div class="caddr">📍 ${esc(o.address.slice(0, 60))}</div>` : ''}
    </div>
    <div class="items-list">
      <div class="items-title">📝 รายการอาหาร</div>
      ${itemsList}
    </div>
    ${o.note ? `<div class="order-note">📌 ${esc(o.note)}</div>` : ''}
    <div class="order-money">
      <div>
        <div class="lbl">💰 ยอดรวม</div>
        <div class="gp">GP 3%: ${fmt(calcGP(Number(o.total || o.price || 0)).total)}฿</div>
      </div>
      <div class="amt">${fmt(o.total || o.price || 0)}฿</div>
    </div>
    ${actionBtns}
    <div class="order-time-bar">
      <span>🕐 ${fmtTime(o.createdAt)}</span>
      <button onclick="showOrderDetail('${jsStr(o.id)}')" style="background:none;border:none;color:var(--brand);font-weight:900;font-size:11px;cursor:pointer;font-family:inherit;padding:4px 8px">ดูรายละเอียด →</button>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  7. ORDER DETAIL
// ═══════════════════════════════════════════════════════════════
function showOrderDetail(orderId) {
  const o = allOrders.find(x => x.id === orderId) || allHistory.find(x => x.id === orderId);
  if (!o) return;

  const cut = calcGP(Number(o.total || o.price || 0));
  const statusLabel = {
    pending: '🔔 รอยืนยัน', accepted: '🍳 รับออเดอร์', cooking: '🍳 กำลังทำ',
    ready: '✅ พร้อมส่ง', picked_up: '📦 ไรเดอร์รับ', on_the_way: '🚀 กำลังส่ง',
    done: '✅ เสร็จสิ้น', cancelled: '❌ ยกเลิก'
  }[o.status] || o.status;

  let itemsHtml = '';
  if (Array.isArray(o.items)) {
    itemsHtml = o.items.map(it => `
      <div class="item-row">
        <span class="qty">×${it.qty || 1}</span>
        <span class="item-name">${esc(it.name || '—')}</span>
        <span class="item-price">${fmt(Number(it.price || 0) * Number(it.qty || 1))}฿</span>
      </div>`).join('');
  }

  const slipHtml = o.riderSlipUrl ? `
    <div class="slip-view">
      <div class="title">📸 สลิปโอนเงินจากไรเดอร์</div>
      ${o.riderSlipVerified ? '<div style="color:#166534;font-weight:800;font-size:12px">✅ ตรวจสอบแล้ว</div>' : '<div style="color:#E65100;font-weight:800;font-size:12px">⏳ รอตรวจสอบ</div>'}
      <img src="${esc(o.riderSlipUrl)}" onclick="window.open('${esc(o.riderSlipUrl)}','_blank')">
    </div>` : '';

  $('order-detail-content').innerHTML = `
    <div style="background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-weight:900;font-size:15px;margin-bottom:6px">${statusLabel}</div>
      <div style="font-size:12px;color:#6B7280;font-weight:700">🆔 ${esc(o.id)}</div>
      <div style="font-size:12px;color:#6B7280;font-weight:700">🕐 ${fmtDateTime(o.createdAt)}</div>
    </div>

    <div class="customer-box">
      <div class="cname">👤 ${esc(o.userName || 'ลูกค้า')}</div>
      <div class="cphone">${o.userPhone ? `<a href="tel:${esc(o.userPhone)}">📞 ${esc(o.userPhone)}</a>` : '📞 ไม่มีเบอร์'}</div>
      ${o.address ? `<div class="caddr">📍 ${esc(o.address)}</div>` : ''}
    </div>

    <div class="items-list">
      <div class="items-title">📝 รายการอาหาร</div>
      ${itemsHtml || '<p style="color:#999;font-size:12px">ไม่มีรายการ</p>'}
    </div>

    ${o.note ? `<div class="order-note">📌 ${esc(o.note)}</div>` : ''}

    <div class="order-money">
      <div>
        <div class="lbl">💰 ยอดรวม</div>
        <div class="gp">GP 3%: ${fmt(cut.total)}฿</div>
      </div>
      <div class="amt">${fmt(o.total || o.price || 0)}฿</div>
    </div>

    ${slipHtml}

    ${o.riderName ? `<div style="background:#E3F2FD;border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:900;color:#1565C0">🛵 ไรเดอร์: ${esc(o.riderName)}</div>
      ${o.riderPhone ? `<div style="font-size:12px;color:#1976D2;font-weight:700">📞 ${esc(o.riderPhone)}</div>` : ''}
    </div>` : ''}
  `;

  let actions = '';
  if (o.status === 'pending') {
    actions = `<div class="order-actions two">
      <button class="order-btn btn-accept ripple" onclick="acceptOrder('${jsStr(o.id)}');closeSheet('order-detail-sheet')">✅ รับออเดอร์</button>
      <button class="order-btn btn-reject ripple" onclick="rejectOrder('${jsStr(o.id)}');closeSheet('order-detail-sheet')">✕ ปฏิเสธ</button>
    </div>`;
  } else if (o.merchantStatus === 'cooking') {
    actions = `<button class="order-btn btn-ready ripple" onclick="markReady('${jsStr(o.id)}');closeSheet('order-detail-sheet')" style="width:100%">📦 อาหารพร้อม</button>`;
  } else if (o.riderId && ['accepted','picked_up','on_the_way','ready'].includes(o.status)) {
    actions = `<button class="order-btn btn-chat ripple" onclick="openChatWithRider('${jsStr(o.id)}')" style="width:100%">💬 แชทกับไรเดอร์</button>`;
  }
  $('order-detail-actions').innerHTML = actions;
  openSheet('order-detail-sheet');
}

// ═══════════════════════════════════════════════════════════════
//  8. UPDATE STATS
// ═══════════════════════════════════════════════════════════════
function updateStats() {
  const todayDone = allHistory.filter(o => isToday(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done'));
  const yesterdayDone = allHistory.filter(o => isYesterday(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done'));
  const newCount = allOrders.filter(o => o.status === 'pending' || o.merchantStatus === 'new').length;
  const cookingCount = allOrders.filter(o => ['accepted', 'cooking', 'ready', 'picked_up', 'on_the_way'].includes(o.status)).length;

  const todayRev = todayDone.reduce((s, o) => s + Number(o.total || o.price || 0), 0);
  const yesterdayRev = yesterdayDone.reduce((s, o) => s + Number(o.total || o.price || 0), 0);
  const todayGP = todayDone.reduce((s, o) => s + calcGP(Number(o.total || o.price || 0)).total, 0);

  $('hero-revenue').textContent = fmt(todayRev) + '฿';
  $('hero-sub').innerHTML = `📦 ${todayDone.length} ออเดอร์ • ⏱️ ${merchantProfile?.openTime || '—'}-${merchantProfile?.closeTime || '—'}`;

  const changeEl = $('hero-change');
  if (yesterdayRev > 0) {
    const change = Math.round((todayRev - yesterdayRev) / yesterdayRev * 100);
    changeEl.textContent = `${change >= 0 ? '📈 +' : '📉 '}${change}% เทียบเมื่อวาน`;
    changeEl.className = 'hero-change ' + (change >= 0 ? 'up' : 'down');
  } else if (todayRev > 0) {
    changeEl.textContent = '📈 +100% เทียบเมื่อวาน';
    changeEl.className = 'hero-change up';
  } else {
    changeEl.textContent = '— เทียบเมื่อวาน';
    changeEl.className = 'hero-change';
  }

  $('stat-new').textContent = newCount;
  $('stat-cooking').textContent = cookingCount;
  $('stat-done').textContent = todayDone.length;
  $('stat-gp').textContent = fmt(todayGP) + '฿';
}

// ═══════════════════════════════════════════════════════════════
//  9. UPDATE GP
// ═══════════════════════════════════════════════════════════════
function updateGP() {
  const todayDone = allHistory.filter(o => isToday(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done'));
  const todaySales = todayDone.reduce((s, o) => s + Number(o.total || o.price || 0), 0);
  const todayGP = calcGP(todaySales);

  $('gp-today-sales').textContent = fmt(todaySales) + '฿';
  $('gp-today-total').textContent = fmt(todayGP.total) + '฿';
  $('gp-today-rider').textContent = fmt(todayGP.rider) + '฿';
  $('gp-today-platform').textContent = fmt(todayGP.platform) + '฿';
  $('gp-today-net').textContent = fmt(todaySales - todayGP.total) + '฿';

  // 7 days
  const weekDone = allHistory.filter(o => isThisWeek(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done'));
  const weekSales = weekDone.reduce((s, o) => s + Number(o.total || o.price || 0), 0);
  const weekGP = calcGP(weekSales);
  $('gp-week-sales').textContent = fmt(weekSales) + '฿';
  $('gp-week-total').textContent = fmt(weekGP.total) + '฿';

  // Month
  const monthDone = allHistory.filter(o => isThisMonth(o.createdAt) && (o.status === 'done' || o.merchantStatus === 'done'));
  const monthSales = monthDone.reduce((s, o) => s + Number(o.total || o.price || 0), 0);
  const monthGP = calcGP(monthSales);
  const avg = monthDone.length > 0 ? (monthSales / monthDone.length) : 0;

  $('gp-month').textContent = fmt(monthGP.total) + '฿';
  $('gp-month-sub').textContent = `จากยอดขาย ${fmt(monthSales)}฿`;
  $('gp-month-orders').textContent = monthDone.length + ' รายการ';
  $('gp-month-sales').textContent = fmt(monthSales) + '฿';
  $('gp-month-total').textContent = fmt(monthGP.total) + '฿';
  $('gp-month-net').textContent = fmt(monthSales - monthGP.total) + '฿';
  $('gp-month-avg').textContent = fmt(avg) + '฿';

  const daysLeft = gpDaysLeft();
  if (isGPActive()) {
    $('gp-countdown').innerHTML = `
      <div class="days" style="color:#C62828">✓</div>
      <div class="txt">
        <div class="t1" style="color:#C62828">⏰ เริ่มคิด GP 3% แล้ว</div>
        <div class="t2" style="color:#B71C1C">GP ถูกหักอัตโนมัติ</div>
      </div>`;
  } else {
    $('gp-days-left').textContent = daysLeft;
  }
}

// ═══════════════════════════════════════════════════════════════
//  10. ORDER ACTIONS
// ═══════════════════════════════════════════════════════════════
async function acceptOrder(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'accepted',
      merchantStatus: 'cooking',
      merchantAcceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ รับออเดอร์แล้ว', 'success');
    closeNewOrderPopup();
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

async function rejectOrder(orderId) {
  const reason = prompt('ระบุเหตุผลที่ปฏิเสธ:', '');
  if (reason === null) return;
  try {
    await db.collection('orders').doc(orderId).update({
      status: 'cancelled',
      merchantStatus: 'rejected',
      rejectReason: reason || 'ร้านปฏิเสธ',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✕ ปฏิเสธแล้ว', 'info');
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

async function markReady(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({
      merchantStatus: 'ready',
      status: 'accepted',
      readyAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ อาหารพร้อม — รอไรเดอร์', 'success');
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

async function markDone(orderId) {
  try {
    const order = allOrders.find(o => o.id === orderId);
    const total = Number(order?.total || order?.price || 0);
    const gp = calcGP(total);
    await db.collection('orders').doc(orderId).update({
      merchantStatus: 'done',
      merchantDoneAt: firebase.firestore.FieldValue.serverTimestamp(),
      gpAmount: gp.total, gpRider: gp.rider, gpPlatform: gp.platform
    });
    showToast('📦 ส่งให้ไรเดอร์แล้ว', 'success');
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

// ═══════════════════════════════════════════════════════════════
//  11. NEW ORDER POPUP
// ═══════════════════════════════════════════════════════════════
function showNewOrderPopup(o) {
  newPopupOrderId = o.id;
  let itemsHtml = '';
  if (Array.isArray(o.items)) {
    itemsHtml = o.items.map(it => `<div>${esc(it.name)} × ${it.qty || 1} = <strong>${fmt(Number(it.price || 0) * Number(it.qty || 1))}฿</strong></div>`).join('');
  }
  $('new-order-detail').innerHTML = `
    <div>👤 <strong>${esc(o.userName || 'ลูกค้า')}</strong></div>
    <div>📞 <strong>${esc(o.userPhone || '—')}</strong></div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ddd">${itemsHtml}</div>
    <div style="margin-top:8px;color:var(--brand);font-weight:900;font-size:18px">💰 รวม ${fmt(o.total || o.price || 0)}฿</div>`;
  $('new-order-popup').classList.add('active');
}
function closeNewOrderPopup() {
  $('new-order-popup').classList.remove('active');
  newPopupOrderId = null;
}
function acceptFromPopup() {
  if (newPopupOrderId) acceptOrder(newPopupOrderId);
}

// ═══════════════════════════════════════════════════════════════
//  12. MENUS
// ═══════════════════════════════════════════════════════════════
function subscribeMenus() {
  if (unsubMenus) unsubMenus();
  unsubMenus = db.collection('menus')
    .where('merchantId', '==', currentUser.uid)
    .onSnapshot(snap => {
      myMenus = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '', 'th'));
      renderMenus();
    }, e => logToScreen('❌ Menus: ' + e.code, true));
}

function renderMenus() {
  const list = $('menu-list');
  const availCount = myMenus.filter(m => m.isAvailable !== false).length;
  $('menu-count-text').textContent = `${myMenus.length} เมนู (${availCount} พร้อมขาย)`;

  if (!myMenus.length) {
    list.innerHTML = '';
    $('menus-empty').style.display = 'block';
    return;
  }
  $('menus-empty').style.display = 'none';

  list.innerHTML = myMenus.map(m => {
    const isOff = m.isAvailable === false;
    return `<div class="menu-card ${isOff ? 'off' : ''}">
      <div class="menu-img-wrap">
        ${m.image ? `<img src="${esc(m.image)}" loading="lazy" onerror="this.style.display='none'">` : (CAT_ICONS[m.category] || '🍽️')}
        <span class="menu-status-badge ${isOff ? 'off' : 'on'}">${isOff ? 'ปิด' : 'ขาย'}</span>
      </div>
      <div class="menu-card-body">
        <div class="menu-card-name">${esc(m.name || '—')}</div>
        <div class="menu-card-cat">${CAT_ICONS[m.category] || '📦'} ${CAT_LABELS[m.category] || 'อื่นๆ'}</div>
        <div class="menu-card-price">${fmt(m.price)}฿</div>
        <div class="menu-card-actions">
          <button class="menu-act-btn edit ripple" onclick="openMenuForm('${jsStr(m.id)}')">✏️</button>
          <button class="menu-act-btn toggle ripple" onclick="toggleMenuAvail('${jsStr(m.id)}')">${isOff ? 'เปิด' : 'ปิด'}</button>
          <button class="menu-act-btn del ripple" onclick="deleteMenu('${jsStr(m.id)}')">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openMenuForm(menuId) {
  editingMenuId = menuId || null;
  menuImgFile = null;
  currentMenuImageUrl = null;
  const area = $('img-upload-area');
  const preview = $('img-preview');

  if (menuId) {
    const m = myMenus.find(x => x.id === menuId);
    if (!m) return;
    $('menu-form-title').textContent = '✏️ แก้ไขเมนู';
    $('mf-name').value = m.name || '';
    $('mf-price').value = m.price || '';
    $('mf-category').value = m.category || 'main';
    $('mf-desc').value = m.description || '';
    if (m.image) {
      currentMenuImageUrl = m.image;
      preview.src = m.image;
      preview.style.display = 'block';
      area.classList.add('has-img');
    } else {
      preview.style.display = 'none';
      area.classList.remove('has-img');
    }
  } else {
    $('menu-form-title').textContent = '➕ เพิ่มเมนูใหม่';
    $('mf-name').value = '';
    $('mf-price').value = '';
    $('mf-category').value = 'main';
    $('mf-desc').value = '';
    preview.style.display = 'none';
    area.classList.remove('has-img');
  }
  openSheet('menu-form-sheet');
}

function previewMenuImg(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_IMG_SIZE) return showToast('⚠️ รูปใหญ่เกิน 5MB', 'warning');
  menuImgFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = $('img-preview');
    preview.src = ev.target.result;
    preview.style.display = 'block';
    $('img-upload-area').classList.add('has-img');
  };
  reader.readAsDataURL(file);
}

function removeMenuImg() {
  menuImgFile = null;
  currentMenuImageUrl = null;
  $('img-preview').style.display = 'none';
  $('img-upload-area').classList.remove('has-img');
  $('menu-img-input').value = '';
}

async function saveMenu() {
  if (!currentUser) return;
  const btn = $('btn-save-menu');
  const name = $('mf-name').value.trim();
  const price = parseFloat($('mf-price').value);
  const category = $('mf-category').value;
  const description = $('mf-desc').value.trim();

  if (!name) return showToast('⚠️ กรอกชื่อเมนู', 'warning');
  if (!price || price <= 0) return showToast('⚠️ กรอกราคา', 'warning');

  btn.disabled = true; const orig = btn.textContent;
  btn.textContent = '⏳ กำลังบันทึก...';

  try {
    let imageUrl = currentMenuImageUrl || '';
    if (menuImgFile) {
      try {
        const blob = await compressImage(menuImgFile, 800, 0.75);
        const ref = storage.ref(`menus/${currentUser.uid}/${Date.now()}.jpg`);
        const snap = await ref.put(blob);
        imageUrl = await snap.ref.getDownloadURL();
      } catch (uploadErr) {
        logToScreen('⚠️ Upload: ' + uploadErr.message, true);
      }
    }

    const data = {
      merchantId: currentUser.uid,
      merchantName: merchantProfile?.name || '',
      name, price, category, description,
      image: imageUrl,
      isAvailable: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (editingMenuId) {
      await db.collection('menus').doc(editingMenuId).update(data);
      showToast('✅ อัปเดตเมนูแล้ว', 'success');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('menus').add(data);
      showToast('✅ เพิ่มเมนูแล้ว', 'success');
    }
    closeSheet('menu-form-sheet');
  } catch (e) {
    logToScreen('❌ SaveMenu: ' + e.message, true);
    showToast('❌ บันทึกไม่สำเร็จ', 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function toggleMenuAvail(menuId) {
  const m = myMenus.find(x => x.id === menuId);
  if (!m) return;
  const newState = m.isAvailable === false;
  try {
    await db.collection('menus').doc(menuId).update({
      isAvailable: newState,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(newState ? '🟢 เปิดขาย' : '🔴 ปิดขาย', 'success');
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

async function deleteMenu(menuId) {
  const m = myMenus.find(x => x.id === menuId);
  if (!m) return;
  if (!confirm(`ลบ "${m.name}" ?`)) return;
  try {
    await db.collection('menus').doc(menuId).delete();
    showToast('🗑️ ลบแล้ว', 'info');
  } catch (e) { showToast('❌ ไม่สำเร็จ', 'error'); }
}

// ═══════════════════════════════════════════════════════════════
//  13. HISTORY
// ═══════════════════════════════════════════════════════════════
function filterHistory(filter, el) {
  currentHistoryFilter = filter;
  document.querySelectorAll('[data-history]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderHistory();
}

function renderHistory() {
  let filtered = allHistory;
  if (currentHistoryFilter === 'today') filtered = allHistory.filter(o => isToday(o.createdAt));
  else if (currentHistoryFilter === 'week') filtered = allHistory.filter(o => isThisWeek(o.createdAt));
  else if (currentHistoryFilter === 'month') filtered = allHistory.filter(o => isThisMonth(o.createdAt));

  $('history-count').textContent = filtered.length;

  if (!filtered.length) {
    $('history-list').innerHTML = '<div class="empty-state"><div class="icon">📜</div><h4>ไม่มีประวัติ</h4><p>ยังไม่มีออเดอร์ในช่วงเวลานี้</p></div>';
    return;
  }

  $('history-list').innerHTML = filtered.slice(0, 100).map(o => {
    const isCancelled = o.status === 'cancelled';
    return `<div class="order-card" style="border-left-color:${isCancelled ? '#ccc' : '#00A651'};cursor:pointer" onclick="showOrderDetail('${jsStr(o.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:900">#${String(o.id).slice(-6).toUpperCase()}</div>
        <div style="font-size:16px;font-weight:900;color:${isCancelled ? '#999' : 'var(--brand)'}">${fmt(o.total || o.price || 0)}฿</div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700">
        🕐 ${fmtDateTime(o.createdAt)} • 👤 ${esc(o.userName || 'ลูกค้า')}
      </div>
      <div style="font-size:11px;font-weight:800;margin-top:4px;color:${isCancelled ? '#999' : '#00A651'}">
        ${isCancelled ? '❌ ยกเลิก' : '✅ เสร็จสิ้น'}
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  14. CHAT WITH RIDER
// ═══════════════════════════════════════════════════════════════
async function openChatWithRider(orderId) {
  const order = allOrders.find(o => o.id === orderId) || allHistory.find(o => o.id === orderId);
  if (!order || !order.riderId) return;

  const chatId = order.chatId || `chat_${[order.merchantId, order.riderId].sort().join('_')}`;
  activeChatId = chatId;

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const snap = await chatRef.get();
    if (!snap.exists) {
      await chatRef.set({
        participantIds: [currentUser.uid, order.riderId].filter(Boolean),
        participants: [
          { uid: currentUser.uid, name: merchantProfile.name, role: 'merchant' },
          { uid: order.riderId, name: order.riderName || 'ไรเดอร์', role: 'rider' }
        ],
        type: 'rider_merchant',
        lastMessage: 'เริ่มสนทนา',
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) { console.warn(e); }

  $('chatName').textContent = order.riderName || 'ไรเดอร์';
  $('chatSub').textContent = `#${String(order.id).slice(-6).toUpperCase()}`;
  $('chatContainer').classList.add('show');
  closeSheet('order-detail-sheet');

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
  if (!msgs.length) {
    el.innerHTML = '<div class="chat-empty">เริ่มสนทนา</div>';
    return;
  }
  let lastDay = '';
  el.innerHTML = msgs.map(m => {
    const isMine = m.senderId === currentUser.uid || m.senderRole === 'merchant';
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
      senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: `[ร้าน] ${text}`,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { showToast('ส่งไม่สำเร็จ', 'error'); }
}

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > MAX_IMG_SIZE) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');
  try {
    const blob = await compressImage(file, 800, 0.75);
    const ref = storage.ref(`chats/${activeChatId}/${Date.now()}.jpg`);
    await ref.put(blob);
    const url = await ref.getDownloadURL();
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url,
      senderId: currentUser.uid,
      senderRole: 'merchant',
      senderName: merchantProfile.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '[ร้าน] 📷 รูปภาพ',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งรูปแล้ว', 'success');
  } catch (e) { showToast('อัปโหลดไม่สำเร็จ', 'error'); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ═══════════════════════════════════════════════════════════════
//  15. NETWORK & PWA
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
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = $('pwaBanner');
    if (banner && !localStorage.getItem('pwa_dismissed')) {
      banner.classList.remove('hidden');
    }
  });
  window.addEventListener('appinstalled', () => {
    logToScreen('✅ PWA ติดตั้งแล้ว');
    $('pwaBanner').classList.add('hidden');
  });
}

async function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      showToast('✅ ติดตั้งสำเร็จ', 'success');
      $('pwaBanner').classList.add('hidden');
    }
    deferredPrompt = null;
  } else {
    showToast('เปิดเมนู → "เพิ่มไปที่หน้าจอหลัก"', 'info');
  }
}

function hidePWABanner() {
  $('pwaBanner').classList.add('hidden');
  localStorage.setItem('pwa_dismissed', '1');
}

// ═══════════════════════════════════════════════════════════════
//  16. TAB SWITCHING
// ═══════════════════════════════════════════════════════════════
function switchTab(tabId, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  $('tab-' + tabId).classList.add('active');
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

// ═══════════════════════════════════════════════════════════════
//  17. HAPTIC
// ═══════════════════════════════════════════════════════════════
document.addEventListener('click', (e) => {
  const el = e.target.closest('button, .nav-tab, .order-btn, .menu-act-btn');
  if (el && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// ═══════════════════════════════════════════════════════════════
//  18. INIT LOG
// ═══════════════════════════════════════════════════════════════
console.log('%c🏪 Chauat Go Merchant v3.3.3', 'color:#00A651;font-weight:900;font-size:16px');
console.log('%c✓ PWA | ✓ Merchant ID | ✓ Slip Verify | ✓ Chat | ✓ History', 'color:#4A90D9;font-weight:700');