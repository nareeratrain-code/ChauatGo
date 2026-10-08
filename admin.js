// ═══════════════════════════════════════════════════════════════════
//  🛵 CHAUAT GO ADMIN v3.3.3 - Production Ready
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

// ─── Global State ───
const store = { merchants: [], orders: [], riders: [], users: [], places: [], chats: [] };
const filters = { orders: 'all', q: '', riderStatus: '', merchantStatus: 'all', gpRange: 'today' };
let current = 'dashboard';
let unsubs = [];
let activeChatId = null;
let activeChatUnsub = null;

const MASTER_ADMINS = [
  'adminchauatgo@gmail.com',
  'admin@chauatgo.com',
  'chauatgo@gmail.com'
];

const SECTIONS = [
  ['dashboard', '📊', 'แดชบอร์ด'],
  ['gp',        '💰', 'GP'],
  ['finance',   '🧾', 'บัญชี'],
  ['chats',     '💬', 'แชท'],
  ['merchants', '🏪', 'ร้านค้า'],
  ['orders',    '📋', 'ออเดอร์'],
  ['riders',    '🛵', 'ไรเดอร์'],
  ['users',     '👥', 'ผู้ใช้']
];

const STATUS = {
  searching:'⏳ หาไรเดอร์', pending:'🔔 รอรับ', accepted:'🛵 รับแล้ว',
  picked_up:'📦 รับของ', on_the_way:'🚀 กำลังส่ง', done:'✅ เสร็จ', cancelled:'❌ ยกเลิก'
};

// ─── Helpers ───
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(m, err) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 3000);
}

function logToScreen(msg, isError = false) {
  const el = $('debugConsole');
  if (el) {
    el.style.display = 'block';
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${msg}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}

const ts = o => o.createdAt?.seconds || 0;
const toDate = t => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? null : d; };
const fmtTime = t => { if (!t) return '—'; const d = toDate(t); return d ? d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
const fmtTimeShort = t => { if (!t) return ''; const d = toDate(t); return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''; };
const itemsText = i => Array.isArray(i) ? i.map(x => `${x.name} x${x.qty}`).join(', ') : String(i ?? '');

// ═══════════════════════════════════════════════════════════════════
//  🔐 AUTH - LOGIN / SIGNUP / LOGOUT
// ═══════════════════════════════════════════════════════════════════

function switchTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login-btn').classList.toggle('active', isLogin);
  $('tab-signup-btn').classList.toggle('active', !isLogin);
  $('form-login').style.display = isLogin ? 'block' : 'none';
  $('form-signup').style.display = isLogin ? 'none' : 'block';
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const btn = $('btn-login');
  const email = $('em').value.trim().toLowerCase();
  const pw = $('pw').value;
  
  if (!email || !pw) { toast('กรอกอีเมลและรหัสผ่าน', true); return; }
  
  btn.disabled = true;
  const origTxt = btn.textContent;
  btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  logToScreen(`🔐 ล็อกอิน: ${email}`);
  
  try {
    const cred = await auth.signInWithEmailAndPassword(email, pw);
    logToScreen(`✅ ล็อกอินสำเร็จ: ${cred.user.email}`);
    toast('✅ เข้าสู่ระบบสำเร็จ');
  } catch (err) {
    logToScreen(`❌ ล็อกอินล้มเหลว: ${err.code}`, true);
    const msg = err.code === 'auth/wrong-password' ? 'รหัสผ่านไม่ถูกต้อง'
      : err.code === 'auth/user-not-found' ? 'ไม่พบบัญชีนี้ในระบบ'
      : err.code === 'auth/invalid-email' ? 'รูปแบบอีเมลไม่ถูกต้อง'
      : err.code === 'auth/invalid-credential' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      : err.code === 'auth/too-many-requests' ? 'ลองหลายครั้งเกินไป รอ 5 นาที'
      : err.code === 'auth/network-request-failed' ? 'ไม่มีการเชื่อมต่อ'
      : 'เข้าสู่ระบบไม่สำเร็จ: ' + err.code;
    toast(msg, true);
    btn.disabled = false;
    btn.textContent = origTxt;
  }
  $('pw').value = '';
}

async function handleForgot() {
  const email = $('em').value.trim();
  if (!email) return toast('กรอกอีเมลก่อน', true);
  try {
    await auth.sendPasswordResetEmail(email);
    toast('📧 ส่งลิงก์รีเซ็ตไปที่อีเมลแล้ว');
  } catch (err) { toast('ส่งไม่สำเร็จ: ' + err.message, true); }
}

