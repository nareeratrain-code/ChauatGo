/* ═══════════════════════════════════════════════════════════════
   🛵 CHAUAT GO ADMIN — v3.3.3
   ═══════════════════════════════════════════════════════════════ */

// ═══ FIREBASE ═══
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

// ═══ STATE ═══
const store = { merchants: [], orders: [], riders: [], users: [], places: [], chats: [] };
const filters = { orders: 'all', q: '', riderStatus: '', merchantStatus: 'all', gpRange: 'today' };
let current = 'dashboard';
let unsubs = [];
let activeChatId = null;
let activeChatUnsub = null;
let deferredPrompt = null;

const MASTER_ADMINS = ['adminchauatgo@gmail.com', 'admin@chauatgo.com', 'chauatgo@gmail.com'];

const SECTIONS = [
  ['dashboard', '📊', 'แดชบอร์ด'],
  ['gp', '💰', 'GP'],
  ['finance', '🧾', 'บัญชี'],
  ['chats', '💬', 'แชท'],
  ['merchants', '🏪', 'ร้านค้า'],
  ['orders', '📋', 'ออเดอร์'],
  ['riders', '🛵', 'ไรเดอร์'],
  ['users', '👥', 'ผู้ใช้']
];

const STATUS = {
  searching: '⏳ หาไรเดอร์', pending: '🔔 รอรับ', accepted: '🛵 รับแล้ว',
  cooking: '🍳 กำลังทำ', ready: '✅ พร้อมส่ง', picked_up: '📦 รับของ',
  on_the_way: '🚀 กำลังส่ง', delivered: '✅ สำเร็จ', done: '✅ เสร็จ', cancelled: '❌ ยกเลิก'
};

// ═══ HELPERS ═══
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsStr = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
const fmt = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const toDate = t => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? null : d; };
const fmtTime = t => { const d = toDate(t); return d ? d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
const fmtTimeShort = t => { const d = toDate(t); return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''; };
const ts = o => o.createdAt?.seconds || 0;
const isToday = t => { const d = toDate(t); if (!d) return false; const n = new Date(); n.setHours(0,0,0,0); return d >= n; };
const isWeek = t => { const d = toDate(t); if (!d) return false; return d >= new Date(Date.now() - 7*24*60*60*1000); };
const isMonth = t => { const d = toDate(t); if (!d) return false; const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); };
const itemsText = i => Array.isArray(i) ? i.map(x => `${x.name} x${x.qty}`).join(', ') : String(i ?? '');

// ═══ DEBUG & TOAST ═══
function logToScreen(msg, isError = false) {
  const el = $('debugConsole');
  if (el) {
    el.classList.add('show');
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${esc(msg)}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}
function toast(m, err) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 3000);
}

// ═══ AUTH ═══
function switchTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login-btn').classList.toggle('active', isLogin);
  $('tab-signup-btn').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('btn-login');
  const email = $('em').value.trim().toLowerCase();
  const pw = $('pw').value;
  if (!email || !pw) return toast('กรอกอีเมลและรหัสผ่าน', true);
  btn.disabled = true; btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  logToScreen('🔐 ล็อกอิน: ' + email);
  try {
    await auth.signInWithEmailAndPassword(email, pw);
    logToScreen('✅ ล็อกอินสำเร็จ');
    toast('✅ เข้าสู่ระบบสำเร็จ');
  } catch (err) {
    logToScreen('❌ ' + err.code, true);
    const msg = {
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบบัญชีนี้',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองหลายครั้งเกินไป'
    }[err.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    toast(msg, true);
    btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
  }
  $('pw').value = '';
}

async function handleForgot() {
  const email = $('em').value.trim();
  if (!email) return toast('กรอกอีเมลก่อน', true);
  try {
    await auth.sendPasswordResetEmail(email);
    toast('📧 ส่งลิงก์รีเซ็ตแล้ว');
  } catch (err) { toast('ส่งไม่สำเร็จ', true); }
}

async function handleSignup() {
  const name = $('su-name').value.trim();
  const email = $('su-email').value.trim().toLowerCase();
  const pw = $('su-pw').value, pw2 = $('su-pw2').value;
  if (!name || !email || !pw) return toast('กรอกให้ครบ', true);
  if (pw.length < 6) return toast('รหัสผ่าน 6+ ตัว', true);
  if (pw !== pw2) return toast('รหัสไม่ตรงกัน', true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      role: 'admin', name, email, isPending: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ สมัครสำเร็จ! รออนุมัติ');
    switchTab('login');
    $('em').value = email;
  } catch (err) { toast('สมัครไม่สำเร็จ: ' + err.message, true); }
}

$('logout').addEventListener('click', async () => { stop(); await auth.signOut(); });

