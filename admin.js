<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#76B82A">
<meta name="robots" content="noindex,nofollow">
<title>Chauat Go Admin — v3.4.8</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Chauat Admin">
<meta name="mobile-web-app-capable" content="yes">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">

<!-- ═══ AUTO CACHE-BUSTING ═══ -->
<script>
(function() {
  var VERSION = 'v3.4.8-20241010-001';
  var saved = localStorage.getItem('chauat_ver_admin');
  var lastReload = localStorage.getItem('chauat_last_reload_admin');
  var now = Date.now();
  if (lastReload && (now - parseInt(lastReload)) < 5000) {
    localStorage.setItem('chauat_ver_admin', VERSION);
    return;
  }
  if (saved !== VERSION) {
    localStorage.setItem('chauat_ver_admin', VERSION);
    localStorage.setItem('chauat_last_reload_admin', now.toString());
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).then(function() { location.reload(true); });
    } else { location.reload(true); }
  }
})();
</script>

<script>
(function() {
  var theme = localStorage.getItem('chauat_admin_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
</script>

<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="icons/icon-512.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="manifest" href="manifest.json">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="admin.css">
</head>
<body>

<!-- ═══ SPLASH ═══ -->
<div id="splash-screen">
  <div class="splash-logo">🛵</div>
  <div class="splash-title">Chauat Go Admin</div>
  <div class="splash-sub">ระบบจัดการภาพรวม</div>
  <div class="splash-loader"><div class="splash-loader-bar" id="splash-bar"></div></div>
  <div class="splash-footer">© 2024 Chauat Go</div>
</div>

<!-- ═══ THEME FAB ═══ -->
<button class="theme-fab" onclick="toggleTheme()" id="theme-fab" title="เปลี่ยนธีม">🌙</button>

<!-- ═══ OFFLINE ═══ -->
<div class="offline-banner" id="offline-banner">🔴 คุณออฟไลน์ — ตรวจสอบการเชื่อมต่อ</div>

<!-- ═══ TOAST ═══ -->
<div class="toast" id="toast"></div>

<!-- ═══ PWA BANNER ═══ -->
<div id="pwa-install-banner" class="pwa-banner hidden">
  <div style="font-size:28px">🛵</div>
  <div style="flex:1">
    <div style="font-size:13px;font-weight:900;color:var(--text)">ติดตั้ง Chauat Admin</div>
    <div style="font-size:11px;color:var(--text-muted);font-weight:600">เพิ่มลงหน้าจอหลัก</div>
  </div>
  <button class="pwa-btn-primary" onclick="installPWA()">ติดตั้ง</button>
  <button class="pwa-btn-close" onclick="dismissPWA()">✕</button>
</div>

<!-- ═══════════════════════════════════════════════════════════
     LOGIN SCREEN
     ═══════════════════════════════════════════════════════════ -->
<div id="login-screen">
  <div class="login-card">
    <div class="login-icon">🛵</div>
    <h1>Chauat Go Admin</h1>
    <p class="login-subtitle">สำหรับผู้ดูแลระบบเท่านั้น</p>

    <div class="auth-tabs">
      <button class="auth-tab active" id="tab-login" onclick="switchAuthTab('login')">เข้าสู่ระบบ</button>
      <button class="auth-tab" id="tab-signup" onclick="switchAuthTab('signup')">สมัครสมาชิก</button>
    </div>

    <form id="form-login" onsubmit="handleLogin(event)">
      <div class="form-field">
        <label>📧 อีเมล</label>
        <input type="email" id="login-email" placeholder="admin@chauatgo.com" required autocomplete="email">
      </div>
      <div class="form-field">
        <label>🔒 รหัสผ่าน</label>
        <input type="password" id="login-password" placeholder="••••••••" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn-primary ripple" id="btn-login">🔓 เข้าสู่ระบบ</button>
      <button type="button" class="btn-secondary ripple" onclick="handleForgotPassword()">🔑 ลืมรหัสผ่าน</button>
    </form>

    <form id="form-signup" style="display:none" onsubmit="handleSignup(event)">
      <div class="form-field">
        <label>👤 ชื่อ-นามสกุล</label>
        <input type="text" id="su-name" placeholder="ผู้ดูแลระบบ" required maxlength="80">
      </div>
      <div class="form-field">
        <label>📧 อีเมล</label>
        <input type="email" id="su-email" placeholder="admin@chauatgo.com" required autocomplete="email">
      </div>
      <div class="form-field">
        <label>🔒 รหัสผ่าน (6+)</label>
        <input type="password" id="su-password" minlength="6" required autocomplete="new-password">
      </div>
      <div class="form-field">
        <label>🔒 ยืนยันรหัสผ่าน</label>
        <input type="password" id="su-password2" minlength="6" required>
      </div>
      <div style="background:var(--yellow-light);border-left:4px solid var(--yellow);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;font-weight:700;color:#856404">
        ⚠️ หลังสมัครแล้ว ต้องรอ Master Admin อนุมัติก่อน
      </div>
      <button type="submit" class="btn-primary ripple" id="btn-signup">✅ สมัครสมาชิก</button>
    </form>

    <div id="login-error" class="login-error"></div>
    <div class="login-hint">🔐 เข้าได้เฉพาะผู้ดูแลระบบ</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════
     MAIN APP
     ═══════════════════════════════════════════════════════════ -->
<div id="app" class="hidden">
  <header class="app-header">
    <div class="header-info">
      <div class="name">Chauat Admin</div>
      <div class="who" id="who">—</div>
      <div class="vbadge">v3.4.8</div>
    </div>
    <button class="menu-btn ripple" onclick="toggleMenu()">☰</button>
  </header>

  <!-- NAV -->
  <nav id="nav" class="hidden"></nav>

  <!-- MENU OVERLAY -->
  <div class="menu-overlay" id="menu-overlay" onclick="if(event.target===this)closeMenu()">
    <div class="menu-panel">
      <div class="menu-header">
        <div class="menu-title">☰ เมนู</div>
        <button class="menu-close ripple" onclick="closeMenu()">✕</button>
      </div>

      <div class="menu-user">
        <div class="menu-user-icon">🛵</div>
        <div class="menu-user-info">
          <div class="menu-user-name" id="menu-user-name">—</div>
          <div class="menu-user-email" id="menu-user-email">—</div>
          <div class="menu-user-role" id="menu-user-role">Admin</div>
        </div>
      </div>

      <div class="menu-links" id="menu-links"></div>

      <button class="menu-logout ripple" onclick="handleLogout()">🚪 ออกจากระบบ</button>
      <div class="menu-version">Chauat Admin v3.4.8 • © 2024</div>
    </div>
  </div>

  <!-- MAIN -->
  <main id="main"></main>
</div>

<!-- ═══════════════════════════════════════════════════════════
     CHAT CONTAINER
     ═══════════════════════════════════════════════════════════ -->
<div class="chat-container" id="chat-container">
  <div class="chat-header">
    <button class="back-btn ripple" onclick="closeChat()">←</button>
    <div class="chat-info">
      <div class="chat-name" id="chat-name">—</div>
      <div class="chat-sub" id="chat-sub">—</div>
    </div>
  </div>
  <div class="chat-messages" id="chat-messages"></div>
  <div class="chat-input-bar">
    <button class="icon-btn ripple" onclick="pickChatImage()">📷</button>
    <input type="file" id="chat-image-input" accept="image/*" style="display:none" onchange="sendChatImage(this.files[0])">
    <textarea id="chat-input" placeholder="พิมพ์ข้อความ..." rows="1" oninput="autoResize(this)"></textarea>
    <button class="send-btn ripple" onclick="sendChatText()">➤</button>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════
     MODAL
     ═══════════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-hdr">
      <h2 id="modal-title">—</h2>
      <button class="close-btn ripple" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════
     FIREBASE SDK
     ═══════════════════════════════════════════════════════════ -->
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js"></script>

<script src="admin.js"></script>

</body>
</html>