async function handleSignup() {
  const name = $('su-name').value.trim(), email = $('su-email').value.trim();
  const pw = $('su-pw').value, pw2 = $('su-pw2').value;
  if (!name || !email || !pw) return toast('กรอกให้ครบ', true);
  if (pw.length < 6) return toast('รหัสผ่าน 6+ ตัว', true);
  if (pw !== pw2) return toast('รหัสไม่ตรงกัน', true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('admins').doc(cred.user.uid).set({
      name, email, role: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ สมัครสำเร็จ! รออนุมัติ');
    switchTab('login');
    $('em').value = email;
  } catch (err) { toast('สมัครไม่สำเร็จ: ' + err.message, true); }
}

$('logout').addEventListener('click', async () => {
  stop();
  await auth.signOut();
});

// ═══════════════════════════════════════════════════════════════════
//  🔄 AUTH STATE CHANGE
// ═══════════════════════════════════════════════════════════════════

auth.onAuthStateChanged(async user => {
  stop();
  if (!user) {
    logToScreen('⛔ ไม่มีผู้ใช้ล็อกอิน');
    $('login').classList.remove('hidden');
    $('app').classList.add('hidden');
    return;
  }
  
  const userEmail = (user.email || '').toLowerCase().trim();
  const isMasterAdmin = MASTER_ADMINS.some(e => e.toLowerCase() === userEmail);
  
  logToScreen(`👤 ล็อกอิน: ${userEmail}`);
  logToScreen(`🔑 Master Admin: ${isMasterAdmin ? 'ใช่' : 'ไม่ใช่'}`);
  
  if (!isMasterAdmin) {
    try {
      logToScreen('🔍 เช็คสิทธิ์ใน Firestore (admins)...');
      const adminSnap = await db.collection('admins').doc(user.uid).get();
      const isFirestoreAdmin = adminSnap.exists && ['active', 'super'].includes(adminSnap.data().role);
      if (!isFirestoreAdmin) {
        logToScreen('❌ ไม่พบสิทธิ์ Admin', true);
        toast('บัญชีนี้ไม่มีสิทธิ์เป็นผู้ดูแล', true);
        await auth.signOut();
        return;
      }
      logToScreen('✅ พบสิทธิ์ Admin');
    } catch (err) {
      logToScreen(`❌ Firestore Error: ${err.code}`, true);
      // ถ้า Master Admin อยู่แล้วให้ผ่าน แต่ถ้าไม่ใช่ให้เด้ง
      if (!isMasterAdmin) {
        toast('บัญชีนี้ไม่มีสิทธิ์เป็นผู้ดูแล', true);
        await auth.signOut();
        return;
      }
    }
  }
  
  logToScreen('🚀 เข้าสู่ระบบ Admin สำเร็จ!');
  $('who').textContent = user.email;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  start();
});

// ═══════════════════════════════════════════════════════════════════
//  📡 START / STOP SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════

function start() {
  for (const k of ['merchants', 'orders', 'riders', 'users', 'chats']) {
    const unsub = db.collection(k).onSnapshot(s => {
      store[k] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, err => { logToScreen(`❌ [${k}] ${err.code}`, true); });
    unsubs.push(unsub);
  }
  
  const unsubPlaces = db.collection('places').limit(500).onSnapshot(s => {
    store.places = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => { logToScreen(`❌ [places] ${err.code}`, true); });
  unsubs.push(unsubPlaces);
  
  renderNav();
  render();
}

function stop() {
  unsubs.forEach(u => u());
  unsubs = [];
  for (const k in store) store[k] = [];
}

// ═══════════════════════════════════════════════════════════════════
//  📊 BADGE COUNTS
// ═══════════════════════════════════════════════════════════════════

function getBadgeCounts() {
  const pendingMerchants = store.merchants.filter(m => !m.verified).length;
  const pendingRiders = store.riders.filter(r => r.verified === false).length;
  const newOrders = store.orders.filter(o => ['searching', 'pending'].includes(o.status)).length;
  const pendingSlips = store.orders.filter(o => o.riderSlipUrl && !o.riderSlipVerified).length;
  const unreadChats = store.chats.reduce((sum, c) => sum + (c.unreadAdmin || 0), 0);
  const staleOrders = store.orders.filter(o => {
    if (!['searching', 'pending'].includes(o.status)) return false;
    const d = toDate(o.createdAt);
    if (!d) return false;
    return (Date.now() - d.getTime()) > 15 * 60 * 1000;
  }).length;
  return { pendingMerchants, pendingRiders, newOrders, pendingSlips, unreadChats, staleOrders };
}

// ═══════════════════════════════════════════════════════════════════
//  🎨 RENDER
// ═══════════════════════════════════════════════════════════════════

function renderNav() {
  const b = getBadgeCounts();
  $('nav').innerHTML = SECTIONS.map(([k, icon, label]) => {
    let badge = '';
    if (k === 'merchants' && b.pendingMerchants > 0) badge = `<span class="nav-badge">${b.pendingMerchants}</span>`;
    else if (k === 'riders' && b.pendingRiders > 0) badge = `<span class="nav-badge">${b.pendingRiders}</span>`;
    else if (k === 'orders' && b.newOrders > 0) badge = `<span class="nav-badge">${b.newOrders}</span>`;
    else if (k === 'chats' && b.unreadChats > 0) badge = `<span class="nav-badge">${b.unreadChats}</span>`;
    return `<button class="ripple ${k === current ? 'on' : ''}" data-go="${k}">
      ${badge}
      <div class="nav-icon">${icon}</div>
      <div class="nav-label">${label}</div>
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

// ═══════════════════════════════════════════════════════════════════
//  📊 DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function dashboard() {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const completedAll = store.orders.filter(o => o.status === 'done');
  const activeOrders = store.orders.filter(o => ['searching','pending','accepted','picked_up','on_the_way'].includes(o.status));

  let todayRevenue = 0, todayOrders = 0, yesterdayRevenue = 0;
  completedAll.forEach(o => {
    const fare = Number(o.fare || 0);
    const myCut = Math.round(fare * 0.20 * 100) / 100;
    const d = toDate(o.createdAt); if (!d) return;
    if (d >= today) { todayRevenue += myCut; todayOrders++; }
    else if (d >= yesterday && d < today) { yesterdayRevenue += myCut; }
  });

  const trend = yesterdayRevenue > 0 ? Math.round((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100) : (todayRevenue > 0 ? 100 : 0);
  const trendUp = trend >= 0;

  const b = getBadgeCounts();
  const activeRiders = store.riders.filter(r => r.status === 'active' && r.verified !== false).length;
  const totalMerchants = store.merchants.filter(m => m.verified).length;

  const heroSection = `
    <div class="hero-card">
      <div class="hero-label">💰 รายได้วันนี้</div>
      <div class="hero-amount">฿${todayRevenue.toLocaleString('th-TH', {minimumFractionDigits:2})}</div>
      <div class="hero-trend">${trendUp ? '📈' : '📉'} ${trendUp ? '+' : ''}${trend}% เทียบเมื่อวาน (฿${yesterdayRevenue.toFixed(0)})</div>
      <div class="hero-grid">
        <div class="hero-grid-cell"><div class="lbl">📦 งานเสร็จ</div><div class="val">${todayOrders} งาน</div></div>
        <div class="hero-grid-cell"><div class="lbl">🛵 กำลังทำ</div><div class="val">${activeOrders.length} งาน</div></div>
      </div>
    </div>`;

  const statCards = `
    <div class="stat-grid">
      <div class="stat-card blue ripple" data-go="merchants">
        <div class="stat-icon">🏪</div>
        <div class="stat-value">${store.merchants.length}</div>
        <div class="stat-label">ร้านค้าทั้งหมด</div>
        ${b.pendingMerchants > 0 ? `<div class="stat-sub">⏳ ${b.pendingMerchants} รออนุมัติ</div>` : `<div class="stat-sub">✅ อนุมัติแล้ว ${totalMerchants}</div>`}
      </div>
      <div class="stat-card purple ripple" data-go="riders">
        <div class="stat-icon">🛵</div>
        <div class="stat-value">${store.riders.length}</div>
        <div class="stat-label">ไรเดอร์ทั้งหมด</div>
        ${b.pendingRiders > 0 ? `<div class="stat-sub">⏳ ${b.pendingRiders} รออนุมัติ</div>` : `<div class="stat-sub">🟢 ทำงาน ${activeRiders}</div>`}
      </div>
      <div class="stat-card orange ripple" data-go="orders">
        <div class="stat-icon">📋</div>
        <div class="stat-value">${store.orders.length}</div>
        <div class="stat-label">ออเดอร์ทั้งหมด</div>
        ${b.newOrders > 0 ? `<div class="stat-sub">🔔 ใหม่ ${b.newOrders}</div>` : `<div class="stat-sub">✅ เสร็จ ${completedAll.length}</div>`}
      </div>
      <div class="stat-card teal ripple" data-go="users">
        <div class="stat-icon">👥</div>
        <div class="stat-value">${store.users.length}</div>
        <div class="stat-label">ผู้ใช้ทั้งหมด</div>
        <div class="stat-sub">ลูกค้าในระบบ</div>
      </div>
      <div class="stat-card gold ripple" data-go="gp">
        <div class="stat-icon">💰</div>
        <div class="stat-value">฿${todayRevenue.toFixed(0)}</div>
        <div class="stat-label">รายได้วันนี้ (GP)</div>
        <div class="stat-sub">GP 20% รวม</div>
      </div>
      <div class="stat-card ${b.pendingSlips > 0 ? 'red' : 'green'} ripple" data-go="orders">
        <div class="stat-icon">📸</div>
        <div class="stat-value">${b.pendingSlips}</div>
        <div class="stat-label">สลิปรอตรวจสอบ</div>
        <div class="stat-sub">${b.pendingSlips > 0 ? '⏳ ต้องอนุมัติ' : '✅ ว่าง'}</div>
      </div>
    </div>`;

  const actionItems = [];
  if (b.staleOrders > 0) actionItems.push(`
    <div class="action-card danger ripple" data-go="orders">
      <div class="action-icon">⏰</div>
      <div class="action-info">
        <div class="action-title" style="color:#991b1b">ออเดอร์ค้างเกิน 15 นาที</div>
        <div class="action-value" style="color:var(--danger)">${b.staleOrders} รายการ</div>
      </div>
      <button class="action-btn orange">ดูเลย →</button>
    </div>`);
  if (b.pendingSlips > 0) actionItems.push(`
    <div class="action-card warn ripple" data-go="orders">
      <div class="action-icon">📸</div>
      <div class="action-info">
        <div class="action-title">สลิปรอตรวจสอบ</div>
        <div class="action-value">${b.pendingSlips} ใบ</div>
      </div>
      <button class="action-btn orange">ตรวจสอบ →</button>
    </div>`);
  if (b.pendingMerchants > 0) actionItems.push(`
    <div class="action-card blue ripple" data-go="merchants">
      <div class="action-icon">🏪</div>
      <div class="action-info">
        <div class="action-title">ร้านค้ารออนุมัติ</div>
        <div class="action-value">${b.pendingMerchants} ร้าน</div>
      </div>
      <button class="action-btn blue">ตรวจสอบ →</button>
    </div>`);
  if (b.pendingRiders > 0) actionItems.push(`
    <div class="action-card blue ripple" data-go="riders">
      <div class="action-icon">🛵</div>
      <div class="action-info">
        <div class="action-title">ไรเดอร์รออนุมัติ</div>
        <div class="action-value">${b.pendingRiders} คน</div>
      </div>
      <button class="action-btn blue">ตรวจสอบ →</button>
    </div>`);
  if (actionItems.length === 0) actionItems.push(`
    <div class="action-card green" style="text-align:center;flex-direction:column;gap:6px;padding:24px">
      <div style="font-size:48px">✅</div>
      <div class="action-title" style="font-size:15px">ทุกอย่างเรียบร้อย!</div>
      <div class="action-sub">ไม่มีงานค้าง</div>
    </div>`);

  const recentOrders = [...store.orders].sort((a, b) => ts(b) - ts(a)).slice(0, 5).map(o => {
    const statusColor = { done:'#00A651', cancelled:'#999', searching:'#E65100', accepted:'#1565C0', picked_up:'#9C27B0', on_the_way:'#00A651' }[o.status] || '#666';
    return `
      <div class="ripple" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;min-height:60px" data-order="${esc(o.id)}">
        <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.title || 'ออเดอร์')}</div>
          <div style="font-size:11px;color:var(--mut);margin-top:2px">${fmtTime(o.createdAt)} • ${esc(STATUS[o.status] || o.status)}</div>
        </div>
      </div>`;
  }).join('');

  return `${heroSection}${statCards}
    <div class="section-divider"><div class="title">🎯 ต้องทำอะไรต่อ</div><div class="line"></div></div>
    ${actionItems.join('')}
    <div class="section-divider"><div class="title">🕐 ออเดอร์ล่าสุด</div><div class="line"></div></div>
    <div class="card" style="padding:16px">
      ${recentOrders || '<div style="text-align:center;padding:20px;color:#999;font-weight:600">ยังไม่มีออเดอร์</div>'}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  💰 GP DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function getGPByRange(range) {
  let from = new Date();
  if (range === 'today') { from.setHours(0,0,0,0); }
  else if (range === 'yesterday') { from.setDate(from.getDate() - 1); from.setHours(0,0,0,0); }
  else if (range === 'week') { from.setDate(from.getDate() - 7); from.setHours(0,0,0,0); }
  else if (range === 'month') { from.setDate(from.getDate() - 30); from.setHours(0,0,0,0); }

  const filtered = store.orders.filter(o => {
    if (o.status !== 'done') return false;
    const d = toDate(o.createdAt);
    return d && d >= from;
  });

  let total = 0, totalFare = 0, count = 0;
  const byRider = {}, byMerchant = {};
  filtered.forEach(o => {
    const fare = Number(o.fare || 0);
    const gp = Math.round(fare * 0.20 * 100) / 100;
    total += gp; totalFare += fare; count++;
    const rId = o.riderId || 'unknown';
    const rName = o.rider?.name || o.riderName || 'ไม่ระบุ';
    if (!byRider[rId]) byRider[rId] = { name: rName, gp: 0, count: 0 };
    byRider[rId].gp += gp; byRider[rId].count++;
    const mId = o.merchantId || 'unknown';
    const mName = o.merchant?.name || o.merchantName || store.merchants.find(m => m.id === mId)?.name || 'ไม่ระบุ';
    if (!byMerchant[mId]) byMerchant[mId] = { name: mName, gp: 0, count: 0 };
    byMerchant[mId].gp += gp; byMerchant[mId].count++;
  });

  return { total, totalFare, count, byRider, byMerchant };
}

function gp() {
  const range = filters.gpRange;
  const today = getGPByRange('today');
  const current = { today, yesterday: getGPByRange('yesterday'), week: getGPByRange('week'), month: getGPByRange('month') }[range];

  const rangeTabs = `
    <div class="range-tabs">
      <button class="range-tab ${range === 'today' ? 'active' : ''}" data-gp-range="today">📅 วันนี้</button>
      <button class="range-tab ${range === 'yesterday' ? 'active' : ''}" data-gp-range="yesterday">⏪ เมื่อวาน</button>
      <button class="range-tab ${range === 'week' ? 'active' : ''}" data-gp-range="week">📆 7 วัน</button>
      <button class="range-tab ${range === 'month' ? 'active' : ''}" data-gp-range="month">🗓️ 30 วัน</button>
    </div>`;

  const totalPending = store.orders.filter(o => o.status === 'done' && !o.riderPaid).reduce((sum, o) => {
    return sum + Math.round(Number(o.fare || 0) * 0.20 * 100) / 100;
  }, 0);

  const summaryCards = `
    <div class="stat-grid">
      <div class="stat-card gold"><div class="stat-icon">💰</div><div class="stat-value">฿${current.total.toFixed(0)}</div><div class="stat-label">GP ${range === 'today' ? 'วันนี้' : range === 'yesterday' ? 'เมื่อวาน' : range === 'week' ? '7 วัน' : '30 วัน'}</div><div class="stat-sub">${current.count} ออเดอร์</div></div>
      <div class="stat-card blue"><div class="stat-icon">📊</div><div class="stat-value">฿${current.totalFare.toFixed(0)}</div><div class="stat-label">ยอดรวม</div><div class="stat-sub">ก่อนหัก GP</div></div>
      <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-value">฿${today.total.toFixed(0)}</div><div class="stat-label">GP วันนี้</div><div class="stat-sub">${today.count} ออเดอร์</div></div>
      <div class="stat-card red"><div class="stat-icon">💸</div><div class="stat-value">฿${totalPending.toFixed(0)}</div><div class="stat-label">GP ค้างเก็บ</div><div class="stat-sub">จากไรเดอร์</div></div>
    </div>`;

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const dayOrders = store.orders.filter(o => {
      if (o.status !== 'done') return false;
      const od = toDate(o.createdAt);
      return od && od >= d && od < next;
    });
    last7.push({ label: d.toLocaleDateString('th-TH', { day: '2-digit' }), value: dayOrders.reduce((s, o) => s + (Number(o.fare || 0) * 0.20), 0) });
  }
  const maxVal = Math.max(...last7.map(d => d.value), 1);
  const chartHtml = `
    <div class="card" style="padding:16px">
      <div style="font-weight:900;font-size:14px;margin-bottom:12px">📈 GP 7 วันล่าสุด</div>
      <div class="chart-bars">
        ${last7.map(d => `<div class="chart-bar" style="height:${Math.max(4, (d.value / maxVal) * 100)}%">
          ${d.value > 0 ? `<div class="chart-bar-value">฿${d.value.toFixed(0)}</div>` : ''}
          <div class="chart-bar-label">${d.label}</div>
        </div>`).join('')}
      </div>
    </div>`;

  const riderRows = Object.entries(current.byRider).sort((a, b) => b[1].gp - a[1].gp);
  const riderTable = riderRows.length === 0
    ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">ไม่มีข้อมูล</td></tr>'
    : riderRows.map(([id, r]) => `<tr>
      <td style="font-weight:900">🛵 ${esc(r.name)}</td>
      <td class="text-center">${r.count}</td>
      <td class="text-right money-pos">฿${r.gp.toFixed(2)}</td>
      <td class="text-right" style="color:var(--mut);font-weight:700">฿${(r.gp * 4).toFixed(0)}</td>
    </tr>`).join('');

  const merchantRows = Object.entries(current.byMerchant).sort((a, b) => b[1].gp - a[1].gp);
  const merchantTable = merchantRows.length === 0
    ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">ไม่มีข้อมูล</td></tr>'
    : merchantRows.map(([id, m]) => `<tr>
      <td style="font-weight:900">🏪 ${esc(m.name)}</td>
      <td class="text-center">${m.count}</td>
      <td class="text-right money-pos">฿${m.gp.toFixed(2)}</td>
      <td class="text-right" style="color:var(--mut);font-weight:700">฿${(m.gp * 4).toFixed(0)}</td>
    </tr>`).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-weight:900;font-size:18px">💰 GP Dashboard</div>
      <span class="tag b">GP 20%</span>
    </div>
    ${rangeTabs}${summaryCards}${chartHtml}
    <div class="section-divider"><div class="title">🛵 GP รายไรเดอร์</div><div class="line"></div></div>
    <div class="table-wrap"><table class="gp-table">
      <thead><tr><th>ไรเดอร์</th><th class="text-center">งาน</th><th class="text-right">GP (20%)</th><th class="text-right">ไรเดอร์ได้ (80%)</th></tr></thead>
      <tbody>${riderTable}</tbody>
    </table></div>
    <div class="section-divider" style="margin-top:20px"><div class="title">🏪 GP รายร้านค้า</div><div class="line"></div></div>
    <div class="table-wrap"><table class="gp-table">
      <thead><tr><th>ร้านค้า</th><th class="text-center">งาน</th><th class="text-right">GP (20%)</th><th class="text-right">ร้านได้ (80%)</th></tr></thead>
      <tbody>${merchantTable}</tbody>
    </table></div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  🧾 FINANCE
// ═══════════════════════════════════════════════════════════════════

function finance() {
  const completedOrders = store.orders.filter(o => o.status === 'done');
  let totalGrossAll = 0, totalPlatformFeeAll = 0, totalRiderEarnAll = 0;
  const riderStats = {};
  completedOrders.forEach(o => {
    const fare = Number(o.fare || 0);
    if (fare <= 0) return;
    const platformFee = Math.round(fare * 0.20 * 100) / 100;
    const riderEarn = fare - platformFee;
    const rId = o.riderId || 'unknown';
    const rName = o.rider?.name || o.riderName || 'ไม่ระบุ';
    if (!riderStats[rId]) riderStats[rId] = { name: rName, total: {c:0,a:0} };
    totalGrossAll += fare; totalPlatformFeeAll += platformFee; totalRiderEarnAll += riderEarn;
    riderStats[rId].total.c++; riderStats[rId].total.a += riderEarn;
  });
  const rows = Object.values(riderStats).sort((a, b) => b.total.a - a.total.a).map(r => `
    <tr>
      <td style="font-weight:900">${esc(r.name)}</td>
      <td class="text-center">${r.total.c}</td>
      <td class="text-right money-pos">฿${r.total.a.toFixed(2)}</td>
      <td class="text-right" style="color:var(--warn);font-weight:900">฿${(r.total.a * 0.25).toFixed(2)}</td>
    </tr>`).join('');

  return `
    <div class="stat-grid">
      <div class="stat-card blue"><div class="stat-icon">💰</div><div class="stat-value">฿${totalGrossAll.toFixed(0)}</div><div class="stat-label">ยอดขายรวม</div></div>
      <div class="stat-card gold"><div class="stat-icon">📊</div><div class="stat-value">฿${totalPlatformFeeAll.toFixed(0)}</div><div class="stat-label">GP แพลตฟอร์ม</div></div>
      <div class="stat-card green"><div class="stat-icon">🛵</div><div class="stat-value">฿${totalRiderEarnAll.toFixed(0)}</div><div class="stat-label">ไรเดอร์ 80%</div></div>
      <div class="stat-card purple"><div class="stat-icon">📋</div><div class="stat-value">${completedOrders.length}</div><div class="stat-label">ออเดอร์เสร็จ</div></div>
    </div>
    <div class="table-wrap"><table class="gp-table">
      <thead><tr><th>ไรเดอร์</th><th class="text-center">งาน</th><th class="text-right">ไรเดอร์ได้</th><th class="text-right" style="color:var(--warn)">GP ค้าง</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">ยังไม่มีข้อมูล</td></tr>'}</tbody>
    </table></div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  💬 CHATS
// ═══════════════════════════════════════════════════════════════════

function chats() {
  const list = [...store.chats].sort((a, b) => ts(b) - ts(a));
  if (list.length === 0) {
    return `<div class="empty">
      <div style="font-size:48px;margin-bottom:8px">💬</div>
      <div style="font-weight:800;font-size:15px;margin-bottom:6px">ยังไม่มีการสนทนา</div>
      <div style="font-size:12px;font-weight:600">แชทระหว่างไรเดอร์ ↔ ร้านค้า จะปรากฏที่นี่</div>
    </div>`;
  }
  return list.map(c => {
    const title = c.participants?.map(p => p.name).join(' ↔ ') || 'การสนทนา';
    const unread = c.unreadAdmin || 0;
    return `
      <div class="chat-list-item" data-open-chat="${esc(c.id)}">
        <div class="avatar">💬</div>
        <div class="chat-info">
          <div class="chat-title">${esc(title)}</div>
          <div class="chat-preview">${esc((c.lastMessage || '—').substring(0, 50))}</div>
        </div>
        <div class="chat-meta">
          <div class="chat-time">${fmtTimeShort(c.lastMessageAt || c.createdAt)}</div>
          ${unread > 0 ? `<div class="chat-unread">${unread}</div>` : ''}
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
    .onSnapshot(snap => renderChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

function closeChat() {
  $('chat-container').classList.remove('show');
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  activeChatId = null;
}

function renderChatMessages(msgs) {
  if (msgs.length === 0) { $('chat-messages').innerHTML = '<div class="chat-empty">เริ่มสนทนาได้เลย</div>'; return; }
  let lastDay = '';
  const html = msgs.map(m => {
    const isAdmin = m.senderRole === 'admin';
    const d = toDate(m.createdAt) || new Date();
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
    let dayDiv = '';
    if (day !== lastDay) { dayDiv = `<div class="chat-day-divider">${day}</div>`; lastDay = day; }
    const cls = isAdmin ? 'out from-admin' : 'in';
    const imageHtml = m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-image" onclick="window.open('${esc(m.imageUrl)}','_blank')">` : '';
    const senderName = !isAdmin && m.senderName ? `<div style="font-size:10px;font-weight:900;opacity:.8;margin-bottom:4px">${esc(m.senderName)}</div>` : '';
    return `${dayDiv}<div class="chat-msg ${cls}">${senderName}${imageHtml}${m.text ? `<div>${esc(m.text)}</div>` : ''}<div class="msg-time">${fmtTimeShort(m.createdAt)}</div></div>`;
  }).join('');
  $('chat-messages').innerHTML = html;
  setTimeout(() => { $('chat-messages').scrollTop = $('chat-messages').scrollHeight; }, 50);
}

async function sendChatText() {
  const text = $('chat-input').value.trim();
  if (!text || !activeChatId) return;
  $('chat-input').value = ''; $('chat-input').style.height = 'auto';
  try {
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      text, senderRole: 'admin', senderName: 'Admin',
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
    const path = `chats/${activeChatId}/${Date.now()}_${file.name}`;
    const ref = storage.ref(path);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    await db.collection('chats').doc(activeChatId).collection('messages').add({
      imageUrl: url, senderRole: 'admin', senderName: 'Admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('chats').doc(activeChatId).update({
      lastMessage: '[Admin] 📷 รูปภาพ',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('✅ ส่งรูปแล้ว');
  } catch (e) { toast('อัปโหลดไม่สำเร็จ', true); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ═══════════════════════════════════════════════════════════════════
//  🏪 MERCHANTS / 📋 ORDERS / 🛵 RIDERS / 👥 USERS
// ═══════════════════════════════════════════════════════════════════

function merchants() {
  const q = filters.q.toLowerCase(), st = filters.merchantStatus;
  const list = store.merchants.filter(m => {
    const mQ = !q || String(m.name || '').toLowerCase().includes(q);
    const mS = st === 'all' || (st === 'pending' && !m.verified) || (st === 'verified' && m.verified);
    return mQ && mS;
  });
  const pendingCount = store.merchants.filter(m => !m.verified).length;
  const verifiedCount = store.merchants.length - pendingCount;

  const filterBar = `
    <div class="filter-bar">
      <button class="filter-chip ${st === 'all' ? 'active' : ''}" data-merchant-status="all">📋 ทั้งหมด (${store.merchants.length})</button>
      <button class="filter-chip ${st === 'pending' ? 'active' : ''}" data-merchant-status="pending">⏳ รอ (${pendingCount})</button>
      <button class="filter-chip ${st === 'verified' ? 'active' : ''}" data-merchant-status="verified">✅ อนุมัติ (${verifiedCount})</button>
    </div>`;

  return filterBar + searchInput('ค้นหาร้านค้า...') + (list.map(m => `
    <div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E8F5E9">🏪</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(m.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📞 ${esc(m.phone || '—')} • ⭐ ${esc(m.rating || 0)}</div>
        </div>
        <span class="tag ${m.verified ? '' : 'w'}">${m.verified ? '✅ อนุมัติ' : '⏳ รอ'}</span>
      </div>
      <div class="data-card-actions">
        <button class="${m.verified ? 'dan' : 'pri'} ripple" data-verify="${esc(m.id)}">${m.verified ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
        <button class="blue ripple" data-edit-m="${esc(m.id)}">✏️ แก้ไข</button>
        <button class="dan ripple" data-del="merchants:${esc(m.id)}">🗑️ ลบ</button>
      </div>
    </div>`).join('') || '<div class="empty">ไม่พบร้านค้า</div>');
}

function orders() {
  const q = filters.q.toLowerCase();
  let list = store.orders.filter(o =>
    (filters.orders === 'all' || o.status === filters.orders) &&
    (!q || [o.title, o.userName, o.id].some(v => String(v || '').toLowerCase().includes(q)))
  );
  list = [...list].sort((a, b) => ts(b) - ts(a));
  const sel = `<select id="ofilter" style="margin-bottom:16px;padding:12px;min-height:52px;max-width:200px">
    <option value="all">ทุกสถานะ</option>
    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filters.orders === k ? 'selected' : ''}>${v}</option>`).join('')}
  </select>`;
  return searchInput('ค้นหาออเดอร์...') + sel + (list.map(o => {
    const slipBadge = o.riderSlipUrl ? (o.riderSlipVerified ? '<span class="tag">📸 ✅</span>' : '<span class="tag w">📸 รอ</span>') : '';
    return `
    <div class="data-card ripple" data-order="${esc(o.id)}" style="cursor:pointer">
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

function riders() {
  const q = filters.q.toLowerCase();
  const verifiedCount = store.riders.filter(r => r.verified !== false).length;
  const pendingCount = store.riders.filter(r => r.verified === false).length;
  const filterBar = `
    <div class="filter-bar">
      <button class="filter-chip ${filters.riderStatus === '' ? 'active' : ''}" data-rider-status="">📋 ทั้งหมด (${store.riders.length})</button>
      <button class="filter-chip ${filters.riderStatus === 'pending' ? 'active' : ''}" data-rider-status="pending">⏳ รอ (${pendingCount})</button>
      <button class="filter-chip ${filters.riderStatus === 'verified' ? 'active' : ''}" data-rider-status="verified">✅ อนุมัติ (${verifiedCount})</button>
    </div>`;
  const filteredList = store.riders.filter(r => {
    const mQ = !q || String(r.name || '').toLowerCase().includes(q);
    if (filters.riderStatus === 'pending') return mQ && r.verified === false;
    if (filters.riderStatus === 'verified') return mQ && r.verified !== false;
    return mQ;
  });
  return filterBar + searchInput('ค้นหาไรเดอร์...') + (filteredList.map(r => {
    const verified = r.verified !== false;
    return `
    <div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E8F5E9">🛵</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(r.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📞 ${esc(r.phone || '—')} • ⭐ ${esc(r.rating || 0)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <span class="tag ${verified ? '' : 'w'}">${verified ? '✅' : '⏳'}</span>
          <span class="tag ${r.status === 'active' ? '' : 'x'}">${r.status === 'active' ? '🟢' : '⚫'}</span>
        </div>
      </div>
      <div class="data-card-actions">
        <button class="${verified ? 'dan' : 'pri'} ripple" data-verify-r="${esc(r.id)}">${verified ? '🚫 ยกเลิก' : '✅ อนุมัติ'}</button>
        <button class="blue ripple" data-edit-r="${esc(r.id)}">🔗 Link</button>
        <button class="${r.status === 'active' ? 'dan' : 'pri'} ripple" data-rider="${esc(r.id)}">${r.status === 'active' ? '⏸️ หยุด' : '▶️ เปิด'}</button>
        <button class="dan ripple" data-del="riders:${esc(r.id)}">🗑️</button>
      </div>
    </div>`; }).join('') || '<div class="empty">ไม่พบไรเดอร์</div>');
}

function users() {
  const q = filters.q.toLowerCase();
  const list = store.users.filter(u => !q || [u.name, u.email, u.phone].some(v => String(v || '').toLowerCase().includes(q)));
  return searchInput('ค้นหาผู้ใช้...') + (list.map(u => `
    <div class="data-card">
      <div class="data-card-header">
        <div class="data-card-icon" style="background:#E3F2FD">👤</div>
        <div class="data-card-info">
          <div class="data-card-name">${esc(u.name || 'ไม่ระบุ')}</div>
          <div class="data-card-meta">📧 ${esc(u.email || '—')} • 📞 ${esc(u.phone || '—')}</div>
        </div>
      </div>
      <div class="data-card-actions"><button class="dan ripple" data-del="users:${esc(u.id)}">🗑️ ลบ</button></div>
    </div>`).join('') || '<div class="empty">ไม่พบผู้ใช้</div>');
}

// ═══════════════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════════════

function openModal(t, h) { $('modal-title').textContent = t; $('modal-body').innerHTML = h; $('modal-overlay').classList.add('show'); }
function closeModal() { $('modal-overlay').classList.remove('show'); }

function orderDetail(id) {
  const o = store.orders.find(x => x.id === id); if (!o) return;
  const opts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('');
  const riderSlipSection = o.riderSlipUrl ? `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee">
      <div style="font-weight:900;margin-bottom:8px;font-size:13px">📸 สลิปจากไรเดอร์</div>
      ${o.riderSlipVerified ? `<div class="slip-status-banner ok">✅ ตรวจสอบแล้ว</div>` : `<div class="slip-status-banner pending">⏳ รอตรวจสอบ</div>`}
      <img src="${o.riderSlipUrl}" class="slip-preview" onclick="window.open('${o.riderSlipUrl}','_blank')">
      ${!o.riderSlipVerified ? `<div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="pri ripple" style="flex:1" data-verify-slip="${esc(o.id)}">✅ อนุมัติ</button>
        <button class="dan ripple" style="flex:1" data-reject-slip="${esc(o.id)}">❌ ปฏิเสธ</button>
      </div>` : ''}
    </div>` : '';
  const adminSlipSection = o.adminSlipUrl ? `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee">
      <div style="font-weight:900;margin-bottom:8px;font-size:13px">💸 สลิปโอนร้าน</div>
      <img src="${o.adminSlipUrl}" class="slip-preview" onclick="window.open('${o.adminSlipUrl}','_blank')">
      <button class="dan ripple" style="width:100%;margin-top:8px" data-delete-slip="${esc(o.id)}">🗑️ ลบ</button>
    </div>` : `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee">
      <div style="font-weight:900;margin-bottom:8px;font-size:13px">💸 สลิปโอนร้าน</div>
      <div class="slip-upload-box" data-upload-admin-slip="${esc(o.id)}">
        <div class="icon">📤</div><div class="label">อัปโหลดสลิป</div><div class="hint">แตะเลือกรูป</div>
      </div>
      <input type="file" id="admin-slip-input-${esc(o.id)}" accept="image/*" style="display:none">
      <div class="slip-progress" id="admin-slip-progress-${esc(o.id)}" style="display:none"><div class="slip-progress-bar" id="admin-slip-bar-${esc(o.id)}"></div></div>
    </div>`;
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
    ${riderSlipSection}${adminSlipSection}
    <button class="dan big ripple" style="margin-top:16px" data-cancel-order="${esc(o.id)}">❌ ยกเลิกออเดอร์</button>
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
    <button class="pri big ripple" data-save-merchant="${esc(id)}">💾 บันทึก</button>
  `);
}

function editRiderForm(id) {
  const r = store.riders.find(x => x.id === id); if (!r) return;
  const selM = r.merchantIds || [], selL = r.locationIds || [];
  const merchantPicker = `<div class="picker">${store.merchants.map(m => `<label><input type="checkbox" class="merchant-check" value="${esc(m.id)}" ${selM.includes(m.id) ? 'checked' : ''}><span>🏪 ${esc(m.name || '-')}</span></label>`).join('')}</div>`;
  const locationPicker = `<div class="picker">${store.places.map(p => `<label><input type="checkbox" class="location-check" value="${esc(p.id)}" ${selL.includes(p.id) ? 'checked' : ''}><span>📍 ${esc(p.name)}</span></label>`).join('')}</div>`;
  openModal('🔗 Link ไรเดอร์', `
    <div style="font-weight:900;margin-bottom:12px">${esc(r.name || '-')}</div>
    <label style="font-weight:800;font-size:13px;display:block;margin-bottom:8px">🏪 ร้านที่ดูแล</label>
    ${merchantPicker}
    <label style="font-weight:800;font-size:13px;display:block;margin:16px 0 8px">📍 สถานที่ที่ดูแล</label>
    ${locationPicker}
    <button class="pri big ripple" style="margin-top:16px" data-save-rider-link="${esc(id)}">💾 บันทึก</button>
  `);
}

// ═══════════════════════════════════════════════════════════════════
//  🎯 EVENT LISTENERS (ใช้ Event Delegation ทั้งหมด)
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-order],[data-verify],[data-verify-r],[data-rider],[data-del],[data-edit-m],[data-edit-r],[data-merchant-status],[data-rider-status],[data-gp-range],[data-open-chat],[data-verify-slip],[data-reject-slip],[data-delete-slip],[data-upload-admin-slip],[data-cancel-order],[data-save-merchant],[data-save-rider-link]');
  if (!t) return;

  try {
    // ─── Navigation ───
    if (t.dataset.go) { current = t.dataset.go; filters.q = ''; render(); window.scrollTo(0, 0); return; }

    // ─── GP Range ───
    if (t.dataset.gpRange) { filters.gpRange = t.dataset.gpRange; render(); return; }

    // ─── Filter Status ───
    if (t.dataset.merchantStatus) { filters.merchantStatus = t.dataset.merchantStatus; render(); return; }
    if (t.dataset.riderStatus !== undefined && t.hasAttribute('data-rider-status')) { filters.riderStatus = t.dataset.riderStatus; render(); return; }

    // ─── Open Chat ───
    if (t.dataset.openChat) { openChat(t.dataset.openChat); return; }

    // ─── Order Detail ───
    if (t.dataset.order) { orderDetail(t.dataset.order); return; }

    // ─── Merchant Actions ───
    if (t.dataset.editM) { editMerchantForm(t.dataset.editM); return; }
    if (t.dataset.verify) {
      const m = store.merchants.find(x => x.id === t.dataset.verify);
      if (!m) return;
      await db.collection('merchants').doc(m.id).update({ verified: !m.verified, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('✅ อัปเดตแล้ว');
      return;
    }
    if (t.dataset.saveMerchant) {
      await db.collection('merchants').doc(t.dataset.saveMerchant).update({
        name: $('edit-name').value.trim(),
        phone: $('edit-phone').value.trim(),
        address: $('edit-address').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('✅ บันทึกแล้ว'); closeModal();
      return;
    }

    // ─── Rider Actions ───
    if (t.dataset.editR) { editRiderForm(t.dataset.editR); return; }
    if (t.dataset.verifyR) {
      const r = store.riders.find(x => x.id === t.dataset.verifyR);
      if (!r) return;
      const nv = r.verified === false;
      await db.collection('riders').doc(r.id).update({ verified: nv, verifiedAt: nv ? firebase.firestore.FieldValue.serverTimestamp() : null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast(nv ? '✅ อนุมัติไรเดอร์' : '🚫 ยกเลิก');
      return;
    }
    if (t.dataset.rider) {
      const r = store.riders.find(x => x.id === t.dataset.rider);
      if (!r) return;
      await db.collection('riders').doc(r.id).update({ status: r.status === 'active' ? 'inactive' : 'active' });
      toast('✅ อัปเดตแล้ว');
      return;
    }
    if (t.dataset.saveRiderLink) {
      const mIds = [...document.querySelectorAll('.merchant-check:checked')].map(cb => cb.value);
      const lIds = [...document.querySelectorAll('.location-check:checked')].map(cb => cb.value);
      await db.collection('riders').doc(t.dataset.saveRiderLink).update({ merchantIds: mIds, locationIds: lIds, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('✅ บันทึกแล้ว'); closeModal();
      return;
    }

    // ─── Order Slip Actions ───
    if (t.dataset.verifySlip) {
      await db.collection('orders').doc(t.dataset.verifySlip).update({ riderSlipVerified: true, riderSlipVerifiedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('✅ อนุมัติสลิป'); orderDetail(t.dataset.verifySlip);
      return;
    }
    if (t.dataset.rejectSlip) {
      if (!confirm('ปฏิเสธสลิปนี้?')) return;
      const o = store.orders.find(x => x.id === t.dataset.rejectSlip);
      if (o?.riderSlipPath) try { await storage.ref(o.riderSlipPath).delete(); } catch(_) {}
      await db.collection('orders').doc(t.dataset.rejectSlip).update({ riderSlipUrl: null, riderSlipPath: null, riderSlipVerified: false });
      toast('❌ ปฏิเสธ'); orderDetail(t.dataset.rejectSlip);
      return;
    }
    if (t.dataset.deleteSlip) {
      if (!confirm('ลบสลิป?')) return;
      const o = store.orders.find(x => x.id === t.dataset.deleteSlip);
      if (o?.adminSlipPath) try { await storage.ref(o.adminSlipPath).delete(); } catch(_) {}
      await db.collection('orders').doc(t.dataset.deleteSlip).update({ adminSlipUrl: null, adminSlipPath: null });
      toast('🗑️ ลบแล้ว'); orderDetail(t.dataset.deleteSlip);
      return;
    }
    if (t.dataset.uploadAdminSlip) {
      const input = $(`admin-slip-input-${t.dataset.uploadAdminSlip}`);
      if (!input) return;
      input.onchange = (e) => uploadAdminSlip(t.dataset.uploadAdminSlip, e.target.files[0]);
      input.click();
      return;
    }
    if (t.dataset.cancelOrder) {
      if (!confirm('ยกเลิกออเดอร์?')) return;
      await db.collection('orders').doc(t.dataset.cancelOrder).update({ status: 'cancelled', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('ยกเลิกแล้ว'); closeModal();
      return;
    }

    // ─── Delete ───
    if (t.dataset.del) {
      const [col, id] = t.dataset.del.split(':');
      if (confirm('⚠️ ยืนยันการลบ?')) {
        await db.collection(col).doc(id).delete();
        toast('ลบแล้ว');
      }
      return;
    }
  } catch (err) {
    console.error(err);
    toast('ไม่สำเร็จ: ' + (err.message || err.code), true);
  }
});

async function uploadAdminSlip(orderId, file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('ไฟล์เกิน 5MB', true);
  const pB = $(`admin-slip-progress-${orderId}`), bar = $(`admin-slip-bar-${orderId}`);
  if (pB) pB.style.display = 'block';
  const path = `slips/orders/${orderId}/admin-${Date.now()}.jpg`;
  const ref = storage.ref(path);
  try {
    const task = ref.put(file);
    task.on('state_changed', s => { if (bar) bar.style.width = (s.bytesTransferred / s.totalBytes * 100) + '%'; });
    await task;
    const url = await ref.getDownloadURL();
    await db.collection('orders').doc(orderId).update({ adminSlipUrl: url, adminSlipPath: path });
    toast('✅ อัปโหลดสำเร็จ');
    orderDetail(orderId);
  } catch (e) { toast('❌ ' + e.message, true); }
}

// ─── Search Input ───
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    filters.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
});

// ─── Select Dropdowns ───
document.addEventListener('change', async e => {
  if (e.target.id === 'ofilter') { filters.orders = e.target.value; render(); }
  if (e.target.id === 'ostatus') {
    await db.collection('orders').doc(e.target.dataset.oid).update({ status: e.target.value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast('✅ อัปเดต'); closeModal();
  }
});

// ─── Modal Close ───
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(); } });

// ─── Haptic ───
document.addEventListener('click', e => {
  const el = e.target.closest('button, .data-card, nav button, .stat-card, .action-card');
  if (el && navigator.vibrate) navigator.vibrate(10);
}, { passive: true }); 

console.log('%c🛵 Chauat Go Admin v3.3.0', 'color:#00A651;font-weight:900;font-size:16px');
console.log('%c✓ Fixed Syntax Error | ✓ Event Delegation | ✓ No SW Cache Issue', 'color:#1565C0;font-weight:700');