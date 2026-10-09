/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO ADMIN — v3.4.8
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
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('persistence:', e.code));

/* ═══════════════════════════════════════════════════════════════════
   2. GLOBAL STATE
   ═══════════════════════════════════════════════════════════════════ */
const store = {
  merchants: [], orders: [], riders: [], users: [], places: [],
  chats: [], gpTransfers: [], riders: []
};
const filters = {
  orders: 'all', q: '', riderStatus: '',
  merchantStatus: 'all', gpRange: 'today'
};
let current = 'dashboard';
let unsubs = [];
let activeChatId = null;
let activeChatUnsub = null;
let deferredPrompt = null;
let audioCtx = null;
let seenNewOrders = new Set();
let lastOrderCount = 0;

/* Master admin emails — bypass role check */
const MASTER_ADMINS = [
  'adminchauatgo@gmail.com',
  'admin@chauatgo.com',
  'chauatgo@gmail.com'
];

/* GP constants — v3.4.8 */
const GP_MAIN_RATE = 0.20;      // 20% ของค่าบริการ (ไรเดอร์ 80/แอป 20)
const GP_STORE_RATE = 0.03;     // 3% ของยอดอาหาร (ร้านค้าโอน)
const GP_RIDER_SHARE = 0.02;    // 2% ให้ไรเดอร์
const GP_PLATFORM_SHARE = 0.01; // 1% ให้แพลตฟอร์ม

const SECTIONS = [
  ['dashboard', '📊', 'แดชบอร์ด'],
  ['orders', '📋', 'ออเดอร์'],
  ['merchants', '🏪', 'ร้านค้า'],
  ['riders', '🛵', 'ไรเดอร์'],
  ['gp', '💰', 'GP'],
  ['gpTransfers', '📸', 'สลิป GP'],
  ['payouts', '💸', 'โอนไรเดอร์'],
  ['chats', '💬', 'แชท'],
  ['users', '👥', 'ผู้ใช้']
];

const STATUS = {
  searching: '⏳ หาไรเดอร์', pending: '🔔 รอรับ', accepted: '🛵 รับแล้ว',
  cooking: '🍳 กำลังทำ', ready: '✅ พร้อมส่ง', picked_up: '📦 รับของ',
  on_the_way: '🚀 กำลังส่ง', delivered: '✅ สำเร็จ', done: '✅ เสร็จ',
  cancelled: '❌ ยกเลิก'
};

/* ═══════════════════════════════════════════════════════════════════
   3. HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmt = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const toDate = t => {
  if (!t) return null;
  const d = t.toDate ? t.toDate() : new Date(t);
  return isNaN(d) ? null : d;
};

const fmtTime = t => {
  const d = toDate(t);
  return d ? d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};

const fmtTimeShort = t => {
  const d = toDate(t);
  return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
};

const ts = o => o.createdAt?.seconds || 0;

const isToday = t => {
  const d = toDate(t);
  if (!d) return false;
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return d >= n;
};

const isWeek = t => {
  const d = toDate(t);
  return d ? d >= new Date(Date.now() - 7 * 86400000) : false;
};

const isMonth = t => {
  const d = toDate(t);
  if (!d) return false;
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
};

const itemsText = i => Array.isArray(i)
  ? i.map(x => `${x.name} x${x.qty}`).join(', ')
  : String(i ?? '');

const debugLog = (msg, isError) => {
  if (typeof window.CHAUAT_ADMIN_DEBUG !== 'undefined' && window.CHAUAT_ADMIN_DEBUG) {
    if (isError) console.warn(msg); else console.log(msg);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   4. THEME
   ═══════════════════════════════════════════════════════════════════ */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('chauat_admin_theme', next);
  const fab = $('theme-fab');
  if (fab) fab.textContent = next === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#0F1419' : '#76B82A';
  showToast(next === 'dark' ? '🌙 โหมดมืด' : '☀️ โหมดสว่าง', 'info');
}

function initTheme() {
  const theme = localStorage.getItem('chauat_admin_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const fab = $('theme-fab');
  if (fab) fab.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ═══════════════════════════════════════════════════════════════════
   5. SPLASH
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
   6. TOAST & SOUND
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
  playTone([880, 1108, 1318], 0.15, 0.15, 0.35);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

/* ═══════════════════════════════════════════════════════════════════
   7. FINANCE — GP formulas
   ═══════════════════════════════════════════════════════════════════ */
function calcMainGp(fare) {
  // GP หลัก = 20% ของค่าบริการ
  const f = Number(fare || 0);
  return {
    fare: f,
    rider: Math.round(f * (1 - GP_MAIN_RATE) * 100) / 100,
    platform: Math.round(f * GP_MAIN_RATE * 100) / 100
  };
}

function calcStoreGp(foodTotal) {
  // GP จากร้านค้า = 3% ของยอดอาหาร
  const f = Number(foodTotal || 0);
  return {
    foodTotal: f,
    total: Math.round(f * GP_STORE_RATE * 100) / 100,
    rider: Math.round(f * GP_RIDER_SHARE * 100) / 100,
    platform: Math.round(f * GP_PLATFORM_SHARE * 100) / 100
  };
}

function orderFoodTotal(o) {
  return Number(o.itemsTotal || o.foodTotal || 0);
}

/* ═══════════════════════════════════════════════════════════════════
   8. AUTH
   ═══════════════════════════════════════════════════════════════════ */
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login')?.classList.toggle('active', isLogin);
  $('tab-signup')?.classList.toggle('active', !isLogin);
  const lf = $('form-login'), sf = $('form-signup');
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
      'auth/user-not-found': 'ไม่พบบัญชีนี้',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป'
    }[err.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    $('login-error').textContent = msg;
    showToast(msg, 'error');
    btn.disabled = false;
    btn.textContent = '🔓 เข้าสู่ระบบ';
  }
  const pwEl = $('login-password');
  if (pwEl) pwEl.value = '';
}

