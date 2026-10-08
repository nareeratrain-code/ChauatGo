/* ═══════════════════════════════════════════════════════════════════
   🛵 CHAUAT GO — v3.3.3
   Main Application Logic
   ═══════════════════════════════════════════════════════════════════ */

// ═══ FIREBASE CONFIG ═══
const firebaseConfig = {
  apiKey: "AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM",
  authDomain: "chauat-go-b9841.firebaseapp.com",
  projectId: "chauat-go-b9841",
  storageBucket: "chauat-go-b9841.firebasestorage.app",
  messagingSenderId: "282197694521",
  appId: "1:282197694521:web:0528c22747a0c04bd815e8"
};

let auth = null, db = null, storage = null;
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  if (db.enablePersistence) {
    db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('persistence:', e.code));
  }
} catch (e) { console.error('Firebase init failed:', e); }

// ═══ DEBUG ═══
function debugLog(msg, isError = false) {
  const el = document.getElementById('debugConsole');
  if (el) {
    el.style.display = 'block';
    el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${msg}</span><br>`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
}

// ═══ STATE ═══
let PLACES = [];
let currentUser = null;
let userProfile = null;
let currentTab = 'home';
let currentMerchantFilter = 'all';
let currentMerchantSearch = '';
let merchantsCache = [];
let cart = [];
try { cart = JSON.parse(localStorage.getItem('chauat_cart') || '[]'); } catch(e) { cart = []; }
let cartShop = localStorage.getItem('chauat_cart_shop') || '';
let userLocation = null;
let map = null;
let mapMarkers = [];
let destinationMarker = null;
let unsubOrders = null;
let deferredPrompt = null;

// ═══ CATEGORY MAP ═══
const CATEGORIES = {
  r: { name: 'ร้านอาหาร', icon: '🍽️' },
  f: { name: 'คาเฟ่', icon: '☕' },
  c: { name: 'สะดวกซื้อ', icon: '🏪' },
  m: { name: 'ตลาด', icon: '🛒' },
  t: { name: 'ท่องเที่ยว', icon: '🏞️' },
  h: { name: 'ที่พัก', icon: '🏨' },
  s: { name: 'ร้านค้า', icon: '🛍️' },
  w: { name: 'วัด', icon: '🛕' },
  g: { name: 'ปั๊มน้ำมัน', icon: '⛽' },
  b: { name: 'ธนาคาร', icon: '🏦' },
  e: { name: 'สถานศึกษา', icon: '🏫' },
  o: { name: 'ราชการ', icon: '🏛️' },
  x: { name: 'อื่นๆ', icon: '📌' },
  l: { name: 'สาธารณสุข', icon: '🏥' },
  p: { name: 'ไปรษณีย์', icon: '📦' },
  y: { name: 'ชุมชน', icon: '🏘️' }
};

// ═══ HELPERS ═══
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const toDate = t => { if (!t) return null; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? null : d; };

function showToast(msg, type) {
  type = type || 'success';
  const t = $('toast');
  if (!t) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  t.textContent = (icons[type] || '') + ' ' + msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDistance(km) {
  if (!km && km !== 0) return '';
  if (km < 1) return Math.round(km * 1000) + ' ม.';
  return km.toFixed(1) + ' กม.';
}

function hasRealImage(img) {
  if (!img) return false;
  if (img.startsWith('images/')) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  🚀 INIT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  debugLog('🚀 Chauat Go v3.3.3 เริ่มทำงาน');
  loadPlaces();
  initAuth();
  setupNetwork();
  setupPWA();
  checkPDPA();
  updateCartBar();
  debugLog('✅ Init complete');
});

function loadPlaces() {
  // ⭐ อ่านจาก window.PLACES_RAW (จาก locations-data.js)
  if (typeof window.PLACES_RAW !== 'undefined' && Array.isArray(window.PLACES_RAW)) {
    PLACES = window.PLACES_RAW.map(function(p, i) {
      return {
        id: 'LOC-' + String(i + 1).padStart(3, '0'),
        name: p[0], lat: p[1], lng: p[2], category: p[3],
        price: p[4], image: p[5], rating: p[6]
      };
    });
    debugLog('📍 โหลด ' + PLACES.length + ' สถานที่ ✅');
    updateStatsBar();
  } else {
    debugLog('❌ ไม่พบ PLACES_RAW — รอ 500ms', true);
    setTimeout(loadPlaces, 500);
  }
}

function updateStatsBar() {
  if (!PLACES.length) return;
  const total = PLACES.length;
  const rest = PLACES.filter(p => p.category === 'r').length;
  const cafe = PLACES.filter(p => p.category === 'f').length;
  const shop = PLACES.filter(p => ['s', 'c', 'm'].includes(p.category)).length;

  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setT('stat-total', total);
  setT('stat-rest', rest);
  setT('stat-cafe', cafe);
  setT('stat-shop', shop);

  debugLog('📊 Stats: ' + total + '/' + rest + '/' + cafe + '/' + shop);

  // Grids
  renderGrid('restaurant-grid', PLACES.filter(p => p.category === 'r' && hasRealImage(p.image)).slice(0, 6));
  renderGrid('convenience-grid', PLACES.filter(p => p.category === 'c' && hasRealImage(p.image)).slice(0, 6));
  renderGrid('cafe-grid', PLACES.filter(p => p.category === 'f' && hasRealImage(p.image)).slice(0, 6));
  renderGrid('tourist-grid', PLACES.filter(p => p.category === 't' && hasRealImage(p.image)).slice(0, 6));
  renderGrid('hotel-grid', PLACES.filter(p => p.category === 'h' && hasRealImage(p.image)).slice(0, 6));
}

function renderGrid(gridId, items) {
  const grid = $(gridId);
  if (!grid) return;
  if (!items.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = items.map(function(p) {
    const hasImg = hasRealImage(p.image);
    const imgHtml = hasImg
      ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=&quot;food-img-fallback&quot;>' + (CATEGORIES[p.category]?.icon || '📍') + '</div>\'">'
      : '<div class="food-img-fallback">' + (CATEGORIES[p.category]?.icon || '📍') + '</div>';

    return '<div class="food-card ripple" data-place-id="' + esc(p.id) + '">' +
      '<div class="food-img">' + imgHtml + '</div>' +
      '<div class="food-info">' +
        '<div class="food-name">' + esc(p.name) + '</div>' +
        '<div class="food-meta">' + (CATEGORIES[p.category]?.icon || '') + ' ' + esc(CATEGORIES[p.category]?.name || '') + (p.rating ? ' ⭐ ' + p.rating : '') + '</div>' +
        (p.price ? '<div class="food-price">' + esc(p.price) + '</div>' : '') +
      '</div></div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  🔐 AUTH
// ═══════════════════════════════════════════════════════════════════
function initAuth() {
  if (!auth) { debugLog('❌ Firebase Auth ไม่พร้อม', true); return; }
  auth.onAuthStateChanged(async function(user) {
    currentUser = user;
    if (user) {
      debugLog('👤 ล็อกอิน: ' + user.email);
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        userProfile = snap.exists ? Object.assign({ uid: user.uid }, snap.data()) : null;
      } catch (e) { console.warn(e); }
      const avatar = $('profile-avatar-emoji');
      if (avatar) avatar.textContent = '✅';
    } else {
      debugLog('⛔ ยังไม่ได้ล็อกอิน');
      userProfile = null;
      const avatar = $('profile-avatar-emoji');
      if (avatar) avatar.textContent = '👤';
    }
  });
}

window.switchAuthTab = function(tab) {
  const isLogin = tab === 'login';
  const tl = $('tab-login'), ts = $('tab-signup');
  if (tl) tl.classList.toggle('active', isLogin);
  if (ts) ts.classList.toggle('active', !isLogin);
  if ($('login-form')) $('login-form').style.display = isLogin ? 'block' : 'none';
  if ($('signup-form')) $('signup-form').style.display = isLogin ? 'none' : 'block';
};

window.showLoginModal = function() {
  const m = $('login-modal');
  if (m) m.classList.add('show');
  debugLog('🔓 เปิด Login Modal');
};
window.closeLoginModal = function() {
  const m = $('login-modal');
  if (m) m.classList.remove('show');
};

window.handleLogin = async function() {
  const email = $('login-email').value.trim();
  const pw = $('login-password').value;
  if (!email || !pw) return showToast('กรอกอีเมลและรหัสผ่าน', 'error');
  try {
    await auth.signInWithEmailAndPassword(email, pw);
    showToast('✅ เข้าสู่ระบบสำเร็จ');
    closeLoginModal();
  } catch (err) {
    const msg = {
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบบัญชีนี้',
      'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
    }[err.code] || 'เข้าสู่ระบบไม่สำเร็จ';
    showToast(msg, 'error');
  }
};

window.handleSignup = async function() {
  const name = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const phone = $('signup-phone').value.trim();
  const pw = $('signup-password').value;
  if (!name || !email || !pw) return showToast('กรอกข้อมูลให้ครบ', 'error');
  if (pw.length < 6) return showToast('รหัสผ่าน 6+ ตัว', 'error');
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      role: 'user', name: name, email: email, phone: phone,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ สมัครสำเร็จ');
    closeLoginModal();
  } catch (err) {
    showToast('สมัครไม่สำเร็จ: ' + (err.message || err.code), 'error');
  }
};

window.handleForgotPassword = async function() {
  const email = $('login-email').value.trim();
  if (!email) return showToast('กรอกอีเมลก่อน', 'error');
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('📧 ส่งลิงก์รีเซ็ตแล้ว');
  } catch (err) { showToast('ส่งไม่สำเร็จ', 'error'); }
};

window.loginWithGoogle = function() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).then(async function(cred) {
    const user = cred.user;
    const snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      await db.collection('users').doc(user.uid).set({
        role: 'user', name: user.displayName || '', email: user.email || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    showToast('✅ เข้าสู่ระบบด้วย Google');
    closeLoginModal();
  }).catch(err => showToast('Google: ' + err.message, 'error'));
};

window.loginWithLine = function() {
  showToast('LINE Login ต้องตั้งค่า OAuth ก่อน', 'warning');
};

window.handleLogout = async function() {
  if (!confirm('ออกจากระบบ?')) return;
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
  await auth.signOut();
  showToast('ออกจากระบบแล้ว');
  closeProfileSheet();
};

// ═══════════════════════════════════════════════════════════════════
//  👤 PROFILE SHEET
// ═══════════════════════════════════════════════════════════════════
window.openProfileSheet = function() {
  debugLog('👆 เปิด Profile Sheet');
  const sheet = $('profile-sheet');
  if (!sheet) return;
  sheet.classList.add('show');

  const loggedIn = !!currentUser;
  const lo = $('pf-logged-out'), li = $('pf-logged-in'), lib = $('pf-logged-in-body');
  if (lo) lo.style.display = loggedIn ? 'none' : 'block';
  if (li) li.style.display = loggedIn ? 'block' : 'none';
  if (lib) lib.style.display = loggedIn ? 'block' : 'none';

  if (loggedIn) {
    const name = (userProfile && userProfile.name) || currentUser.displayName || 'ผู้ใช้';
    const email = currentUser.email || '';
    const phone = (userProfile && userProfile.phone) || '—';
    const lineId = (userProfile && userProfile.lineId) || '—';
    const addr = (userProfile && userProfile.address) || '—';

    const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setT('pf-name', name);
    setT('pf-email', email);
    setT('pf-avatar-big', '👤');
    setT('pf-email-val', email);
    setT('pf-phone-val', phone);
    setT('pf-line-val', lineId);
    setT('pf-address-val', addr);

    loadSavedPins();
  }
};

window.closeProfileSheet = function() {
  const sheet = $('profile-sheet');
  if (sheet) sheet.classList.remove('show');
};

async function loadSavedPins() {
  const el = $('pf-saved-pins');
  if (!el || !currentUser) return;
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection('pins').get();
    if (snap.empty) {
      el.innerHTML = '<div style="padding:12px;text-align:center;color:#999;font-size:12px">ยังไม่มีหมุดที่บันทึก</div>';
      return;
    }
    el.innerHTML = snap.docs.map(function(d) {
      const p = d.data();
      return '<div class="pf-info-row"><div class="ico">📌</div><div style="flex:1;min-width:0"><div class="lbl">' + esc(p.name || '') + '</div><div class="val">' + esc((p.address || '').slice(0, 50)) + '</div></div></div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#999;font-size:12px">โหลดไม่สำเร็จ</div>';
  }
}

window.openEditProfile = function() {
  if (!currentUser) return;
  const name = (userProfile && userProfile.name) || currentUser.displayName || '';
  const phone = (userProfile && userProfile.phone) || '';
  const lineId = (userProfile && userProfile.lineId) || '';
  const addr = (userProfile && userProfile.address) || '';

  $('modal-body').innerHTML =
    '<div style="text-align:center;margin-bottom:20px"><h2 style="font-size:20px">✏️ แก้ไขโปรไฟล์</h2></div>' +
    '<div class="form-group"><label>👤 ชื่อ-นามสกุล</label><input type="text" id="edit-name" value="' + esc(name) + '"></div>' +
    '<div class="form-group"><label>📱 เบอร์โทร</label><input type="tel" id="edit-phone" value="' + esc(phone) + '"></div>' +
    '<div class="form-group"><label>💬 LINE ID</label><input type="text" id="edit-line" value="' + esc(lineId) + '"></div>' +
    '<div class="form-group"><label>🏠 ที่อยู่</label><textarea id="edit-address" rows="2">' + esc(addr) + '</textarea></div>' +
    '<button class="btn-full btn-green ripple" onclick="saveProfile()">💾 บันทึก</button>' +
    '<button class="btn-full btn-gray ripple" onclick="closeModal()" style="margin-top:8px">ยกเลิก</button>';
  openModal();
};

window.saveProfile = async function() {
  if (!currentUser) return;
  const data = {
    name: $('edit-name').value.trim(),
    phone: $('edit-phone').value.trim(),
    lineId: $('edit-line').value.trim(),
    address: $('edit-address').value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
    await currentUser.updateProfile({ displayName: data.name });
    userProfile = Object.assign({}, userProfile, data);
    showToast('✅ บันทึกโปรไฟล์แล้ว');
    closeModal();
  } catch (e) { showToast('บันทึกไม่สำเร็จ', 'error'); }
};

// ═══════════════════════════════════════════════════════════════════
//  🔍 SEARCH
// ═══════════════════════════════════════════════════════════════════
window.doSearch = function(q) {
  const results = $('search-results');
  if (!results) return;

  if (!q || q.trim().length < 1) {
    results.classList.remove('show');
    results.innerHTML = '';
    return;
  }

  const query = q.trim().toLowerCase();
  const matches = PLACES.filter(function(p) {
    return p.name.toLowerCase().indexOf(query) !== -1 ||
      (CATEGORIES[p.category] && CATEGORIES[p.category].name.toLowerCase().indexOf(query) !== -1);
  }).slice(0, 20);

  if (!matches.length) {
    results.classList.add('show');
    results.innerHTML = '<div style="padding:20px;text-align:center;color:#999">ไม่พบ "' + esc(q) + '"</div>';
    return;
  }

  results.classList.add('show');
  results.innerHTML = matches.map(function(p) {
    const hasImg = hasRealImage(p.image);
    const imgHtml = hasImg
      ? '<img src="' + esc(p.image) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">'
      : (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '📍');

    return '<div class="food-card ripple" data-place-id="' + esc(p.id) + '" style="display:flex;align-items:center;gap:12px;padding:12px;margin-bottom:8px">' +
      '<div style="width:50px;height:50px;border-radius:12px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:22px">' + imgHtml + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:900;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</div>' +
        '<div style="font-size:11px;color:#6B7280;font-weight:600;margin-top:2px">' + (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '') + ' ' + esc(CATEGORIES[p.category] ? CATEGORIES[p.category].name : '') + (p.price ? ' • ' + p.price : '') + '</div>' +
      '</div></div>';
  }).join('');
};

// ═══════════════════════════════════════════════════════════════════
//  🏪 MERCHANT VIEW
// ═══════════════════════════════════════════════════════════════════
window.openMerchantView = async function(type) {
  debugLog('🏪 เปิด Merchant View: ' + type);
  const hc = $('home-content');
  const sr = $('search-results');
  const cv = $('category-view');
  const mv = $('merchant-view');
  if (hc) hc.style.display = 'none';
  if (sr) sr.classList.remove('show');
  if (cv) cv.classList.remove('show');
  if (mv) mv.classList.add('show');

  const mvt = $('merchant-view-title');
  if (mvt) mvt.textContent = type === 'food' ? '🍽️ เลือกร้านอาหาร' : '🛒 เลือกร้านค้า';

  const list = $('merchant-list');
  if (!list) return;
  list.innerHTML = '<div class="merchant-loading"><div class="spinner"></div><p>กำลังโหลดร้านค้า...</p></div>';

  if (!db) {
    list.innerHTML = '<div class="empty-state"><div class="icon">❌</div><div>Firebase ไม่พร้อม</div></div>';
    return;
  }

  try {
    const snap = await db.collection('merchants').where('verified', '==', true).get();
    merchantsCache = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });

    if (!merchantsCache.length) {
      list.innerHTML = '<div class="empty-state"><div class="icon">🏪</div><div>ยังไม่มีร้านค้าเข้าร่วม</div></div>';
      return;
    }
    renderMerchantList(merchantsCache);
  } catch (err) {
    debugLog('❌ Merchant: ' + err.code, true);
    list.innerHTML = '<div class="empty-state"><div class="icon">❌</div><div>โหลดไม่สำเร็จ</div></div>';
  }
};

function renderMerchantList(merchants) {
  const list = $('merchant-list');
  if (!list) return;
  const q = currentMerchantSearch.toLowerCase();
  const filtered = merchants.filter(function(m) {
    const matchQ = !q || (m.name || '').toLowerCase().indexOf(q) !== -1;
    const matchC = currentMerchantFilter === 'all' || m.category === currentMerchantFilter;
    return matchQ && matchC;
  });

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><div>ไม่พบร้านค้า</div></div>';
    return;
  }

  list.innerHTML = filtered.map(function(m) {
    return '<div class="merchant-card ripple" data-merchant-id="' + esc(m.id) + '">' +
      '<div class="merchant-card-icon" style="background:#E8F5E9;font-size:28px">🏪</div>' +
      '<div class="merchant-card-info">' +
        '<div class="merchant-card-name">' + esc(m.name || 'ไม่ระบุ') + '</div>' +
        '<div class="merchant-card-meta">' + (m.isOpen ? '🟢 เปิด' : '⚫ ปิด') + ' • ' + esc(m.category || '') + '</div>' +
        (m.address ? '<div class="merchant-card-meta">📍 ' + esc(String(m.address).slice(0, 50)) + '</div>' : '') +
      '</div>' +
      '<div style="color:#999;font-size:20px">›</div></div>';
  }).join('');
}

window.closeMerchantView = function() {
  const mv = $('merchant-view');
  const hc = $('home-content');
  if (mv) mv.classList.remove('show');
  if (hc) hc.style.display = 'block';
};

window.filterMerchantList = function(q) {
  currentMerchantSearch = q;
  renderMerchantList(merchantsCache);
};

window.filterMerchantCat = function(cat, el) {
  currentMerchantFilter = cat;
  document.querySelectorAll('.m-filter-chip').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderMerchantList(merchantsCache);
};

window.openMerchantDetail = async function(merchantId) {
  try {
    const snap = await db.collection('merchants').doc(merchantId).get();
    if (!snap.exists) return showToast('ไม่พบร้านค้า', 'error');
    const m = Object.assign({ id: snap.id }, snap.data());

    const menuSnap = await db.collection('menus').where('merchantId', '==', merchantId).get();
    const menus = menuSnap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(mm) { return mm.isAvailable !== false; });

    $('modal-body').innerHTML =
      '<div style="text-align:center;margin-bottom:16px">' +
        '<h2 style="font-size:20px;font-weight:900">' + esc(m.name || '') + '</h2>' +
        '<div style="font-size:12px;color:#666;margin-top:4px">' + (m.isOpen ? '🟢 เปิด' : '⚫ ปิด') + ' • ' + esc(m.openTime || '') + '-' + esc(m.closeTime || '') + '</div>' +
      '</div>' +
      (menus.length === 0 ? '<div style="text-align:center;padding:30px;color:#999">ยังไม่มีเมนู</div>' :
        menus.map(function(menu) {
          return '<div class="menu-item-card" style="display:flex;gap:12px;padding:12px;background:#f8f9fa;border-radius:12px;margin-bottom:8px">' +
            '<div style="width:60px;height:60px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:24px">' +
              (menu.image ? '<img src="' + esc(menu.image) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">' : '🍽️') +
            '</div>' +
            '<div style="flex:1">' +
              '<div style="font-weight:900;font-size:14px">' + esc(menu.name) + '</div>' +
              '<div style="font-size:11px;color:#666;margin-top:2px">' + esc(menu.description || '') + '</div>' +
              '<div style="font-weight:900;color:#00A651;margin-top:4px">' + fmt(menu.price) + '฿</div>' +
            '</div>' +
            '<button onclick="addToCart(\'' + esc(m.id) + '\',\'' + esc(m.name) + '\',\'' + esc(menu.id) + '\',\'' + esc(menu.name) + '\',' + Number(menu.price) + ')" style="background:#00A651;color:#fff;border:none;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;font-family:inherit">+</button>' +
          '</div>';
        }).join('')
      ) +
      '<button class="btn-full btn-gray ripple" onclick="closeModal()" style="margin-top:16px">ปิด</button>';
    openModal();
  } catch (e) { showToast('โหลดไม่สำเร็จ', 'error'); }
};

// ═══════════════════════════════════════════════════════════════════
//  🗺️ MAP
// ═══════════════════════════════════════════════════════════════════
window.openMapPage = function() {
  debugLog('🗺️ เปิดแผนที่');
  const mp = $('map-page');
  if (mp) mp.classList.add('show');

  setTimeout(function() {
    if (typeof L === 'undefined') return;
    if (!map) {
      map = L.map('main-map').setView([7.9650, 99.9960], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
      }).addTo(map);
    }
    map.invalidateSize();
  }, 200);
};

window.closeMapPage = function() {
  const mp = $('map-page');
  if (mp) mp.classList.remove('show');
};

window.toggleTambonList = function() {
  const list = $('tambon-list');
  if (list) list.classList.toggle('show');
};

window.centerToUser = function() {
  if (!navigator.geolocation) return showToast('ไม่รองรับ GPS', 'error');
  navigator.geolocation.getCurrentPosition(function(pos) {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (map) map.setView([userLocation.lat, userLocation.lng], 15);
    showToast('📍 ตำแหน่งของคุณ');
  }, function() { showToast('ไม่สามารถเข้าถึง GPS', 'error'); });
};

window.clearDestination = function() {
  if (destinationMarker && map) { map.removeLayer(destinationMarker); destinationMarker = null; }
  const panel = $('map-info-panel');
  if (panel) panel.classList.remove('show');
};

window.showAllPlacesOnMap = function() {
  if (!map || typeof L === 'undefined') return;
  mapMarkers.forEach(function(m) { map.removeLayer(m); });
  mapMarkers = [];
  const places = PLACES.slice(0, 50);
  places.forEach(function(p) {
    const marker = L.marker([p.lat, p.lng]).addTo(map);
    marker.bindPopup('<b>' + esc(p.name) + '</b><br>' + (CATEGORIES[p.category] ? CATEGORIES[p.category].name : ''));
    mapMarkers.push(marker);
  });
  if (places.length) map.fitBounds(mapMarkers.map(function(m) { return m.getLatLng(); }), { padding: [50, 50] });
  showToast('📌 แสดง ' + places.length + ' สถานที่');
};

window.navigateToDestination = function() {
  if (!destinationMarker) return showToast('เลือกปลายทางก่อน', 'warning');
  const pos = destinationMarker.getLatLng();
  window.open('https://www.google.com/maps/dir/?api=1&destination=' + pos.lat + ',' + pos.lng, '_blank');
};

window.callRiderFromMap = function() {
  if (!destinationMarker) return showToast('เลือกปลายทางก่อน', 'warning');
  const pos = destinationMarker.getLatLng();
  openOrderForm('ride', { lat: pos.lat, lng: pos.lng });
};

// ═══════════════════════════════════════════════════════════════════
//  🏷️ CATEGORY VIEW
// ═══════════════════════════════════════════════════════════════════
window.showCategory = function(cat) {
  const map = { hotel: 'h', tourist: 't', restaurant: 'r', cafe: 'f', convenience: 'c', shop: 's', market: 'm' };
  const code = map[cat] || cat;

  const hc = $('home-content');
  const mv = $('merchant-view');
  const cv = $('category-view');
  if (hc) hc.style.display = 'none';
  if (mv) mv.classList.remove('show');
  if (cv) cv.classList.add('show');

  const ct = $('category-title');
  if (ct) ct.textContent = (CATEGORIES[code] ? CATEGORIES[code].icon : '📍') + ' ' + (CATEGORIES[code] ? CATEGORIES[code].name : cat);

  const filtered = PLACES.filter(function(p) { return p.category === code; });
  const grid = $('category-grid');
  if (!grid) return;
  grid.innerHTML = filtered.length
    ? filtered.map(renderPlaceCard).join('')
    : '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#999">ไม่มีข้อมูล</div>';
};

window.showAllCategories = function(cat) { showCategory(cat); };

window.closeCategoryView = function() {
  const cv = $('category-view');
  const hc = $('home-content');
  if (cv) cv.classList.remove('show');
  if (hc) hc.style.display = 'block';
};

function renderPlaceCard(p) {
  const hasImg = hasRealImage(p.image);
  const imgHtml = hasImg
    ? '<img src="' + esc(p.image) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=&quot;food-img-fallback&quot;>' + (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '📍') + '</div>\'">'
    : '<div class="food-img-fallback">' + (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '📍') + '</div>';

  return '<div class="food-card ripple" data-place-id="' + esc(p.id) + '">' +
    '<div class="food-img">' + imgHtml + '</div>' +
    '<div class="food-info">' +
      '<div class="food-name">' + esc(p.name) + '</div>' +
      '<div class="food-meta">' + (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '') + (p.rating ? ' ⭐ ' + p.rating : '') + '</div>' +
      (p.price ? '<div class="food-price">' + esc(p.price) + '</div>' : '') +
    '</div></div>';
}

// ═══════════════════════════════════════════════════════════════════
//  📦 ORDER FORM
// ═══════════════════════════════════════════════════════════════════
window.openTravelView = function() { openOrderForm('ride'); };

window.openOrderForm = function(type, dest) {
  const titles = { express: '📦 ส่งด่วน', ride: '🚗 เรียกรถ', food: '🍽️ สั่งอาหาร', shopping: '🛒 สั่งของ' };
  const destInfo = dest ? '📍 ' + dest.lat.toFixed(4) + ', ' + dest.lng.toFixed(4) : '';

  $('modal-body').innerHTML =
    '<div style="text-align:center;margin-bottom:16px"><h2 style="font-size:20px">' + (titles[type] || '📦 บริการ') + '</h2></div>' +
    '<div class="form-group"><label>📍 ต้นทาง</label><input type="text" id="order-from" placeholder="ที่อยู่ต้นทาง" value="' + esc((userProfile && userProfile.address) || '') + '"></div>' +
    '<div class="form-group"><label>🎯 ปลายทาง</label><input type="text" id="order-to" placeholder="ที่อยู่ปลายทาง" value="' + esc(destInfo) + '"></div>' +
    '<div class="form-group"><label>📝 รายละเอียด</label><textarea id="order-note" rows="2" placeholder="เช่น ส่งอาหารก่อนเที่ยง"></textarea></div>' +
    '<div class="form-group"><label>📞 เบอร์ติดต่อ</label><input type="tel" id="order-phone" placeholder="08X-XXX-XXXX" value="' + esc((userProfile && userProfile.phone) || '') + '"></div>' +
    '<button class="btn-full btn-green ripple" onclick="submitOrder(\'' + esc(type) + '\')">✅ ยืนยัน</button>' +
    '<button class="btn-full btn-gray ripple" onclick="closeModal()" style="margin-top:8px">ยกเลิก</button>';
  openModal();
};

window.submitOrder = async function(type) {
  if (!currentUser) { closeModal(); showLoginModal(); return showToast('กรุณาเข้าสู่ระบบ', 'warning'); }
  const from = $('order-from').value.trim();
  const to = $('order-to').value.trim();
  const note = $('order-note').value.trim();
  const phone = $('order-phone').value.trim();
  if (!from || !to) return showToast('กรอกต้นทาง-ปลายทาง', 'error');

  try {
    await db.collection('orders').add({
      type: type,
      userId: currentUser.uid,
      userName: (userProfile && userProfile.name) || currentUser.displayName || 'ลูกค้า',
      userPhone: phone,
      title: ({ express: '📦 ส่งด่วน', ride: '🚗 เรียกรถ', food: '🍽️ สั่งอาหาร' })[type] || '📦 ออเดอร์',
      from: from, to: to, address: to, note: note,
      status: 'searching',
      fare: type === 'ride' ? 50 : 30,
      total: type === 'ride' ? 50 : 30,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งออเดอร์แล้ว');
    closeModal();
    switchTab('orders', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
  } catch (e) {
    debugLog('❌ Order: ' + e.message, true);
    showToast('ส่งไม่สำเร็จ', 'error');
  }
};

// ═══════════════════════════════════════════════════════════════════
//  📋 ORDERS TAB
// ═══════════════════════════════════════════════════════════════════
window.switchTab = function(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  if (el) el.classList.add('active');

  const th = $('tab-home'), to = $('tab-orders'), tm = $('tab-messages');
  if (th) th.style.display = 'none';
  if (to) to.style.display = 'none';
  if (tm) tm.style.display = 'none';

  const tabs = { home: th, orders: to, messages: tm };
  if (tabs[tab]) tabs[tab].style.display = 'block';

  if (tab === 'orders' && currentUser) subscribeUserOrders();
};

function subscribeUserOrders() {
  if (!currentUser || !db) return;
  if (unsubOrders) unsubOrders();

  unsubOrders = db.collection('orders')
    .where('userId', '==', currentUser.uid)
    .limit(50)
    .onSnapshot(function(snap) {
      const all = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      all.sort(function(a, b) { return (b.createdAt && b.createdAt.seconds || 0) - (a.createdAt && a.createdAt.seconds || 0); });

      const active = all.filter(function(o) { return !['done', 'delivered', 'cancelled'].includes(o.status); });
      const done = all.filter(function(o) { return ['done', 'delivered', 'cancelled'].includes(o.status); });

      const ao = $('active-orders'), doo = $('done-orders'), eo = $('empty-orders');
      if (ao) ao.innerHTML = active.length ? active.map(renderUserOrderCard).join('') : '';
      if (doo) doo.innerHTML = done.length ? done.map(renderUserOrderCard).join('') : '';
      if (eo) eo.style.display = all.length === 0 ? 'block' : 'none';
    }, function(err) { debugLog('❌ Orders: ' + err.code, true); });
}

function renderUserOrderCard(o) {
  const statusMap = {
    searching: '⏳ หาไรเดอร์', pending: '🔔 รอรับ', accepted: '🛵 ไรเดอร์รับ',
    cooking: '🍳 กำลังทำ', picked_up: '📦 รับของ', on_the_way: '🚀 กำลังส่ง',
    done: '✅ สำเร็จ', delivered: '✅ สำเร็จ', cancelled: '❌ ยกเลิก'
  };
  const color = o.status === 'cancelled' ? '#999' : (['done', 'delivered'].includes(o.status) ? '#00A651' : '#FF6B35');

  return '<div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border-left:4px solid ' + color + ';box-shadow:0 2px 8px rgba(0,0,0,.04)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<div style="font-weight:900;font-size:13px">' + esc(o.title || 'ออเดอร์') + '</div>' +
      '<div style="font-size:16px;font-weight:900;color:' + color + '">' + fmt(o.total || o.fare || 0) + '฿</div>' +
    '</div>' +
    '<div style="font-size:11px;color:#666;font-weight:700">' + (statusMap[o.status] || o.status) + '</div>' +
    '<div style="font-size:11px;color:#999;margin-top:4px">📍 ' + esc(String(o.to || o.address || '').slice(0, 60)) + '</div>' +
  '</div>';
}

// ═══════════════════════════════════════════════════════════════════
//  💬 CHAT
// ═══════════════════════════════════════════════════════════════════
window.openChat = function() {
  if (!currentUser) return showLoginModal();
  showToast('💬 เปิดหน้าแชท');
};

// ═══════════════════════════════════════════════════════════════════
//  🛒 CART
// ═══════════════════════════════════════════════════════════════════
window.addToCart = function(merchantId, merchantName, menuId, menuName, price) {
  if (cartShop && cartShop !== merchantId) {
    if (!confirm('เปลี่ยนร้าน? ตะกร้าปัจจุบันจะถูกล้าง')) return;
    cart = [];
  }
  cartShop = merchantId;
  const existing = cart.find(function(c) { return c.menuId === menuId; });
  if (existing) existing.qty++;
  else cart.push({ merchantId: merchantId, merchantName: merchantName, menuId: menuId, menuName: menuName, price: price, qty: 1 });

  localStorage.setItem('chauat_cart', JSON.stringify(cart));
  localStorage.setItem('chauat_cart_shop', cartShop);
  updateCartBar();
  showToast('✅ เพิ่มลงตะกร้า');
};

function updateCartBar() {
  const bar = $('cart-bar');
  if (!bar) return;
  if (!cart.length) { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  const total = cart.reduce(function(s, c) { return s + c.price * c.qty; }, 0);
  const count = cart.reduce(function(s, c) { return s + c.qty; }, 0);
  if ($('cart-count')) $('cart-count').textContent = count;
  if ($('cart-total')) $('cart-total').textContent = fmt(total) + '฿';
  if ($('cart-shop')) $('cart-shop').textContent = cart[0] ? cart[0].merchantName : '';
}

window.openCart = function() {
  if (!cart.length) return;
  const total = cart.reduce(function(s, c) { return s + c.price * c.qty; }, 0);
  $('modal-body').innerHTML =
    '<div style="text-align:center;margin-bottom:16px"><h2 style="font-size:20px">🛒 ตะกร้าของคุณ</h2></div>' +
    cart.map(function(c) {
      return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee">' +
        '<div><div style="font-weight:900;font-size:14px">' + esc(c.menuName) + '</div>' +
        '<div style="font-size:12px;color:#666">×' + c.qty + ' • ' + fmt(c.price) + '฿</div></div>' +
        '<div style="font-weight:900;color:#00A651">' + fmt(c.price * c.qty) + '฿</div></div>';
    }).join('') +
    '<div style="display:flex;justify-content:space-between;padding:14px 0;font-size:18px;font-weight:900">' +
      '<span>รวมทั้งสิ้น</span><span style="color:#00A651">' + fmt(total) + '฿</span></div>' +
    '<button class="btn-full btn-green ripple" onclick="checkout()">✅ สั่งซื้อ</button>' +
    '<button class="btn-full btn-gray ripple" onclick="clearCart()" style="margin-top:8px">🗑️ ล้างตะกร้า</button>' +
    '<button class="btn-full btn-gray ripple" onclick="closeModal()" style="margin-top:8px">ปิด</button>';
  openModal();
};

window.checkout = async function() {
  if (!currentUser) { closeModal(); return showLoginModal(); }
  if (!cart.length) return;
  const total = cart.reduce(function(s, c) { return s + c.price * c.qty; }, 0);
  const items = cart.map(function(c) { return { name: c.menuName, qty: c.qty, price: c.price }; });
  try {
    await db.collection('orders').add({
      type: 'food',
      userId: currentUser.uid,
      userName: (userProfile && userProfile.name) || currentUser.displayName || 'ลูกค้า',
      userPhone: (userProfile && userProfile.phone) || '',
      title: '🍽️ สั่งอาหาร: ' + (cart[0] ? cart[0].merchantName : ''),
      merchantId: cartShop,
      merchantName: cart[0] ? cart[0].merchantName : '',
      items: items,
      itemsText: items.map(function(i) { return i.name + ' x' + i.qty; }).join(', '),
      total: total, fare: 20,
      status: 'pending',
      address: (userProfile && userProfile.address) || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ ส่งออเดอร์แล้ว');
    clearCart();
    closeModal();
    switchTab('orders', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
  } catch (e) { showToast('สั่งซื้อไม่สำเร็จ', 'error'); }
};

window.clearCart = function() {
  cart = []; cartShop = '';
  localStorage.removeItem('chauat_cart');
  localStorage.removeItem('chauat_cart_shop');
  updateCartBar();
  closeModal();
};

// ═══════════════════════════════════════════════════════════════════
//  🎨 MODAL
// ═══════════════════════════════════════════════════════════════════
window.openModal = function() { const m = $('modal'); if (m) m.classList.add('show'); };
window.closeModal = function() {
  const m = $('modal');
  if (m) m.classList.remove('show');
  if ($('modal-body')) $('modal-body').innerHTML = '';
};

// ═══════════════════════════════════════════════════════════════════
//  🖼️ LIGHTBOX
// ═══════════════════════════════════════════════════════════════════
window.openLightbox = function(src) {
  if ($('lightbox-img')) $('lightbox-img').src = src;
  if ($('img-lightbox')) $('img-lightbox').classList.add('show');
};
window.closeLightbox = function() {
  if ($('img-lightbox')) $('img-lightbox').classList.remove('show');
};

// ═══════════════════════════════════════════════════════════════════
//  📡 NETWORK
// ═══════════════════════════════════════════════════════════════════
function setupNetwork() {
  window.addEventListener('online', function() {
    if ($('offline-banner')) $('offline-banner').classList.remove('show');
    showToast('🟢 กลับมาออนไลน์');
  });
  window.addEventListener('offline', function() {
    if ($('offline-banner')) $('offline-banner').classList.add('show');
  });
  if (!navigator.onLine && $('offline-banner')) $('offline-banner').classList.add('show');
}

// ═══════════════════════════════════════════════════════════════════
//  📱 PWA
// ═══════════════════════════════════════════════════════════════════
function setupPWA() {
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('chauat_pwa_dismissed') && $('pwa-install-banner')) {
      $('pwa-install-banner').classList.remove('hidden');
    }
  });
  window.addEventListener('appinstalled', function() {
    if ($('pwa-install-banner')) $('pwa-install-banner').classList.add('hidden');
    debugLog('✅ PWA ติดตั้งแล้ว');
  });
}

window.installPWA = async function() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice;
    if (r.outcome === 'accepted') { showToast('✅ ติดตั้งสำเร็จ'); if ($('pwa-install-banner')) $('pwa-install-banner').classList.add('hidden'); }
    deferredPrompt = null;
  } else {
    showToast('เปิดเมนู → เพิ่มไปที่หน้าจอหลัก', 'info');
  }
};

window.dismissPWA = function() {
  if ($('pwa-install-banner')) $('pwa-install-banner').classList.add('hidden');
  localStorage.setItem('chauat_pwa_dismissed', '1');
};

// ═══════════════════════════════════════════════════════════════════
//  📜 PDPA & LOCATION
// ═══════════════════════════════════════════════════════════════════
function checkPDPA() {
  if (!localStorage.getItem('chauat_pdpa_accepted')) {
    if ($('pdpa-overlay')) $('pdpa-overlay').classList.remove('hidden');
  } else {
    setTimeout(checkLocationPopup, 1500);
  }
}

window.acceptPDPA = function() {
  localStorage.setItem('chauat_pdpa_accepted', '1');
  if ($('pdpa-overlay')) $('pdpa-overlay').classList.add('hidden');
  setTimeout(checkLocationPopup, 500);
};

window.checkLocationPopup = function() {
  if (!localStorage.getItem('chauat_location_asked')) {
    if ($('loc-popup-overlay')) $('loc-popup-overlay').classList.remove('hidden');
  }
};

window.requestLocation = function() {
  localStorage.setItem('chauat_location_asked', '1');
  if ($('loc-popup-overlay')) $('loc-popup-overlay').classList.add('hidden');
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function(pos) {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    showToast('📍 เปิด GPS แล้ว');
  }, function() { showToast('ไม่สามารถเข้าถึง GPS', 'error'); });
};

window.skipLocation = function() {
  localStorage.setItem('chauat_location_asked', '1');
  if ($('loc-popup-overlay')) $('loc-popup-overlay').classList.add('hidden');
};

// ═══════════════════════════════════════════════════════════════════
//  📌 PLACE DETAIL
// ═══════════════════════════════════════════════════════════════════
window.showPlaceDetail = function(placeId) {
  const p = PLACES.find(function(x) { return x.id === placeId; });
  if (!p) return;

  const distance = userLocation ? fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng)) : '';
  const hasImg = hasRealImage(p.image);

  $('modal-body').innerHTML =
    (hasImg ? '<img src="' + esc(p.image) + '" style="width:100%;border-radius:14px;margin-bottom:14px;max-height:200px;object-fit:cover" onerror="this.style.display=\'none\'">' : '') +
    '<div style="text-align:center;margin-bottom:16px">' +
      '<div style="font-size:48px;margin-bottom:8px">' + (CATEGORIES[p.category] ? CATEGORIES[p.category].icon : '📍') + '</div>' +
      '<h2 style="font-size:20px;font-weight:900">' + esc(p.name) + '</h2>' +
      '<div style="font-size:12px;color:#666;margin-top:6px">' + (CATEGORIES[p.category] ? CATEGORIES[p.category].name : '') + (p.rating ? ' • ⭐ ' + p.rating : '') + (distance ? ' • 📍 ' + distance : '') + '</div>' +
      (p.price ? '<div style="margin-top:6px;color:#00A651;font-weight:900">' + esc(p.price) + '</div>' : '') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
      '<button class="btn-full btn-green ripple" onclick="callRiderToPlace(\'' + esc(p.id) + '\')">🛵 เรียกไรเดอร์</button>' +
      '<button class="btn-full btn-gray ripple" onclick="openInMaps(' + p.lat + ',' + p.lng + ')">🧭 นำทาง</button>' +
    '</div>' +
    '<button class="btn-full btn-gray ripple" onclick="closeModal()">ปิด</button>';
  openModal();
};

window.callRiderToPlace = function(placeId) {
  const p = PLACES.find(function(x) { return x.id === placeId; });
  if (!p) return;
  closeModal();
  openOrderForm('ride', { lat: p.lat, lng: p.lng });
};

window.openInMaps = function(lat, lng) {
  window.open('https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng, '_blank');
};

// ═══════════════════════════════════════════════════════════════════
//  🎯 GLOBAL EVENT DELEGATION
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  // Profile avatar
  const avatar = e.target.closest('#profile-avatar-btn');
  if (avatar) { openProfileSheet(); return; }

  // Place card
  const placeCard = e.target.closest('[data-place-id]');
  if (placeCard) { showPlaceDetail(placeCard.dataset.placeId); return; }

  // Merchant card
  const merchantCard = e.target.closest('[data-merchant-id]');
  if (merchantCard) { openMerchantDetail(merchantCard.dataset.merchantId); return; }

  // Close search results when clicking outside
  if (!e.target.closest('.search-bar') && !e.target.closest('.search-results')) {
    const sr = $('search-results');
    if (sr) sr.classList.remove('show');
  }
});

// Search input clear
document.addEventListener('input', function(e) {
  if (e.target.id === 'search-input' && !e.target.value) {
    const sr = $('search-results');
    if (sr) sr.classList.remove('show');
  }
});

// Haptic
document.addEventListener('click', function(e) {
  const btn = e.target.closest('button, .food-card, .menu-item, .nav-item');
  if (btn && navigator.vibrate) navigator.vibrate(10);
}, { passive: true });

// Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(function(reg) {
        reg.update();
        setInterval(function() { reg.update(); }, 60000);
      }).catch(function(err) { console.warn('[SW]', err); });
  });
}

// ═══════════════════════════════════════════════════════════════════
//  ✅ LOG
// ═══════════════════════════════════════════════════════════════════
console.log('%c🛵 Chauat Go v3.3.3', 'color:#76B82A;font-weight:900;font-size:16px');