auth.onAuthStateChanged(async user => {
  stop();
  if (!user) {
    $('login').classList.remove('hidden');
    $('app').classList.add('hidden');
    return;
  }
  const userEmail = (user.email || '').toLowerCase().trim();
  const isMaster = MASTER_ADMINS.includes(userEmail);
  logToScreen('👤 ' + userEmail);
  logToScreen('🔑 Master: ' + isMaster);

  if (!isMaster) {
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      const isAdmin = snap.exists && snap.data().role === 'admin';
      if (!isAdmin) {
        toast('บัญชีนี้ไม่มีสิทธิ์', true);
        await auth.signOut();
        return;
      }
    } catch (err) {
      toast('ตรวจสอบสิทธิ์ไม่สำเร็จ', true);
      await auth.signOut();
      return;
    }
  }
  logToScreen('✅ เข้า Admin');
  $('who').textContent = user.email;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  start();
});

// ═══ START / STOP ═══
function start() {
  ['merchants', 'orders', 'riders', 'users', 'chats'].forEach(k => {
    const unsub = db.collection(k).onSnapshot(s => {
      store[k] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, err => logToScreen(`❌ [${k}] ${err.code}`, true));
    unsubs.push(unsub);
  });
  const unsubPlaces = db.collection('places').limit(500).onSnapshot(s => {
    store.places = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => logToScreen('⚠️ places: ' + err.code, true));
  unsubs.push(unsubPlaces);
  setupNetworkWatcher();
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

// ═══ BADGES ═══
function getBadgeCounts() {
  const pendingMerchants = store.merchants.filter(m => !m.verified).length;
  const pendingRiders = store.riders.filter(r => r.verified === false).length;
  const newOrders = store.orders.filter(o => ['searching', 'pending'].includes(o.status)).length;
  const pendingSlips = store.orders.filter(o => o.riderSlipUrl && !o.riderSlipVerified).length;
  const unreadChats = store.chats.reduce((s, c) => s + (c.unreadAdmin || 0), 0);
  const staleOrders = store.orders.filter(o => {
    if (!['searching', 'pending'].includes(o.status)) return false;
    const d = toDate(o.createdAt);
    return d && (Date.now() - d.getTime()) > 15 * 60 * 1000;
  }).length;
  return { pendingMerchants, pendingRiders, newOrders, pendingSlips, unreadChats, staleOrders };
}

// ═══ RENDER ═══
function renderNav() {
  const b = getBadgeCounts();
  $('nav').innerHTML = SECTIONS.map(([k, icon, label]) => {
    let badge = '';
    if (k === 'merchants' && b.pendingMerchants) badge = `<span class="nav-badge">${b.pendingMerchants}</span>`;
    else if (k === 'riders' && b.pendingRiders) badge = `<span class="nav-badge">${b.pendingRiders}</span>`;
    else if (k === 'orders' && b.newOrders) badge = `<span class="nav-badge">${b.newOrders}</span>`;
    else if (k === 'chats' && b.unreadChats) badge = `<span class="nav-badge">${b.unreadChats}</span>`;
    return `<button class="ripple ${k === current ? 'on' : ''}" data-go="${k}">
      ${badge}<div class="nav-icon">${icon}</div><div class="nav-label">${label}</div>
    </button>`;
  }).join('');
}

function render() {
  const fn = { dashboard, gp, finance, chats, merchants, orders, riders, users }[current];
  if (fn) $('main').innerHTML = fn();
  renderNav();
}

function searchInput(ph) {
  return `<div class="search-box"><span style="font-size:18px;opacity:.5">🔍</span><input id="q" placeholder="${ph}" value="${esc(filters.q)}"></div>`;
}

// ═══ DASHBOARD ═══
function dashboard() {
  const completed = store.orders.filter(o => ['done', 'delivered'].includes(o.status));
  const active = store.orders.filter(o => ['searching','pending','accepted','cooking','ready','picked_up','on_the_way'].includes(o.status));

  let todayRev = 0, todayOrders = 0, yesterdayRev = 0;
  completed.forEach(o => {
    const fare = Number(o.fare || 0);
    const cut = Math.round(fare * 0.20 * 100) / 100;
    const d = toDate(o.createdAt); if (!d) return;
    if (isToday(d)) { todayRev += cut; todayOrders++; }
    else if (d >= new Date(Date.now() - 24*60*60*1000) && !isToday(d)) yesterdayRev += cut;
  });

  const trend = yesterdayRev > 0 ? Math.round((todayRev - yesterdayRev) / yesterdayRev * 100) : (todayRev > 0 ? 100 : 0);
  const up = trend >= 0;
  const b = getBadgeCounts();
  const activeRiders = store.riders.filter(r => (r.status === 'active' || r.status === 'available') && r.verified !== false).length;

  const hero = `<div class="hero-card">
    <div class="hero-label">💰 รายได้วันนี้ (GP 20%)</div>
    <div class="hero-amount">฿${todayRev.toLocaleString('th-TH',{minimumFractionDigits:2})}</div>
    <div class="hero-trend">${up ? '📈' : '📉'} ${up ? '+' : ''}${trend}% เทียบเมื่อวาน</div>
    <div class="hero-grid">
      <div class="hero-grid-cell"><div class="lbl">📦 งานเสร็จ</div><div class="val">${todayOrders} งาน</div></div>
      <div class="hero-grid-cell"><div class="lbl">🛵 กำลังทำ</div><div class="val">${active.length} งาน</div></div>
    </div>
  </div>`;

  const stats = `<div class="stat-grid">
    <div class="stat-card blue" data-go="merchants"><div class="stat-icon">🏪</div><div class="stat-value">${store.merchants.length}</div><div class="stat-label">ร้านค้า</div><div class="stat-sub">${b.pendingMerchants ? '⏳ ' + b.pendingMerchants + ' รออนุมัติ' : '✅ ทั้งหมดอนุมัติ'}</div></div>
    <div class="stat-card purple" data-go="riders"><div class="stat-icon">🛵</div><div class="stat-value">${store.riders.length}</div><div class="stat-label">ไรเดอร์</div><div class="stat-sub">${b.pendingRiders ? '⏳ ' + b.pendingRiders + ' รอ' : '🟢 ' + activeRiders + ' พร้อมงาน'}</div></div>
    <div class="stat-card orange" data-go="orders"><div class="stat-icon">📋</div><div class="stat-value">${store.orders.length}</div><div class="stat-label">ออเดอร์</div><div class="stat-sub">${b.newOrders ? '🔔 ' + b.newOrders + ' ใหม่' : '✅ เสร็จ ' + completed.length}</div></div>
    <div class="stat-card teal" data-go="users"><div class="stat-icon">👥</div><div class="stat-value">${store.users.length}</div><div class="stat-label">ผู้ใช้</div><div class="stat-sub">ในระบบ</div></div>
    <div class="stat-card gold" data-go="gp"><div class="stat-icon">💰</div><div class="stat-value">฿${todayRev.toFixed(0)}</div><div class="stat-label">GP วันนี้</div><div class="stat-sub">20% ของยอด</div></div>
    <div class="stat-card ${b.pendingSlips > 0 ? 'red' : 'green'}" data-go="orders"><div class="stat-icon">📸</div><div class="stat-value">${b.pendingSlips}</div><div class="stat-label">สลิปรอตรวจ</div><div class="stat-sub">${b.pendingSlips ? '⏳ ต้องอนุมัติ' : '✅ ว่าง'}</div></div>
  </div>`;

  const actions = [];
  if (b.staleOrders) actions.push(`<div class="action-card danger ripple" data-go="orders"><div class="action-icon">⏰</div><div class="action-info"><div class="action-title">ออเดอร์ค้างเกิน 15 นาที</div><div class="action-value">${b.staleOrders} รายการ</div></div><button class="action-btn orange">ดู →</button></div>`);
  if (b.pendingSlips) actions.push(`<div class="action-card warn ripple" data-go="orders"><div class="action-icon">📸</div><div class="action-info"><div class="action-title">สลิปรอตรวจสอบ</div><div class="action-value">${b.pendingSlips} ใบ</div></div><button class="action-btn orange">ตรวจ →</button></div>`);
  if (b.pendingMerchants) actions.push(`<div class="action-card blue ripple" data-go="merchants"><div class="action-icon">🏪</div><div class="action-info"><div class="action-title">ร้านค้ารออนุมัติ</div><div class="action-value">${b.pendingMerchants} ร้าน</div></div><button class="action-btn blue">ดู →</button></div>`);
  if (b.pendingRiders) actions.push(`<div class="action-card blue ripple" data-go="riders"><div class="action-icon">🛵</div><div class="action-info"><div class="action-title">ไรเดอร์รออนุมัติ</div><div class="action-value">${b.pendingRiders} คน</div></div><button class="action-btn blue">ดู →</button></div>`);
  if (!actions.length) actions.push(`<div class="action-card green" style="text-align:center;flex-direction:column;padding:24px"><div style="font-size:48px">✅</div><div class="action-title" style="font-size:15px">ทุกอย่างเรียบร้อย!</div></div>`);

  const recent = [...store.orders].sort((a,b) => ts(b) - ts(a)).slice(0, 5).map(o => {
    const color = { done:'#00A651', cancelled:'#999', searching:'#E65100', accepted:'#1565C0' }[o.status] || '#666';
    return `<div class="ripple" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;min-height:60px" data-order="${esc(o.id)}">
      <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.title || 'ออเดอร์')}</div>
        <div style="font-size:11px;color:var(--mut);margin-top:2px">${fmtTime(o.createdAt)} • ${esc(STATUS[o.status] || o.status)}</div>
      </div>
    </div>`;
  }).join('');

  return `${hero}${stats}
    <div class="section-divider"><div class="title">🎯 ต้องทำอะไรต่อ</div><div class="line"></div></div>
    ${actions.join('')}
    <div class="section-divider"><div class="title">🕐 ออเดอร์ล่าสุด</div><div class="line"></div></div>
    <div class="card" style="padding:16px">${recent || '<div style="text-align:center;padding:20px;color:#999">ยังไม่มีออเดอร์</div>'}</div>`;
}

// ═══ GP ═══
function getGPByRange(range) {
  const completed = store.orders.filter(o => ['done', 'delivered'].includes(o.status));
  const filtered = completed.filter(o => {
    const d = toDate(o.createdAt); if (!d) return false;
    if (range === 'today') return isToday(d);
    if (range === 'week') return isWeek(d);
    if (range === 'month') return isMonth(d);
    return true;
  });
  let total = 0, totalFare = 0;
  const byRider = {}, byMerchant = {};
  filtered.forEach(o => {
    const fare = Number(o.fare || 0);
    const gp = Math.round(fare * 0.20 * 100) / 100;
    total += gp; totalFare += fare;
    const rId = o.riderId || 'unknown';
    if (!byRider[rId]) byRider[rId] = { name: o.riderName || 'ไม่ระบุ', gp: 0, count: 0 };
    byRider[rId].gp += gp; byRider[rId].count++;
    const mId = o.merchantId || 'unknown';
    if (!byMerchant[mId]) byMerchant[mId] = { name: o.merchantName || store.merchants.find(m => m.id === mId)?.name || 'ไม่ระบุ', gp: 0, count: 0 };
    byMerchant[mId].gp += gp; byMerchant[mId].count++;
  });
  return { total, totalFare, count: filtered.length, byRider, byMerchant };
}

function gp() {
  const range = filters.gpRange;
  const current = getGPByRange(range);
  const tabs = `<div class="range-tabs">
    <button class="range-tab ${range === 'today' ? 'active' : ''}" data-gp-range="today">วันนี้</button>
    <button class="range-tab ${range === 'week' ? 'active' : ''}" data-gp-range="week">7 วัน</button>
    <button class="range-tab ${range === 'month' ? 'active' : ''}" data-gp-range="month">30 วัน</button>
    <button class="range-tab ${range === 'all' ? 'active' : ''}" data-gp-range="all">ทั้งหมด</button>
  </div>`;

  const riderRows = Object.entries(current.byRider).sort((a,b) => b[1].gp - a[1].gp);
  const merchantRows = Object.entries(current.byMerchant).sort((a,b) => b[1].gp - a[1].gp);

  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-weight:900;font-size:18px">💰 GP Dashboard</div><span class="tag b">GP 20%</span>
  </div>
  ${tabs}
  <div class="stat-grid">
    <div class="stat-card gold"><div class="stat-icon">💰</div><div class="stat-value">฿${current.total.toFixed(0)}</div><div class="stat-label">GP รวม</div><div class="stat-sub">${current.count} ออเดอร์</div></div>
    <div class="stat-card blue"><div class="stat-icon">📊</div><div class="stat-value">฿${current.totalFare.toFixed(0)}</div><div class="stat-label">ยอดขาย</div></div>
  </div>
  <div class="section-divider"><div class="title">🛵 GP รายไรเดอร์</div><div class="line"></div></div>
  <div class="table-wrap"><table class="gp-table">
    <thead><tr><th>ไรเดอร์</th><th class="text-center">งาน</th><th class="text-right">GP</th><th class="text-right">ไรเดอร์ได้</th></tr></thead>
    <tbody>${riderRows.length ? riderRows.map(([id, r]) => `<tr><td style="font-weight:900">🛵 ${esc(r.name)}</td><td class="text-center">${r.count}</td><td class="text-right money-pos">฿${r.gp.toFixed(2)}</td><td class="text-right" style="color:var(--mut)">฿${(r.gp*4).toFixed(0)}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table></div>
  <div class="section-divider" style="margin-top:20px"><div class="title">🏪 GP รายร้านค้า</div><div class="line"></div></div>
  <div class="table-wrap"><table class="gp-table">
    <thead><tr><th>ร้านค้า</th><th class="text-center">งาน</th><th class="text-right">GP</th><th class="text-right">ร้านได้</th></tr></thead>
    <tbody>${merchantRows.length ? merchantRows.map(([id, m]) => `<tr><td style="font-weight:900">🏪 ${esc(m.name)}</td><td class="text-center">${m.count}</td><td class="text-right money-pos">฿${m.gp.toFixed(2)}</td><td class="text-right" style="color:var(--mut)">฿${(m.gp*4).toFixed(0)}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table></div>`;
}

// ═══ FINANCE ═══
function finance() {
  const completed = store.orders.filter(o => ['done','delivered'].includes(o.status));
  let totalGross = 0, totalGP = 0, totalRider = 0;
  const byRider = {};
  completed.forEach(o => {
    const fare = Number(o.fare || 0);
    if (fare <= 0) return;
    const gp = Math.round(fare * 0.20 * 100) / 100;
    const riderEarn = fare - gp;
    totalGross += fare; totalGP += gp; totalRider += riderEarn;
    const rId = o.riderId || 'unknown';
    if (!byRider[rId]) byRider[rId] = { name: o.riderName || 'ไม่ระบุ', earn: 0, count: 0 };
    byRider[rId].earn += riderEarn; byRider[rId].count++;
  });
  const rows = Object.values(byRider).sort((a,b) => b.earn - a.earn);
  return `<div class="stat-grid">
    <div class="stat-card blue"><div class="stat-icon">💰</div><div class="stat-value">฿${totalGross.toFixed(0)}</div><div class="stat-label">ยอดขายรวม</div></div>
    <div class="stat-card gold"><div class="stat-icon">📊</div><div class="stat-value">฿${totalGP.toFixed(0)}</div><div class="stat-label">GP แพลตฟอร์ม</div></div>
    <div class="stat-card green"><div class="stat-icon">🛵</div><div class="stat-value">฿${totalRider.toFixed(0)}</div><div class="stat-label">ไรเดอร์ 80%</div></div>
    <div class="stat-card purple"><div class="stat-icon">📋</div><div class="stat-value">${completed.length}</div><div class="stat-label">ออเดอร์เสร็จ</div></div>
  </div>
  <div class="table-wrap"><table class="gp-table">
    <thead><tr><th>ไรเดอร์</th><th class="text-center">งาน</th><th class="text-right">รายได้</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr><td style="font-weight:900">${esc(r.name)}</td><td class="text-center">${r.count}</td><td class="text-right money-pos">฿${r.earn.toFixed(2)}</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;padding:20px;color:#999">ยังไม่มีข้อมูล</td></tr>'}</tbody>
  </table></div>`;
}

// ═══ CHATS ═══
function chats() {
  const list = [...store.chats].sort((a,b) => ts(b) - ts(a));
  if (!list.length) return `<div class="empty"><div style="font-size:48px;margin-bottom:8px">💬</div><div style="font-weight:800;font-size:15px">ยังไม่มีการสนทนา</div></div>`;
  return list.map(c => {
    const title = c.participants?.map(p => p.name).join(' ↔ ') || 'การสนทนา';
    const unread = c.unreadAdmin || 0;
    return `<div class="data-card" data-open-chat="${esc(c.id)}">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E8F5E9">💬</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(title)}</div>
          <div class="data-card-meta">${esc((c.lastMessage || '—').substring(0, 50))}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:var(--mut);font-weight:700">${fmtTimeShort(c.lastMessageAt || c.createdAt)}</div>
          ${unread > 0 ? `<div style="background:var(--danger);color:#fff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:900;margin-top:4px">${unread}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function openChat(chatId) {
  activeChatId = chatId;
  const c = store.chats.find(x => x.id === chatId);
  if (!c) return;
  $('chat-name').textContent = c.participants?.map(p => p.name).join(' ↔ ') || 'แชท';
  $('chat-sub').textContent = c.type === 'rider_merchant' ? 'ไรเดอร์ ↔ ร้านค้า' : 'การสนทนา';
  $('chat-container').classList.add('show');
  $('chat-input').value = '';
  if (c.unreadAdmin > 0) db.collection('chats').doc(chatId).update({ unreadAdmin: 0 }).catch(() => {});
  if (activeChatUnsub) activeChatUnsub();
  activeChatUnsub = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(100)
    .onSnapshot(s => renderChatMessages(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

function closeChat() {
  $('chat-container').classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function renderChatMessages(msgs) {
  if (!msgs.length) { $('chat-messages').innerHTML = '<div class="chat-empty">เริ่มสนทนา</div>'; return; }
  let lastDay = '';
  $('chat-messages').innerHTML = msgs.map(m => {
    const isAdmin = m.senderRole === 'admin';
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) { dayDiv = `<div class="chat-day-divider">${day}</div>`; lastDay = day; }
    const cls = isAdmin ? 'out' : 'in';
    const img = m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-image" onclick="window.open('${esc(m.imageUrl)}','_blank')">` : '';
    const name = !isAdmin && m.senderName ? `<div style="font-size:10px;font-weight:900;opacity:.8;margin-bottom:4px">${esc(m.senderName)}</div>` : '';
    return `${dayDiv}<div class="chat-msg ${cls}">${name}${img}${m.text ? `<div>${esc(m.text)}</div>` : ''}<div class="msg-time">${fmtTimeShort(m.createdAt)}</div></div>`;
  }).join('');
  setTimeout(() => { $('chat-messages').scrollTop = $('chat-messages').scrollHeight; }, 50);
}

async function sendChatText() {
  const text = $('chat-input').value.trim();
  if (!text || !activeChatId) return;
  $('chat-input').value = ''; $('chat-input').style.height = 'auto';
  try {
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text, senderRole: 'admin', senderName: 'Admin',
      senderId: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: `[Admin] ${text}`,
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { toast('ส่งไม่สำเร็จ', true); }
}

function pickChatImage() { $('chat-image-input').click(); }

async function sendChatImage(file) {
  if (!file || !activeChatId) return;
  if (file.size > 5 * 1024 * 1024) return toast('รูปใหญ่เกิน 5MB', true);
  toast('⏳ กำลังอัปโหลด...');
  try {
    const ref = storage.ref(`chats/${activeChatId}/${Date.now()}.jpg`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url, senderRole: 'admin', senderName: 'Admin',
      senderId: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '[Admin] 📷 รูปภาพ',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ ส่งรูปแล้ว');
  } catch (e) { toast('อัปโหลดไม่สำเร็จ', true); }
}

function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

// ═══ MERCHANTS ═══
function merchants() {
  const q = filters.q.toLowerCase(), st = filters.merchantStatus;
  const list = store.merchants.filter(m => {
    const mQ = !q || String(m.name || '').toLowerCase().includes(q);
    const mS = st === 'all' || (st === 'pending' && !m.verified) || (st === 'verified' && m.verified);
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
  ${list.map(m => `<div class="data-card">
    <div class="data-card-header">
      <div class="data-card-icon" style="background:#E8F5E9">🏪</div>
      <div class="data-card-info">
        <div class="data-card-name">${esc(m.name || 'ไม่ระบุ')}</div>
        <div class="data-card-meta">📞 ${esc(m.phone || '—')}</div>
        <div class="data-card-meta" style="font-family:monospace">🆔 ${esc((m.id || '').slice(0, 12))}...</div>
      </div>
      <span class="tag ${m.verified ? '' : 'w'}">${m.verified ? '✅' : '⏳'}</span>
    </div>
    <div class="data-card-actions">
      <button class="${m.verified ? 'dan' : 'pri'}" data-verify="${esc(m.id)}">${m.verified ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
      <button class="blue" data-edit-m="${esc(m.id)}">✏️ แก้ไข</button>
      <button class="dan" data-del="merchants:${esc(m.id)}">🗑️</button>
    </div>
  </div>`).join('') || '<div class="empty">ไม่พบร้านค้า</div>'}`;
}

// ═══ ORDERS ═══
function orders() {
  const q = filters.q.toLowerCase();
  let list = store.orders.filter(o =>
    (filters.orders === 'all' || o.status === filters.orders) &&
    (!q || [o.title, o.userName, o.id].some(v => String(v || '').toLowerCase().includes(q)))
  );
  list.sort((a, b) => ts(b) - ts(a));
  const sel = `<select id="ofilter" style="margin-bottom:16px;padding:12px;min-height:52px;max-width:200px">
    <option value="all">ทุกสถานะ</option>
    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filters.orders === k ? 'selected' : ''}>${v}</option>`).join('')}
  </select>`;
  return searchInput('ค้นหาออเดอร์...') + sel + (list.map(o => {
    const slipBadge = o.riderSlipUrl ? (o.riderSlipVerified ? '<span class="tag">📸 ✅</span>' : '<span class="tag w">📸 รอ</span>') : '';
    return `<div class="data-card" data-order="${esc(o.id)}">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E3F2FD">📋</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(o.title || 'ออเดอร์')}</div>
          <div class="data-card-meta">฿${esc(o.total || 0)} • 👤 ${esc(o.userName || '—')}</div>
          <div class="data-card-meta">🕐 ${fmtTime(o.createdAt)}</div>
          ${slipBadge ? `<div style="margin-top:6px">${slipBadge}</div>` : ''}
        </div>
        <span class="tag ${o.status === 'done' ? '' : o.status === 'cancelled' ? 'x' : 'w'}">${esc(STATUS[o.status] || o.status)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty">ไม่พบออเดอร์</div>');
}

// ═══ RIDERS ═══
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
    return `<div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E8F5E9">🛵</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(r.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📞 ${esc(r.phone || '—')} • ${esc(r.vehicle || '')} ${esc(r.plate || '')}</div>
          <div class="data-card-meta" style="font-family:monospace">🆔 ${esc((r.id || '').slice(0, 12))}...</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <span class="tag ${v ? '' : 'w'}">${v ? '✅' : '⏳'}</span>
          <span class="tag ${online ? '' : 'x'}">${online ? '🟢' : '⚫'}</span>
        </div>
      </div>
      <div class="data-card-actions">
        <button class="${v ? 'dan' : 'pri'}" data-verify-r="${esc(r.id)}">${v ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
        <button class="blue" data-edit-r="${esc(r.id)}">🔗 Link</button>
        <button class="${online ? 'dan' : 'pri'}" data-rider="${esc(r.id)}">${online ? '⏸️' : '▶️'}</button>
        <button class="dan" data-del="riders:${esc(r.id)}">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">ไม่พบไรเดอร์</div>'}`;
}

// ═══ USERS ═══
function users() {
  const q = filters.q.toLowerCase();
  const list = store.users.filter(u => !q || [u.name, u.email, u.phone].some(v => String(v || '').toLowerCase().includes(q)));
  return searchInput('ค้นหาผู้ใช้...') + (list.map(u => `<div class="data-card">
    <div class="data-card-header">
      <div class="data-card-icon" style="background:#E3F2FD">👤</div>
      <div class="data-card-info">
        <div class="data-card-name">${esc(u.name || 'ไม่ระบุ')}</div>
        <div class="data-card-meta">📧 ${esc(u.email || '—')}</div>
        <div class="data-card-meta">🎭 Role: ${esc(u.role || '—')}</div>
      </div>
      <span class="tag b">${esc(u.role || 'user')}</span>
    </div>
    <div class="data-card-actions"><button class="dan" data-del="users:${esc(u.id)}">🗑️ ลบ</button></div>
  </div>`).join('') || '<div class="empty">ไม่พบผู้ใช้</div>');
}

// ═══ MODALS ═══
function openModal(t, h) { $('modal-title').textContent = t; $('modal-body').innerHTML = h; $('modal-overlay').classList.add('show'); }
function closeModal() { $('modal-overlay').classList.remove('show'); }

function orderDetail(id) {
  const o = store.orders.find(x => x.id === id); if (!o) return;
  const opts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('');
  const slipSection = o.riderSlipUrl ? `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee">
      <div style="font-weight:900;margin-bottom:8px;font-size:13px">📸 สลิปจากไรเดอร์</div>
      ${o.riderSlipVerified ? '<div class="slip-status-banner ok">✅ ตรวจสอบแล้ว</div>' : '<div class="slip-status-banner pending">⏳ รอตรวจสอบ</div>'}
      <img src="${esc(o.riderSlipUrl)}" class="slip-preview" onclick="window.open('${esc(o.riderSlipUrl)}','_blank')">
      ${!o.riderSlipVerified ? `<div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="pri" style="flex:1" data-verify-slip="${esc(o.id)}">✅ อนุมัติ</button>
        <button class="dan" style="flex:1" data-reject-slip="${esc(o.id)}">❌ ปฏิเสธ</button>
      </div>` : ''}
    </div>` : '';
  openModal('📋 ออเดอร์', `
    <div class="meta" style="font-family:monospace">ID: ${esc(o.id)}</div>
    <div class="nm" style="font-size:18px;margin:8px 0">${esc(o.title || '')}</div>
    <div class="meta" style="white-space:pre-wrap;background:#f8f9fa;padding:12px;border-radius:10px">${esc(itemsText(o.items))}</div>
    <div class="meta" style="margin-top:12px">👤 ${esc(o.userName || '')} • ${esc(o.userPhone || '')}</div>
    <div class="meta">📍 ${esc(o.address || '')}</div>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div><div class="meta">ค่าส่ง ฿${esc(o.fare||0)}</div><div style="font-size:20px;font-weight:900;color:var(--brand)">รวม ฿${esc(o.total||0)}</div></div>
      <select id="ostatus" data-oid="${esc(o.id)}" style="width:auto;padding:12px;min-height:48px">${opts}</select>
    </div>
    ${slipSection}
    <button class="dan big" style="margin-top:16px;width:100%" data-cancel-order="${esc(o.id)}">❌ ยกเลิกออเดอร์</button>
  `);
}

function editMerchantForm(id) {
  const m = store.merchants.find(x => x.id === id); if (!m) return;
  openModal('✏️ แก้ไขร้าน', `
    <label style="font-weight:800;font-size:13px">ชื่อร้าน</label>
    <input type="text" id="edit-name" value="${esc(m.name || '')}">
    <label style="font-weight:800;font-size:13px">เบอร์</label>
    <input type="tel" id="edit-phone" value="${esc(m.phone || '')}">
    <label style="font-weight:800;font-size:13px">ที่อยู่</label>
    <textarea id="edit-address" rows="2">${esc(m.address || '')}</textarea>
    <button class="pri big" style="width:100%" data-save-merchant="${esc(id)}">💾 บันทึก</button>
  `);
}

function editRiderForm(id) {
  const r = store.riders.find(x => x.id === id); if (!r) return;
  const selM = r.merchantIds || [], selL = r.locationIds || [];
  const mp = `<div class="picker">${store.merchants.map(m => `<label><input type="checkbox" class="merchant-check" value="${esc(m.id)}" ${selM.includes(m.id) ? 'checked' : ''}><span>🏪 ${esc(m.name || '-')}</span></label>`).join('')}</div>`;
  const lp = `<div class="picker">${store.places.slice(0, 100).map(p => `<label><input type="checkbox" class="location-check" value="${esc(p.id)}" ${selL.includes(p.id) ? 'checked' : ''}><span>📍 ${esc(p.name)}</span></label>`).join('')}</div>`;
  openModal('🔗 Link ไรเดอร์', `
    <div style="font-weight:900;margin-bottom:12px">${esc(r.name || '-')}</div>
    <label style="font-weight:800;font-size:13px;display:block;margin-bottom:8px">🏪 ร้านที่ดูแล</label>
    ${mp}
    <label style="font-weight:800;font-size:13px;display:block;margin:16px 0 8px">📍 สถานที่</label>
    ${lp}
    <button class="pri big" style="margin-top:16px;width:100%" data-save-rider-link="${esc(id)}">💾 บันทึก</button>
  `);
}

// ═══ EVENTS ═══
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-order],[data-verify],[data-verify-r],[data-rider],[data-del],[data-edit-m],[data-edit-r],[data-merchant-status],[data-rider-status],[data-gp-range],[data-open-chat],[data-verify-slip],[data-reject-slip],[data-cancel-order],[data-save-merchant],[data-save-rider-link]');
  if (!t) return;
  try {
    if (t.dataset.go) { current = t.dataset.go; filters.q = ''; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.gpRange) { filters.gpRange = t.dataset.gpRange; render(); return; }
    if (t.dataset.merchantStatus) { filters.merchantStatus = t.dataset.merchantStatus; render(); return; }
    if (t.hasAttribute('data-rider-status')) { filters.riderStatus = t.dataset.riderStatus; render(); return; }
    if (t.dataset.openChat) { openChat(t.dataset.openChat); return; }
    if (t.dataset.order) { orderDetail(t.dataset.order); return; }
    if (t.dataset.editM) { editMerchantForm(t.dataset.editM); return; }
    if (t.dataset.editR) { editRiderForm(t.dataset.editR); return; }
    if (t.dataset.verify) {
      const m = store.merchants.find(x => x.id === t.dataset.verify);
      if (m) await db.collection('merchants').doc(m.id).update({ verified: !m.verified, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('✅ อัปเดต'); return;
    }
    if (t.dataset.verifyR) {
      const r = store.riders.find(x => x.id === t.dataset.verifyR);
      if (r) {
        const nv = r.verified === false;
        await db.collection('riders').doc(r.id).update({ verified: nv, verifiedAt: nv ? firebase.firestore.FieldValue.serverTimestamp() : null });
        toast(nv ? '✅ อนุมัติ' : '🚫 ยกเลิก');
      } return;
    }
    if (t.dataset.rider) {
      const r = store.riders.find(x => x.id === t.dataset.rider);
      if (r) {
        const online = ['active','available','online'].includes(r.status);
        await db.collection('riders').doc(r.id).update({ status: online ? 'inactive' : 'active' });
        toast('✅ อัปเดต');
      } return;
    }
    if (t.dataset.saveMerchant) {
      await db.collection('merchants').doc(t.dataset.saveMerchant).update({
        name: $('edit-name').value.trim(),
        phone: $('edit-phone').value.trim(),
        address: $('edit-address').value.trim()
      });
      toast('✅ บันทึก'); closeModal(); return;
    }
    if (t.dataset.saveRiderLink) {
      const mIds = [...document.querySelectorAll('.merchant-check:checked')].map(cb => cb.value);
      const lIds = [...document.querySelectorAll('.location-check:checked')].map(cb => cb.value);
      await db.collection('riders').doc(t.dataset.saveRiderLink).update({ merchantIds: mIds, locationIds: lIds });
      toast('✅ บันทึก'); closeModal(); return;
    }
    if (t.dataset.verifySlip) {
      await db.collection('orders').doc(t.dataset.verifySlip).update({ riderSlipVerified: true, riderSlipVerifiedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('✅ อนุมัติสลิป'); orderDetail(t.dataset.verifySlip); return;
    }
    if (t.dataset.rejectSlip) {
      if (!confirm('ปฏิเสธสลิป?')) return;
      await db.collection('orders').doc(t.dataset.rejectSlip).update({ riderSlipUrl: null, riderSlipVerified: false });
      toast('❌ ปฏิเสธ'); orderDetail(t.dataset.rejectSlip); return;
    }
    if (t.dataset.cancelOrder) {
      if (!confirm('ยกเลิก?')) return;
      await db.collection('orders').doc(t.dataset.cancelOrder).update({ status: 'cancelled' });
      toast('ยกเลิก'); closeModal(); return;
    }
    if (t.dataset.del) {
      const [col, id] = t.dataset.del.split(':');
      if (confirm('⚠️ ลบ?')) { await db.collection(col).doc(id).delete(); toast('ลบแล้ว'); }
      return;
    }
  } catch (err) { logToScreen('❌ ' + err.message, true); toast('ไม่สำเร็จ', true); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    filters.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'ofilter') { filters.orders = e.target.value; render(); }
  if (e.target.id === 'ostatus') {
    await db.collection('orders').doc(e.target.dataset.oid).update({ status: e.target.value });
    toast('✅ อัปเดต'); closeModal();
  }
});

$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(); } });

document.addEventListener('click', e => {
  const el = e.target.closest('button, .data-card, nav button, .stat-card, .action-card');
  if (el && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// ═══ NETWORK & PWA ═══
function setupNetworkWatcher() {
  window.addEventListener('online', () => { $('offlineBar').classList.remove('show'); toast('🟢 กลับมาออนไลน์'); });
  window.addEventListener('offline', () => $('offlineBar').classList.add('show'));
  if (!navigator.onLine) $('offlineBar').classList.add('show');
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('pwa_dismissed')) $('pwaBanner').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => { $('pwaBanner').classList.add('hidden'); logToScreen('✅ PWA ติดตั้งแล้ว'); });
}

async function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice;
    if (r.outcome === 'accepted') { toast('✅ ติดตั้งสำเร็จ'); $('pwaBanner').classList.add('hidden'); }
    deferredPrompt = null;
  } else toast('เปิดเมนู → เพิ่มไปที่หน้าจอหลัก', true);
}

function hidePWABanner() { $('pwaBanner').classList.add('hidden'); localStorage.setItem('pwa_dismissed', '1'); }

// ═══ LOG ═══
console.log('%c🛵 Chauat Go Admin v3.3.3', 'color:#76B82A;font-weight:900;font-size:16px');
console.log('%c✓ Master Admin Bypass | ✓ GP | ✓ Finance | ✓ Chat | ✓ Slips', 'color:#1565C0;font-weight:700');