async function handleForgotPassword() {
  const email = $('login-email').value.trim();
  if (!email) return showToast('กรอกอีเมลก่อน', 'error');
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว');
  } catch (err) { showToast('ส่งไม่สำเร็จ', 'error'); }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = $('btn-signup');
  const name = $('su-name').value.trim();
  const email = $('su-email').value.trim().toLowerCase();
  const pw = $('su-password').value;
  const pw2 = $('su-password2').value;

  if (!name) return showToast('กรอกชื่อ', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('อีเมลไม่ถูกต้อง', 'error');
  if (pw.length < 6) return showToast('รหัสผ่าน 6+ ตัว', 'error');
  if (pw !== pw2) return showToast('รหัสไม่ตรงกัน', 'error');

  btn.disabled = true;
  btn.textContent = '⏳ กำลังสมัคร...';
  let createdUser = null;

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    createdUser = cred.user;
    await createdUser.updateProfile({ displayName: name });

    await db.collection('users').doc(createdUser.uid).set({
      role: 'admin',
      name, email,
      isPending: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast('✅ สมัครสำเร็จ! รอ Master Admin อนุมัติ');
    switchAuthTab('login');
    $('login-email').value = email;
  } catch (err) {
    if (createdUser) { try { await createdUser.delete(); } catch (e) {} }
    showToast('สมัครไม่สำเร็จ: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✅ สมัครสมาชิก';
  }
}

async function handleLogout() {
  if (!confirm('ออกจากระบบ?')) return;
  closeMenu();
  stop();
  await auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════════
   9. AUTH STATE
   ═══════════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(async user => {
  stop();
  if (!user) {
    $('login-screen').classList.remove('hidden');
    $('app').classList.add('hidden');
    return;
  }

  const userEmail = (user.email || '').toLowerCase().trim();
  const isMaster = MASTER_ADMINS.includes(userEmail);

  // ตรวจ role admin (ถ้าไม่ใช่ master)
  if (!isMaster) {
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      const isAdmin = snap.exists && snap.data().role === 'admin' && !snap.data().isPending;
      if (!isAdmin) {
        showToast('บัญชีนี้ไม่มีสิทธิ์', 'error');
        await auth.signOut();
        return;
      }
    } catch (err) {
      showToast('ตรวจสอบสิทธิ์ไม่สำเร็จ', 'error');
      await auth.signOut();
      return;
    }
  }

  // เข้า Admin
  $('who').textContent = user.email;
  $('menu-user-email').textContent = user.email;
  $('menu-user-name').textContent = user.displayName || 'Admin';
  $('menu-user-role').textContent = isMaster ? '⭐ Master Admin' : '🛡️ Admin';

  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  start();
});

/* ═══════════════════════════════════════════════════════════════════
   10. START / STOP subscriptions
   ═══════════════════════════════════════════════════════════════════ */
function start() {
  const collections = ['merchants', 'orders', 'riders', 'users', 'chats', 'gp_transfers'];

  collections.forEach(k => {
    const unsub = db.collection(k)
      .limit(k === 'orders' ? 200 : 100)
      .onSnapshot(s => {
        const items = s.docs.map(d => ({ id: d.id, ...d.data() }));

        if (k === 'gp_transfers') {
          store.gpTransfers = items;
        } else {
          store[k] = items;
        }

        // แจ้งเตือนออเดอร์ใหม่
        if (k === 'orders') {
          const newPending = items.filter(o => o.status === 'pending' || o.status === 'searching');
          if (lastOrderCount > 0 && newPending.length > lastOrderCount) {
            soundNewOrder();
            showToast('🔔 มีออเดอร์ใหม่');
          }
          lastOrderCount = newPending.length;
        }

        render();
      }, err => debugLog(`[${k}] ${err.code}`, true));
    unsubs.push(unsub);
  });

  setupNetwork();
  setupPWA();
  renderNav();
  render();
}

function stop() {
  unsubs.forEach(u => u());
  unsubs = [];
  for (const k in store) store[k] = [];
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
}

/* ═══════════════════════════════════════════════════════════════════
   11. BADGE COUNTS
   ═══════════════════════════════════════════════════════════════════ */
function getBadgeCounts() {
  const pendingMerchants = store.merchants.filter(m => !m.verified).length;
  const pendingRiders = store.riders.filter(r => r.verified === false).length;
  const newOrders = store.orders.filter(o => ['searching', 'pending'].includes(o.status)).length;
  const pendingGpSlips = store.gpTransfers.filter(t => t.status === 'pending').length;
  const pendingPayouts = 0; // TODO: จาก payouts collection

  return {
    pendingMerchants, pendingRiders, newOrders, pendingGpSlips, pendingPayouts
  };
}

/* ═══════════════════════════════════════════════════════════════════
   12. RENDER
   ═══════════════════════════════════════════════════════════════════ */
function renderNav() {
  const b = getBadgeCounts();
  const navEl = $('nav');
  if (!navEl) return;

  navEl.innerHTML = SECTIONS.map(([k, icon, label]) => {
    let badge = '';
    if (k === 'merchants' && b.pendingMerchants) badge = `<span class="nav-badge">${b.pendingMerchants}</span>`;
    else if (k === 'riders' && b.pendingRiders) badge = `<span class="nav-badge">${b.pendingRiders}</span>`;
    else if (k === 'orders' && b.newOrders) badge = `<span class="nav-badge">${b.newOrders}</span>`;
    else if (k === 'gpTransfers' && b.pendingGpSlips) badge = `<span class="nav-badge">${b.pendingGpSlips}</span>`;

    return `<button class="ripple ${k === current ? 'on' : ''}" data-go="${k}">
      ${badge}
      <div class="nav-icon">${icon}</div>
      <div class="nav-label">${label}</div>
    </button>`;
  }).join('');
}

function render() {
  const mainEl = $('main');
  if (!mainEl) return;

  const fn = {
    dashboard, orders, merchants, riders, gp, gpTransfers, payouts, chats, users
  }[current];

  if (fn) mainEl.innerHTML = fn();
  renderNav();

  // render menu links
  const linksEl = $('menu-links');
  if (linksEl) {
    linksEl.innerHTML = SECTIONS.map(([k, icon, label]) =>
      `<button class="menu-link ripple" data-go="${k}" onclick="closeMenu()">
        <div class="ico">${icon}</div>
        <div>${label}</div>
      </button>`
    ).join('');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   13. DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
function dashboard() {
  const completed = store.orders.filter(o => ['done', 'delivered'].includes(o.status));
  const active = store.orders.filter(o =>
    ['searching', 'pending', 'accepted', 'cooking', 'ready', 'picked_up', 'on_the_way'].includes(o.status)
  );

  let todayGp = 0, todayOrders = 0, yesterdayGp = 0;

  completed.forEach(o => {
    const fare = Number(o.fare || 0);
    const gp = calcMainGp(fare).platform;
    const d = toDate(o.createdAt);
    if (!d) return;
    if (isToday(d)) { todayGp += gp; todayOrders++; }
    else if (d >= new Date(Date.now() - 24 * 3600 * 1000) && !isToday(d)) yesterdayGp += gp;
  });

  const trend = yesterdayGp > 0 ? Math.round((todayGp - yesterdayGp) / yesterdayGp * 100) : (todayGp > 0 ? 100 : 0);
  const up = trend >= 0;
  const b = getBadgeCounts();
  const activeRiders = store.riders.filter(r =>
    (r.status === 'active' || r.status === 'available') && r.verified !== false
  ).length;

  const hero = `<div class="hero-card">
    <div class="hero-label">💰 GP แพลตฟอร์มวันนี้ (20%)</div>
    <div class="hero-amount">฿${todayGp.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
    <div class="hero-trend">${up ? '📈' : '📉'} ${up ? '+' : ''}${trend}% เทียบเมื่อวาน</div>
    <div class="hero-grid">
      <div class="hero-grid-cell">
        <div class="lbl">📦 งานเสร็จ</div>
        <div class="val">${todayOrders} งาน</div>
      </div>
      <div class="hero-grid-cell">
        <div class="lbl">🛵 กำลังทำ</div>
        <div class="val">${active.length} งาน</div>
      </div>
    </div>
  </div>`;

  const stats = `<div class="stat-grid">
    <div class="stat-card blue" data-go="merchants">
      <div class="stat-icon">🏪</div>
      <div class="stat-value">${store.merchants.length}</div>
      <div class="stat-label">ร้านค้า</div>
      <div class="stat-sub">${b.pendingMerchants ? '⏳ ' + b.pendingMerchants + ' รออนุมัติ' : '✅ ทั้งหมดอนุมัติ'}</div>
    </div>
    <div class="stat-card purple" data-go="riders">
      <div class="stat-icon">🛵</div>
      <div class="stat-value">${store.riders.length}</div>
      <div class="stat-label">ไรเดอร์</div>
      <div class="stat-sub">${b.pendingRiders ? '⏳ ' + b.pendingRiders + ' รอ' : '🟢 ' + activeRiders + ' พร้อมงาน'}</div>
    </div>
    <div class="stat-card orange" data-go="orders">
      <div class="stat-icon">📋</div>
      <div class="stat-value">${store.orders.length}</div>
      <div class="stat-label">ออเดอร์</div>
      <div class="stat-sub">${b.newOrders ? '🔔 ' + b.newOrders + ' ใหม่' : '✅ เสร็จ ' + completed.length}</div>
    </div>
    <div class="stat-card teal" data-go="users">
      <div class="stat-icon">👥</div>
      <div class="stat-value">${store.users.length}</div>
      <div class="stat-label">ผู้ใช้</div>
      <div class="stat-sub">ในระบบ</div>
    </div>
    <div class="stat-card gold" data-go="gp">
      <div class="stat-icon">💰</div>
      <div class="stat-value">฿${todayGp.toFixed(0)}</div>
      <div class="stat-label">GP วันนี้</div>
      <div class="stat-sub">20% ของค่าบริการ</div>
    </div>
    <div class="stat-card ${b.pendingGpSlips > 0 ? 'red' : 'green'}" data-go="gpTransfers">
      <div class="stat-icon">📸</div>
      <div class="stat-value">${b.pendingGpSlips}</div>
      <div class="stat-label">สลิป GP รอตรวจ</div>
      <div class="stat-sub">${b.pendingGpSlips ? '⏳ ต้องอนุมัติ' : '✅ ว่าง'}</div>
    </div>
  </div>`;

  // Action cards
  const actions = [];

  if (b.newOrders) {
    actions.push(`<div class="action-card warn ripple" data-go="orders">
      <div class="action-icon">🔔</div>
      <div class="action-info">
        <div class="action-title">ออเดอร์ใหม่รอดำเนินการ</div>
        <div class="action-value">${b.newOrders} รายการ</div>
      </div>
      <button class="action-btn orange">ดู →</button>
    </div>`);
  }

  if (b.pendingGpSlips) {
    actions.push(`<div class="action-card warn ripple" data-go="gpTransfers">
      <div class="action-icon">📸</div>
      <div class="action-info">
        <div class="action-title">สลิป GP รอตรวจสอบ</div>
        <div class="action-value">${b.pendingGpSlips} ใบ</div>
      </div>
      <button class="action-btn orange">ตรวจ →</button>
    </div>`);
  }

  if (b.pendingMerchants) {
    actions.push(`<div class="action-card blue ripple" data-go="merchants">
      <div class="action-icon">🏪</div>
      <div class="action-info">
        <div class="action-title">ร้านค้ารออนุมัติ</div>
        <div class="action-value">${b.pendingMerchants} ร้าน</div>
      </div>
      <button class="action-btn blue">ดู →</button>
    </div>`);
  }

  if (b.pendingRiders) {
    actions.push(`<div class="action-card blue ripple" data-go="riders">
      <div class="action-icon">🛵</div>
      <div class="action-info">
        <div class="action-title">ไรเดอร์รออนุมัติ</div>
        <div class="action-value">${b.pendingRiders} คน</div>
      </div>
      <button class="action-btn blue">ดู →</button>
    </div>`);
  }

  if (!actions.length) {
    actions.push(`<div class="action-card green" style="text-align:center;flex-direction:column;padding:24px;justify-content:center">
      <div style="font-size:48px;margin-bottom:8px">✅</div>
      <div class="action-title" style="font-size:15px">ทุกอย่างเรียบร้อย!</div>
    </div>`);
  }

  // Recent orders
  const recent = [...store.orders].sort((a, b) => ts(b) - ts(a)).slice(0, 5).map(o => {
    const color = {
      done: 'var(--green)', cancelled: 'var(--text-light)',
      searching: '#E65100', accepted: 'var(--blue)',
      cooking: 'var(--orange)', ready: 'var(--purple)'
    }[o.status] || 'var(--text-muted)';

    return `<div class="ripple" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;min-height:60px" data-order="${esc(o.id)}">
      <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">${esc(o.title || 'ออเดอร์')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${fmtTime(o.createdAt)} • ${esc(STATUS[o.status] || o.status)}</div>
      </div>
    </div>`;
  }).join('');

  return `${hero}${stats}
    <div class="section-divider"><div class="title">🎯 ต้องทำอะไรต่อ</div><div class="line"></div></div>
    ${actions.join('')}
    <div class="section-divider"><div class="title">🕐 ออเดอร์ล่าสุด</div><div class="line"></div></div>
    <div class="card" style="padding:16px">
      ${recent || '<div style="text-align:center;padding:20px;color:var(--text-light)">ยังไม่มีออเดอร์</div>'}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   14. ORDERS
   ═══════════════════════════════════════════════════════════════════ */
function orders() {
  const q = filters.q.toLowerCase();
  let list = store.orders.filter(o =>
    (filters.orders === 'all' || o.status === filters.orders) &&
    (!q || [o.title, o.userName, o.id].some(v => String(v || '').toLowerCase().includes(q)))
  );
  list.sort((a, b) => ts(b) - ts(a));

  const sel = `<select id="ofilter" style="margin-bottom:14px;padding:12px;min-height:48px;border-radius:12px;border:2px solid var(--border);background:var(--surface);font-family:inherit;font-weight:900;color:var(--text)">
    <option value="all">ทุกสถานะ</option>
    ${Object.entries(STATUS).map(([k, v]) =>
      `<option value="${k}" ${filters.orders === k ? 'selected' : ''}>${v}</option>`
    ).join('')}
  </select>`;

  return searchInput('ค้นหาออเดอร์...') + sel + (list.map(o => {
    const slipBadge = o.riderSlipUrl
      ? (o.riderSlipVerified ? '<span class="tag">📸 ✅</span>' : '<span class="tag w">📸 รอ</span>')
      : '';
    const isCash = o.paymentMode === 'cash';
    const payBadge = isCash ? '<span class="tag w">💵 เงินสด</span>' : '<span class="tag b">💳 โอน</span>';

    return `<div class="data-card" data-order="${esc(o.id)}">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--blue-light)">📋</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(o.title || 'ออเดอร์')}</div>
          <div class="data-card-meta">฿${esc(o.total || 0)} • 👤 ${esc(o.userName || '—')}</div>
          <div class="data-card-meta">🕐 ${fmtTime(o.createdAt)}</div>
          <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
            ${payBadge}${slipBadge}
          </div>
        </div>
        <span class="tag ${o.status === 'done' ? '' : o.status === 'cancelled' ? 'x' : 'w'}">${esc(STATUS[o.status] || o.status)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty"><div class="icon">📭</div><div>ไม่พบออเดอร์</div></div>');
}

function orderDetail(id) {
  const o = store.orders.find(x => x.id === id);
  if (!o) return;

  const opts = Object.entries(STATUS).map(([k, v]) =>
    `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`
  ).join('');

  const foodTotal = orderFoodTotal(o);
  const mainGp = calcMainGp(o.fare || 0);
  const storeGp = calcStoreGp(foodTotal);
  const isCash = o.paymentMode === 'cash';

  const slipSection = o.riderSlipUrl ? `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="font-weight:900;margin-bottom:8px;font-size:13px">📸 สลิปจากไรเดอร์</div>
      ${o.riderSlipVerified
        ? '<div class="slip-status-banner ok">✅ ตรวจสอบแล้ว</div>'
        : '<div class="slip-status-banner pending">⏳ รอตรวจสอบ</div>'}
      <img src="${esc(o.riderSlipUrl)}" class="slip-preview" onclick="window.open('${esc(o.riderSlipUrl)}','_blank')">
      ${!o.riderSlipVerified ? `<div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn-primary" style="flex:1;padding:12px" data-verify-slip="${esc(o.id)}">✅ อนุมัติ</button>
        <button class="btn-primary" style="flex:1;padding:12px;background:var(--red)" data-reject-slip="${esc(o.id)}">❌ ปฏิเสธ</button>
      </div>` : ''}
    </div>` : '';

  openModal('📋 ออเดอร์', `
    <div class="meta" style="font-family:monospace;font-size:11px">ID: ${esc(o.id)}</div>
    <div class="nm" style="font-size:18px;margin:8px 0">${esc(o.title || '')}</div>

    <div class="meta" style="white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:10px;margin-bottom:12px">${esc(itemsText(o.items))}</div>

    <div class="meta" style="margin-top:12px">👤 ${esc(o.userName || '')} • ${esc(o.userPhone || '')}</div>
    <div class="meta">📍 ${esc(o.address || '')}</div>

    ${o.riderName ? `<div class="meta" style="margin-top:8px;color:var(--brand);font-weight:900">🛵 ${esc(o.riderName)}${o.riderPhone ? ' • ' + esc(o.riderPhone) : ''}</div>` : ''}

    <div style="background:${isCash ? 'var(--orange-light)' : 'var(--blue-light)'};padding:12px;border-radius:10px;margin-top:14px;font-size:12px;font-weight:700">
      <div style="font-weight:900;margin-bottom:6px">${isCash ? '💵 ลูกค้าจ่ายเงินสด' : '💳 ลูกค้าโอนเงิน'}</div>
      <div style="display:flex;justify-content:space-between;padding:2px 0"><span>ยอดอาหาร</span><b>฿${fmt(foodTotal)}</b></div>
      <div style="display:flex;justify-content:space-between;padding:2px 0"><span>ค่าบริการ</span><b>฿${fmt(o.fare || 0)}</b></div>
      ${isCash && o.cashTip ? `<div style="display:flex;justify-content:space-between;padding:2px 0;color:#E65100"><span>ค่าบริการพิเศษ (ทิป)</span><b>฿${fmt(o.cashTip)}</b></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;border-top:1px solid var(--border);margin-top:6px;font-size:15px;font-weight:900">
        <span>รวม</span><span style="color:var(--brand)">฿${fmt(o.total || 0)}</span>
      </div>
    </div>

    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <div class="meta">สถานะปัจจุบัน</div>
        <select id="ostatus" data-oid="${esc(o.id)}" style="margin-top:6px;padding:10px;min-height:44px;border-radius:10px;border:2px solid var(--border);background:var(--surface);font-family:inherit;font-weight:900;color:var(--text)">${opts}</select>
      </div>
      <div style="text-align:right">
        <div class="meta">GP แพลตฟอร์ม</div>
        <div style="font-size:16px;font-weight:900;color:var(--green)">฿${fmt(mainGp.platform + storeGp.platform)}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-top:14px">
      ${o.userPhone ? `<a href="tel:${esc(o.userPhone)}" class="btn-primary" style="text-decoration:none;text-align:center;background:var(--blue)">📞 โทรลูกค้า</a>` : ''}
      ${o.riderPhone ? `<a href="tel:${esc(o.riderPhone)}" class="btn-primary" style="text-decoration:none;text-align:center;background:var(--purple)">📞 โทรไรเดอร์</a>` : ''}
    </div>

    ${slipSection}

    ${o.status !== 'cancelled' && o.status !== 'done' ? `<button class="btn-primary" style="margin-top:14px;width:100%;background:var(--red)" data-cancel-order="${esc(o.id)}">❌ ยกเลิกออเดอร์</button>` : ''}
  `);
}

/* ═══════════════════════════════════════════════════════════════════
   15. MERCHANTS
   ═══════════════════════════════════════════════════════════════════ */
function merchants() {
  const q = filters.q.toLowerCase();
  const st = filters.merchantStatus;

  const list = store.merchants.filter(m => {
    const mQ = !q || String(m.name || '').toLowerCase().includes(q);
    const mS = st === 'all' ||
      (st === 'pending' && !m.verified) ||
      (st === 'verified' && m.verified);
    return mQ && mS;
  });

  const pending = store.merchants.filter(m => !m.verified).length;
  const verified = store.merchants.length - pending;

  return `<div class="filter-bar">
    <button class="filter-chip ${st === 'all' ? 'active' : ''}" data-merchant-status="all">📋 ทั้งหมด (${store.merchants.length})</button>
    <button class="filter-chip ${st === 'pending' ? 'active' : ''}" data-merchant-status="pending">⏳ รอ (${pending})</button>
    <button class="filter-chip ${st === 'verified' ? 'active' : ''}" data-merchant-status="verified">✅ อนุมัติ (${verified})</button>
  </div>
  ${searchInput('ค้นหาร้านค้า...')}
  ${list.map(m => {
    const gpPending = Number(m.gpPending || 0);
    return `<div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--green-light)">🏪</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(m.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📞 ${esc(m.phone || '—')}</div>
          <div class="data-card-meta" style="font-family:monospace;font-size:10px">🆔 ${esc((m.id || '').slice(0, 12))}...</div>
          ${m.category ? `<div class="data-card-meta">📂 ${esc(m.category)}</div>` : ''}
          ${gpPending > 0 ? `<div class="data-card-meta" style="color:var(--orange);font-weight:900">💰 GP ค้าง ฿${fmt(gpPending)}</div>` : ''}
        </div>
        <span class="tag ${m.verified ? '' : 'w'}">${m.verified ? '✅' : '⏳'}</span>
      </div>
      <div class="data-card-actions">
        <button class="${m.verified ? 'dan' : 'pri'}" data-verify-merchant="${esc(m.id)}">${m.verified ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
        <button class="blue" data-edit-merchant="${esc(m.id)}">✏️ แก้ไข</button>
        <button class="dan" data-del="merchants:${esc(m.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty"><div class="icon">🏪</div><div>ไม่พบร้านค้า</div></div>'}`;
}

function editMerchantForm(id) {
  const m = store.merchants.find(x => x.id === id);
  if (!m) return;
  openModal('✏️ แก้ไขร้าน', `
    <div class="form-field"><label>ชื่อร้าน</label><input type="text" id="edit-name" value="${esc(m.name || '')}"></div>
    <div class="form-field"><label>เบอร์</label><input type="tel" id="edit-phone" value="${esc(m.phone || '')}"></div>
    <div class="form-field"><label>ที่อยู่</label><textarea id="edit-address" rows="2">${esc(m.address || '')}</textarea></div>
    <button class="btn-primary" style="width:100%" data-save-merchant="${esc(id)}">💾 บันทึก</button>
  `);
}

/* ═══════════════════════════════════════════════════════════════════
   16. RIDERS
   ═══════════════════════════════════════════════════════════════════ */
function riders() {
  const q = filters.q.toLowerCase();
  const pending = store.riders.filter(r => r.verified === false).length;
  const verified = store.riders.length - pending;

  const filtered = store.riders.filter(r => {
    const mQ = !q || String(r.name || '').toLowerCase().includes(q);
    if (filters.riderStatus === 'pending') return mQ && r.verified === false;
    if (filters.riderStatus === 'verified') return mQ && r.verified !== false;
    return mQ;
  });

  return `<div class="filter-bar">
    <button class="filter-chip ${!filters.riderStatus ? 'active' : ''}" data-rider-status="">📋 ทั้งหมด (${store.riders.length})</button>
    <button class="filter-chip ${filters.riderStatus === 'pending' ? 'active' : ''}" data-rider-status="pending">⏳ รอ (${pending})</button>
    <button class="filter-chip ${filters.riderStatus === 'verified' ? 'active' : ''}" data-rider-status="verified">✅ อนุมัติ (${verified})</button>
  </div>
  ${searchInput('ค้นหาไรเดอร์...')}
  ${filtered.map(r => {
    const v = r.verified !== false;
    const online = ['active', 'available', 'online'].includes(r.status);
    const trust = Number(r.trustScore || 100);
    return `<div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--green-light)">🛵</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(r.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📞 ${esc(r.phone || '—')} • ${esc(r.vehicle || '')} ${esc(r.plate || '')}</div>
          <div class="data-card-meta" style="font-family:monospace;font-size:10px">🆔 ${esc((r.id || '').slice(0, 12))}...</div>
          <div class="data-card-meta">⭐ Trust: ${trust} • 📦 ${r.totalJobs || 0} งาน</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <span class="tag ${v ? '' : 'w'}">${v ? '✅' : '⏳'}</span>
          <span class="tag ${online ? '' : 'x'}">${online ? '🟢' : '⚫'}</span>
        </div>
      </div>
      <div class="data-card-actions">
        <button class="${v ? 'dan' : 'pri'}" data-verify-rider="${esc(r.id)}">${v ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
        <button class="${online ? 'dan' : 'pri'}" data-toggle-rider="${esc(r.id)}">${online ? '⏸️' : '▶️'}</button>
        <button class="dan" data-del="riders:${esc(r.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty"><div class="icon">🛵</div><div>ไม่พบไรเดอร์</div></div>'}`;
}

/* ═══════════════════════════════════════════════════════════════════
   17. GP DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
function getGpByRange(range) {
  const completed = store.orders.filter(o => ['done', 'delivered'].includes(o.status));
  const filtered = completed.filter(o => {
    const d = toDate(o.createdAt);
    if (!d) return false;
    if (range === 'today') return isToday(d);
    if (range === 'week') return isWeek(d);
    if (range === 'month') return isMonth(d);
    return true;
  });

  let mainGp = 0, storeGp = 0, totalFare = 0, totalFood = 0;
  const byRider = {}, byMerchant = {};

  filtered.forEach(o => {
    const fare = Number(o.fare || 0);
    const food = orderFoodTotal(o);
    const mg = calcMainGp(fare);
    const sg = calcStoreGp(food);

    mainGp += mg.platform;
    storeGp += sg.total;
    totalFare += fare;
    totalFood += food;

    const rId = o.riderId || 'unknown';
    if (!byRider[rId]) byRider[rId] = { name: o.riderName || 'ไม่ระบุ', gp: 0, storeGp: 0, count: 0 };
    byRider[rId].gp += mg.platform;
    byRider[rId].storeGp += sg.rider;
    byRider[rId].count++;

    const mId = o.merchantId || 'unknown';
    if (!byMerchant[mId]) byMerchant[mId] = {
      name: o.merchantName || store.merchants.find(m => m.id === mId)?.name || 'ไม่ระบุ',
      gp: 0, count: 0
    };
    byMerchant[mId].gp += sg.total;
    byMerchant[mId].count++;
  });

  return { mainGp, storeGp, totalFare, totalFood, count: filtered.length, byRider, byMerchant };
}

function gp() {
  const range = filters.gpRange;
  const current = getGpByRange(range);

  const tabs = `<div class="range-tabs">
    <button class="range-tab ${range === 'today' ? 'active' : ''}" data-gp-range="today">วันนี้</button>
    <button class="range-tab ${range === 'week' ? 'active' : ''}" data-gp-range="week">7 วัน</button>
    <button class="range-tab ${range === 'month' ? 'active' : ''}" data-gp-range="month">30 วัน</button>
    <button class="range-tab ${range === 'all' ? 'active' : ''}" data-gp-range="all">ทั้งหมด</button>
  </div>`;

  const riderRows = Object.entries(current.byRider).sort((a, b) => b[1].gp - a[1].gp);
  const merchantRows = Object.entries(current.byMerchant).sort((a, b) => b[1].gp - a[1].gp);

  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-weight:900;font-size:18px">💰 GP Dashboard</div>
    <span class="tag b">20% + 3%</span>
  </div>
  ${tabs}
  <div class="stat-grid">
    <div class="stat-card gold">
      <div class="stat-icon">💰</div>
      <div class="stat-value">฿${(current.mainGp + current.storeGp).toFixed(0)}</div>
      <div class="stat-label">GP รวม</div>
      <div class="stat-sub">${current.count} ออเดอร์</div>
    </div>
    <div class="stat-card blue">
      <div class="stat-icon">📊</div>
      <div class="stat-value">฿${current.totalFare.toFixed(0)}</div>
      <div class="stat-label">ค่าบริการรวม</div>
    </div>
    <div class="stat-card orange">
      <div class="stat-icon">💵</div>
      <div class="stat-value">฿${current.mainGp.toFixed(0)}</div>
      <div class="stat-label">GP 20% (ค่าบริการ)</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon">🏪</div>
      <div class="stat-value">฿${current.storeGp.toFixed(0)}</div>
      <div class="stat-label">GP 3% (ร้านค้า)</div>
    </div>
  </div>

  <div class="section-divider"><div class="title">🛵 GP รายไรเดอร์</div><div class="line"></div></div>
  <div class="table-wrap"><table class="gp-table">
    <thead><tr><th>ไรเดอร์</th><th class="text-center">งาน</th><th class="text-right">GP 20%</th><th class="text-right">GP 2%</th></tr></thead>
    <tbody>${riderRows.length ? riderRows.map(([id, r]) =>
      `<tr><td style="font-weight:900">🛵 ${esc(r.name)}</td><td class="text-center">${r.count}</td><td class="text-right money-pos">฿${r.gp.toFixed(2)}</td><td class="text-right" style="color:var(--orange);font-weight:900">฿${r.storeGp.toFixed(2)}</td></tr>`
    ).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-light)">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table></div>

  <div class="section-divider"><div class="title">🏪 GP รายร้านค้า</div><div class="line"></div></div>
  <div class="table-wrap"><table class="gp-table">
    <thead><tr><th>ร้านค้า</th><th class="text-center">งาน</th><th class="text-right">GP 3%</th></tr></thead>
    <tbody>${merchantRows.length ? merchantRows.map(([id, m]) =>
      `<tr><td style="font-weight:900">🏪 ${esc(m.name)}</td><td class="text-center">${m.count}</td><td class="text-right money-pos">฿${m.gp.toFixed(2)}</td></tr>`
    ).join('') : '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-light)">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table></div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   18. GP TRANSFERS
   ═══════════════════════════════════════════════════════════════════ */
function gpTransfers() {
  const list = [...store.gpTransfers].sort((a, b) => ts(b) - ts(a));
  const pending = list.filter(t => t.status === 'pending').length;
  const verified = list.filter(t => t.status === 'verified').length;

  const tabs = `<div class="filter-bar">
    <button class="filter-chip active">📋 ทั้งหมด (${list.length})</button>
    <button class="filter-chip">⏳ รอตรวจ (${pending})</button>
    <button class="filter-chip">✅ ยืนยัน (${verified})</button>
  </div>`;

  if (!list.length) {
    return tabs + '<div class="empty"><div class="icon">📸</div><div>ยังไม่มีสลิป GP</div><div style="font-size:12px;margin-top:8px">ร้านค้าจะแนบสลิปโอน GP ที่นี่</div></div>';
  }

  return tabs + list.map(t => {
    const statusLabel = t.status === 'verified' ? '✅ ยืนยัน' : '⏳ รอตรวจ';
    const statusClass = t.status === 'verified' ? '' : 'w';
    return `<div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--orange-light)">📸</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(t.merchantName || 'ร้านค้า')}</div>
          <div class="data-card-meta" style="font-weight:900;color:var(--orange)">💰 ฿${fmt(t.amount || 0)}</div>
          <div class="data-card-meta">🕐 ${fmtTime(t.createdAt)}</div>
          ${t.roundLabel ? `<div class="data-card-meta">📅 รอบ: ${esc(t.roundLabel)}</div>` : ''}
          ${t.note ? `<div class="data-card-meta">📝 ${esc(t.note)}</div>` : ''}
        </div>
        <span class="tag ${statusClass}">${statusLabel}</span>
      </div>
      <div class="data-card-actions">
        <button class="blue" data-view-slip="${esc(t.id)}">🖼️ ดูสลิป</button>
        ${t.status === 'pending' ? `
          <button class="pri" data-verify-gp="${esc(t.id)}">✅ ยืนยัน</button>
          <button class="dan" data-reject-gp="${esc(t.id)}">❌ ปฏิเสธ</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════
   19. PAYOUTS (โอน GP 2% ให้ไรเดอร์)
   ═══════════════════════════════════════════════════════════════════ */
function payouts() {
  // คำนวณ GP 2% ค้างจ่ายต่อไรเดอร์ (จากออเดอร์ที่เสร็จแล้ว)
  const completed = store.orders.filter(o => ['done', 'delivered'].includes(o.status));
  const byRider = {};

  completed.forEach(o => {
    if (!o.riderId) return;
    const food = orderFoodTotal(o);
    const gp2 = Math.round(food * GP_RIDER_SHARE * 100) / 100;
    if (!byRider[o.riderId]) {
      byRider[o.riderId] = {
        name: o.riderName || 'ไม่ระบุ',
        phone: o.riderPhone || '',
        total: 0, count: 0
      };
    }
    byRider[o.riderId].total += gp2;
    byRider[o.riderId].count++;
  });

  const rows = Object.entries(byRider).sort((a, b) => b[1].total - a[1].total);

  if (!rows.length) {
    return '<div class="empty"><div class="icon">💸</div><div>ยังไม่มี GP ที่ต้องจ่าย</div><div style="font-size:12px;margin-top:8px">เมื่อมีออเดอร์เสร็จ GP 2% จะแสดงที่นี่</div></div>';
  }

  const total = rows.reduce((s, [, r]) => s + r.total, 0);

  return `<div class="stat-grid">
    <div class="stat-card orange">
      <div class="stat-icon">💸</div>
      <div class="stat-value">฿${total.toFixed(0)}</div>
      <div class="stat-label">GP 2% รวม</div>
      <div class="stat-sub">${rows.length} ไรเดอร์</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon">🛵</div>
      <div class="stat-value">${rows.reduce((s, [, r]) => s + r.count, 0)}</div>
      <div class="stat-label">ออเดอร์รวม</div>
    </div>
  </div>

  <div class="section-divider"><div class="title">💸 ยอดต้องโอนให้ไรเดอร์ (GP 2%)</div><div class="line"></div></div>

  ${rows.map(([riderId, r]) => `
    <div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--purple-light)">🛵</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(r.name)}</div>
          <div class="data-card-meta">📞 ${esc(r.phone || '—')}</div>
          <div class="data-card-meta">📦 ${r.count} ออเดอร์</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:900;color:var(--orange)">฿${r.total.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);font-weight:700">ต้องโอน</div>
        </div>
      </div>
      <div class="data-card-actions">
        <button class="pri" data-payout-rider="${esc(riderId)}">💸 โอนแล้ว</button>
        ${r.phone ? `<a href="tel:${esc(r.phone)}" class="blue" style="text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center">📞 โทร</a>` : ''}
      </div>
    </div>
  `).join('')}`;
}

function payoutRider(riderId) {
  const completed = store.orders.filter(o =>
    ['done', 'delivered'].includes(o.status) && o.riderId === riderId
  );
  const total = completed.reduce((s, o) => {
    const food = orderFoodTotal(o);
    return s + Math.round(food * GP_RIDER_SHARE * 100) / 100;
  }, 0);

  const rider = store.riders.find(r => r.id === riderId);

  openModal('💸 โอน GP 2%', `
    <div style="background:var(--purple-light);border-radius:14px;padding:16px;margin-bottom:14px;text-align:center">
      <div style="font-size:12px;color:var(--purple);font-weight:800;margin-bottom:6px">ยอดโอน</div>
      <div style="font-size:32px;font-weight:900;color:var(--purple)">฿${total.toFixed(2)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${completed.length} ออเดอร์</div>
    </div>

    <div class="meta" style="margin-bottom:12px;font-weight:900">🛵 ${esc(rider?.name || 'ไม่ระบุ')}</div>
    <div class="meta" style="margin-bottom:12px">📞 ${esc(rider?.phone || '—')}</div>

    <div class="form-field"><label>📝 หมายเหตุ (ไม่บังคับ)</label><textarea id="payout-note" rows="2" placeholder="เช่น โอนผ่าน KBank xxxx"></textarea></div>

    <button class="btn-primary" style="width:100%" data-confirm-payout="${esc(riderId)}">✅ ยืนยันโอนแล้ว</button>
    <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="closeModal()">ยกเลิก</button>
  `);
}

/* ═══════════════════════════════════════════════════════════════════
   20. CHATS
   ═══════════════════════════════════════════════════════════════════ */
function chats() {
  const list = [...store.chats].sort((a, b) => ts(b) - ts(a));
  if (!list.length) {
    return '<div class="empty"><div class="icon">💬</div><div>ยังไม่มีการสนทนา</div></div>';
  }

  return list.map(c => {
    // v3.4.8: chats structure มี userId/riderId/merchantId
    const parties = [];
    if (c.userName) parties.push('👤 ' + c.userName);
    if (c.riderName) parties.push('🛵 ' + c.riderName);
    if (c.merchantName) parties.push('🏪 ' + c.merchantName);
    const title = parties.length ? parties.join(' ↔ ') : 'การสนทนา';

    return `<div class="data-card" data-open-chat="${esc(c.id)}">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--green-light)">💬</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(title)}</div>
          <div class="data-card-meta">${esc((c.lastMessage || '—').substring(0, 50))}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:10px;color:var(--text-muted);font-weight:700">${fmtTimeShort(c.lastMessageAt || c.createdAt)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openChat(chatId) {
  activeChatId = chatId;
  const c = store.chats.find(x => x.id === chatId);
  if (!c) return;

  const parties = [];
  if (c.userName) parties.push('👤 ' + c.userName);
  if (c.riderName) parties.push('🛵 ' + c.riderName);
  if (c.merchantName) parties.push('🏪 ' + c.merchantName);

  const titleEl = $('chat-name');
  if (titleEl) titleEl.textContent = parties.join(' ↔ ') || 'แชท';
  const subEl = $('chat-sub');
  if (subEl) subEl.textContent = 'ออเดอร์ #' + chatId.slice(-8);

  $('chat-container').classList.add('show');
  const inputEl = $('chat-input');
  if (inputEl) inputEl.value = '';

  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(100)
    .onSnapshot(s => renderChatMessages(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

function closeChat() {
  $('chat-container')?.classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function renderChatMessages(msgs) {
  const container = $('chat-messages');
  if (!container) return;
  if (!msgs.length) {
    container.innerHTML = '<div class="chat-empty">ยังไม่มีข้อความ</div>';
    return;
  }

  let lastDay = '';
  container.innerHTML = msgs.map(m => {
    const isAdmin = m.senderRole === 'admin';
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) { dayDiv = `<div class="chat-day-divider">${day}</div>`; lastDay = day; }

    const cls = isAdmin ? 'out' : 'in';
    const img = m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-image" onclick="window.open('${esc(m.imageUrl)}','_blank')">` : '';
    const name = !isAdmin && m.senderName
      ? `<div style="font-size:10px;font-weight:900;opacity:.8;margin-bottom:4px">${esc(m.senderName)}</div>`
      : '';

    return `${dayDiv}<div class="chat-msg ${cls}">${name}${img}${m.text ? `<div>${esc(m.text)}</div>` : ''}<div class="msg-time">${fmtTimeShort(m.createdAt)}</div></div>`;
  }).join('');

  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

async function sendChatText() {
  const input = $('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !activeChatId) return;

  input.value = '';
  input.style.height = 'auto';

  try {
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text,
      senderRole: 'admin',
      senderName: 'Admin',
      senderId: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: `[Admin] ${text}`,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    showToast('ส่งไม่สำเร็จ', 'error');
  }
}

function pickChatImage() { $('chat-image-input')?.click(); }

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > 5 * 1024 * 1024) return showToast('รูปใหญ่เกิน 5MB', 'error');
  showToast('⏳ กำลังอัปโหลด...', 'info');

  try {
    const ref = storage.ref(`chats/${activeChatId}/${Date.now()}.jpg`);
    await ref.put(file);
    const url = await ref.getDownloadURL();

    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url,
      senderRole: 'admin',
      senderName: 'Admin',
      senderId: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '[Admin] 📷 รูปภาพ',
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
   21. USERS
   ═══════════════════════════════════════════════════════════════════ */
function users() {
  const q = filters.q.toLowerCase();
  const list = store.users.filter(u =>
    !q || [u.name, u.email, u.phone].some(v => String(v || '').toLowerCase().includes(q))
  );

  return searchInput('ค้นหาผู้ใช้...') + (list.map(u => {
    const roleColors = {
      user: 'b', rider: 'p', merchant: '', admin: 'p'
    };
    const roleClass = roleColors[u.role] || '';
    return `<div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:var(--blue-light)">👤</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(u.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📧 ${esc(u.email || '—')}</div>
          <div class="data-card-meta">🎭 Role: <b>${esc(u.role || '—')}</b>${u.isPending ? ' ⏳ รออนุมัติ' : ''}</div>
        </div>
        <span class="tag ${roleClass}">${esc(u.role || 'user')}</span>
      </div>
      <div class="data-card-actions">
        <button class="blue" data-change-role="${esc(u.id)}">🎭 เปลี่ยน Role</button>
        <button class="dan" data-del="users:${esc(u.id)}">🗑️ ลบ</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty"><div class="icon">👥</div><div>ไม่พบผู้ใช้</div></div>');
}

function changeRoleForm(uid) {
  const u = store.users.find(x => x.id === uid);
  if (!u) return;

  const roles = ['user', 'rider', 'merchant', 'admin'];
  openModal('🎭 เปลี่ยน Role', `
    <div class="meta" style="margin-bottom:12px;font-weight:900">👤 ${esc(u.name || 'ไม่ระบุ')}</div>
    <div class="meta" style="margin-bottom:16px">📧 ${esc(u.email || '—')}</div>
    <div class="form-field">
      <label>Role ใหม่</label>
      <select id="role-select" style="width:100%;padding:14px;border:2px solid var(--border);border-radius:14px;background:var(--input-bg);color:var(--text);font-family:inherit;font-weight:900;font-size:14px">
        ${roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    ${u.isPending ? `
      <div style="background:var(--yellow-light);padding:12px;border-radius:10px;margin-bottom:14px;font-size:12px;font-weight:700">
        ⏳ บัญชีนี้รอการอนุมัติ<br>
        <button class="btn-primary" style="width:100%;margin-top:8px;padding:10px" data-approve-admin="${esc(uid)}">✅ อนุมัติเป็น Admin</button>
      </div>
    ` : ''}
    <button class="btn-primary" style="width:100%" data-save-role="${esc(uid)}">💾 บันทึก</button>
    <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="closeModal()">ยกเลิก</button>
  `);
}

/* ═══════════════════════════════════════════════════════════════════
   22. SEARCH INPUT
   ═══════════════════════════════════════════════════════════════════ */
function searchInput(placeholder) {
  return `<div class="search-box">
    <span style="font-size:18px;opacity:.5">🔍</span>
    <input id="q" placeholder="${placeholder}" value="${esc(filters.q)}">
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   23. MENU
   ═══════════════════════════════════════════════════════════════════ */
function toggleMenu() {
  $('menu-overlay')?.classList.toggle('show');
}

function closeMenu() {
  $('menu-overlay')?.classList.remove('show');
}

/* ═══════════════════════════════════════════════════════════════════
   24. MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openModal(title, html) {
  const titleEl = $('modal-title');
  const bodyEl = $('modal-body');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.innerHTML = html;
  $('modal-overlay')?.classList.add('show');
}

function closeModal() {
  $('modal-overlay')?.classList.remove('show');
}

/* ═══════════════════════════════════════════════════════════════════
   25. EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('click', async e => {
  const t = e.target.closest(
    '[data-go],[data-order],[data-open-chat],[data-verify-merchant],[data-edit-merchant],' +
    '[data-verify-rider],[data-toggle-rider],[data-del],[data-merchant-status],' +
    '[data-rider-status],[data-gp-range],[data-verify-slip],[data-reject-slip],' +
    '[data-cancel-order],[data-save-merchant],[data-view-slip],[data-verify-gp],' +
    '[data-reject-gp],[data-payout-rider],[data-confirm-payout],[data-change-role],' +
    '[data-save-role],[data-approve-admin]'
  );
  if (!t) return;

  try {
    // ─── Navigation ───
    if (t.dataset.go) {
      current = t.dataset.go;
      filters.q = '';
      render();
      window.scrollTo(0, 0);
      return;
    }

    // ─── Filters ───
    if (t.dataset.gpRange) {
      filters.gpRange = t.dataset.gpRange;
      render();
      return;
    }
    if (t.dataset.merchantStatus) {
      filters.merchantStatus = t.dataset.merchantStatus;
      render();
      return;
    }
    if (t.hasAttribute('data-rider-status')) {
      filters.riderStatus = t.dataset.riderStatus;
      render();
      return;
    }

    // ─── Actions ───
    if (t.dataset.openChat) {
      openChat(t.dataset.openChat);
      return;
    }
    if (t.dataset.order) {
      orderDetail(t.dataset.order);
      return;
    }
    if (t.dataset.editMerchant) {
      editMerchantForm(t.dataset.editMerchant);
      return;
    }

    // ─── Verify Merchant ───
    if (t.dataset.verifyMerchant) {
      const m = store.merchants.find(x => x.id === t.dataset.verifyMerchant);
      if (m) {
        await db.collection('merchants').doc(m.id).update({
          verified: !m.verified,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(m.verified ? '🚫 ยกเลิกแล้ว' : '✅ อนุมัติแล้ว');
      }
      return;
    }

    // ─── Verify Rider ───
    if (t.dataset.verifyRider) {
      const r = store.riders.find(x => x.id === t.dataset.verifyRider);
      if (r) {
        const nv = r.verified === false;
        await db.collection('riders').doc(r.id).update({
          verified: nv,
          verifiedAt: nv ? firebase.firestore.FieldValue.serverTimestamp() : null
        });
        showToast(nv ? '✅ อนุมัติแล้ว' : '🚫 ยกเลิกแล้ว');
      }
      return;
    }

    if (t.dataset.toggleRider) {
      const r = store.riders.find(x => x.id === t.dataset.toggleRider);
      if (r) {
        const online = ['active', 'available', 'online'].includes(r.status);
        await db.collection('riders').doc(r.id).update({
          status: online ? 'inactive' : 'active'
        });
        showToast(online ? '⏸️ ปิดรับงาน' : '▶️ เปิดรับงาน');
      }
      return;
    }

    // ─── Save Merchant ───
    if (t.dataset.saveMerchant) {
      await db.collection('merchants').doc(t.dataset.saveMerchant).update({
        name: $('edit-name').value.trim(),
        phone: $('edit-phone').value.trim(),
        address: $('edit-address').value.trim()
      });
      showToast('✅ บันทึกแล้ว');
      closeModal();
      return;
    }

    // ─── Verify Slip ───
    if (t.dataset.verifySlip) {
      await db.collection('orders').doc(t.dataset.verifySlip).update({
        riderSlipVerified: true,
        riderSlipVerifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
        riderSlipVerifiedBy: auth.currentUser.uid
      });
      showToast('✅ อนุมัติสลิปแล้ว');
      orderDetail(t.dataset.verifySlip);
      return;
    }

    if (t.dataset.rejectSlip) {
      if (!confirm('ปฏิเสธสลิป?')) return;
      await db.collection('orders').doc(t.dataset.rejectSlip).update({
        riderSlipUrl: null,
        riderSlipVerified: false
      });
      showToast('❌ ปฏิเสธสลิป');
      orderDetail(t.dataset.rejectSlip);
      return;
    }

    // ─── Cancel Order ───
    if (t.dataset.cancelOrder) {
      if (!confirm('ยกเลิกออเดอร์นี้?')) return;
      await db.collection('orders').doc(t.dataset.cancelOrder).update({
        status: 'cancelled',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
        cancelledBy: 'admin'
      });
      showToast('❌ ยกเลิกแล้ว');
      closeModal();
      return;
    }

    // ─── GP Transfers ───
    if (t.dataset.viewSlip) {
      const gp = store.gpTransfers.find(x => x.id === t.dataset.viewSlip);
      if (gp?.slipUrl) {
        openModal('📸 สลิป GP', `
          <img src="${esc(gp.slipUrl)}" style="width:100%;border-radius:12px;margin-bottom:14px" onclick="window.open('${esc(gp.slipUrl)}','_blank')">
          <div style="background:var(--surface-2);border-radius:12px;padding:14px;font-size:13px;font-weight:700">
            <div style="display:flex;justify-content:space-between;padding:4px 0"><span>ร้านค้า</span><b>${esc(gp.merchantName || '—')}</b></div>
            <div style="display:flex;justify-content:space-between;padding:4px 0"><span>ยอด</span><b style="color:var(--green)">฿${fmt(gp.amount || 0)}</b></div>
            <div style="display:flex;justify-content:space-between;padding:4px 0"><span>รอบ</span><b>${esc(gp.roundLabel || '—')}</b></div>
            <div style="display:flex;justify-content:space-between;padding:4px 0"><span>เวลา</span><b>${fmtTime(gp.createdAt)}</b></div>
          </div>
          ${gp.status === 'pending' ? `
            <div style="display:flex;gap:8px;margin-top:14px">
              <button class="btn-primary" style="flex:1;padding:14px" data-verify-gp="${esc(gp.id)}">✅ ยืนยัน</button>
              <button class="btn-primary" style="flex:1;padding:14px;background:var(--red)" data-reject-gp="${esc(gp.id)}">❌ ปฏิเสธ</button>
            </div>
          ` : ''}
        `);
      }
      return;
    }

    if (t.dataset.verifyGp) {
      const gp = store.gpTransfers.find(x => x.id === t.dataset.verifyGp);
      if (!gp) return;
      await db.collection('gp_transfers').doc(gp.id).update({
        status: 'verified',
        verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
        verifiedBy: auth.currentUser.uid
      });
      // หัก gpPending ของร้าน (ถ้ามี)
      if (gp.merchantId) {
        const m = store.merchants.find(x => x.id === gp.merchantId);
        if (m) {
          const newPending = Math.max(0, Number(m.gpPending || 0) - Number(gp.amount || 0));
          await db.collection('merchants').doc(m.id).update({ gpPending: newPending });
        }
      }
      showToast('✅ ยืนยันสลิปแล้ว');
      closeModal();
      return;
    }

    if (t.dataset.rejectGp) {
      if (!confirm('ปฏิเสธสลิปนี้?')) return;
      await db.collection('gp_transfers').doc(t.dataset.rejectGp).update({
        status: 'rejected',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rejectedBy: auth.currentUser.uid
      });
      showToast('❌ ปฏิเสธแล้ว');
      closeModal();
      return;
    }

    // ─── Payout Rider ───
    if (t.dataset.payoutRider) {
      payoutRider(t.dataset.payoutRider);
      return;
    }

    if (t.dataset.confirmPayout) {
      const riderId = t.dataset.confirmPayout;
      const note = ($('payout-note')?.value.trim()) || '';
      const completed = store.orders.filter(o =>
        ['done', 'delivered'].includes(o.status) && o.riderId === riderId
      );
      const total = completed.reduce((s, o) => {
        const food = orderFoodTotal(o);
        return s + Math.round(food * GP_RIDER_SHARE * 100) / 100;
      }, 0);

      await db.collection('rider_payouts').add({
        riderId,
        riderName: store.riders.find(r => r.id === riderId)?.name || 'ไม่ระบุ',
        amount: total,
        orderCount: completed.length,
        note,
        status: 'paid',
        paidAt: firebase.firestore.FieldValue.serverTimestamp(),
        paidBy: auth.currentUser.uid
      });

      // mark order ว่าโอนแล้ว
      for (const o of completed) {
        await db.collection('orders').doc(o.id).update({
          riderPayoutPaid: true,
          riderPayoutPaidAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      showToast('✅ บันทึกการโอนแล้ว');
      closeModal();
      return;
    }

    // ─── Change Role ───
    if (t.dataset.changeRole) {
      changeRoleForm(t.dataset.changeRole);
      return;
    }

    if (t.dataset.saveRole) {
      const uid = t.dataset.saveRole;
      const newRole = $('role-select')?.value;
      if (!newRole) return;
      await db.collection('users').doc(uid).update({ role: newRole });
      showToast('✅ เปลี่ยน Role เป็น ' + newRole);
      closeModal();
      return;
    }

    if (t.dataset.approveAdmin) {
      const uid = t.dataset.approveAdmin;
      await db.collection('users').doc(uid).update({ isPending: false });
      showToast('✅ อนุมัติแล้ว');
      closeModal();
      return;
    }

    // ─── Delete ───
    if (t.dataset.del) {
      const [col, id] = t.dataset.del.split(':');
      if (!confirm('⚠️ ลบรายการนี้?')) return;
      await db.collection(col).doc(id).delete();
      showToast('🗑️ ลบแล้ว');
      return;
    }
  } catch (err) {
    debugLog('❌ ' + err.message, true);
    showToast('ไม่สำเร็จ', 'error');
  }
});

/* ═══════════════════════════════════════════════════════════════════
   26. INPUT/CHANGE EVENTS
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    filters.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('q');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'ofilter') {
    filters.orders = e.target.value;
    render();
  }
  if (e.target.id === 'ostatus') {
    await db.collection('orders').doc(e.target.dataset.oid).update({
      status: e.target.value,
      statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ อัปเดตสถานะ');
    closeModal();
  }
});

/* Chat: Enter to send */
document.addEventListener('keydown', e => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatText();
  }
});

/* Haptic */
document.addEventListener('click', e => {
  const el = e.target.closest('button, .data-card, nav button, .stat-card, .action-card, .menu-link');
  if (el && navigator.vibrate) navigator.vibrate(8);
}, { passive: true });

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
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('chauat_admin_pwa_dismissed')) {
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
  localStorage.setItem('chauat_admin_pwa_dismissed', '1');
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
window.handleForgotPassword = handleForgotPassword;
window.handleSignup = handleSignup;
window.handleLogout = handleLogout;
window.toggleMenu = toggleMenu;
window.closeMenu = closeMenu;
window.closeChat = closeChat;
window.pickChatImage = pickChatImage;
window.sendChatText = sendChatText;
window.sendChatImage = sendChatImage;
window.autoResize = autoResize;
window.closeModal = closeModal;
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