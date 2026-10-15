/* ChauatGo in-app voice calls (audio only).
   Signaling lives at orders/{orderId}/calls/{callId}
   with subcollections offer, answer, and ice.
   Works only while this page stays open in the foreground.

   TURN is empty on purpose. Public Google STUN is enough on many
   networks. A symmetric mobile NAT often needs a TURN server.
   Fill CHAUAT_TURN_SERVERS and ship a new cache to turn that on.
   Example:
     { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
*/
var CHAUAT_TURN_SERVERS = [];
window.CHAUAT_TURN_SERVERS = CHAUAT_TURN_SERVERS;

(function () {
  var RING_MS_DEFAULT = 30000;
  var TERMINAL = { done: 1, delivered: 1, cancelled: 1 };
  var ROLE_LABEL = { customer: 'ลูกค้า', rider: 'ไรเดอร์', merchant: 'ร้าน' };

  var role = '';
  var getDb = function () { return null; };
  var getUid = function () { return ''; };
  var onChange = function () {};
  var ringMs = RING_MS_DEFAULT;

  var orders = {};
  var orderUnsubs = {};
  var missed = {};
  var seenMiss = {};
  var lastMissSig = '';
  var session = null;
  var closing = false;

  var ringCtx = null;
  var ringOn = false;
  var ringWait = null;
  var root = null;
  var remoteAudio = null;
  var labChannel = null;
  var lab = { calls: {}, offer: {}, answer: {}, ice: {}, orderSubs: [], callSubs: {} };

  function uid() { return getUid() || ''; }
  function db() { return getDb ? getDb() : null; }
  function useLab() { return !!window.__CHAUAT_CALL_LAB; }
  function terminal(status) { return !!TERMINAL[status]; }

  function toast(msg) {
    if (!msg) return;
    window.__lastCallToast = msg;
    if (typeof window.showToast === 'function') window.showToast(msg, 'warning');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function roleOn(order, id) {
    if (!order || !id) return '';
    if (order.riderId && order.riderId === id) return 'rider';
    if (order.merchantId && order.merchantId === id) return 'merchant';
    if (order.userId && order.userId === id) return 'customer';
    return '';
  }

  function uidFor(order, party) {
    if (!order) return '';
    if (party === 'customer') return order.userId || '';
    if (party === 'rider') return order.riderId || '';
    if (party === 'merchant') return order.merchantId || '';
    return '';
  }

  function clip(s) {
    s = String(s || '');
    return s.length > 80 ? s.slice(0, 80) : s;
  }

  function nameFor(order, party) {
    if (party === 'customer') return (order && order.userName) || 'ลูกค้า';
    if (party === 'rider') return (order && order.riderName) || 'ไรเดอร์';
    if (party === 'merchant') return (order && (order.merchantName || order.shopPlaceName)) || 'ร้าน';
    return 'คู่สาย';
  }

  function iceServers() {
    var servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    var extra = window.CHAUAT_TURN_SERVERS || [];
    for (var i = 0; i < extra.length; i++) {
      if (extra[i] && extra[i].urls) servers.push(extra[i]);
    }
    return servers;
  }

  function micMessage(err) {
    var name = (err && (err.name || err.code)) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'ไม่ได้รับอนุญาตใช้ไมโครโฟน เปิดสิทธิ์ไมโครโฟนในการตั้งค่าเบราว์เซอร์ แล้วลองโทรใหม่';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'ไม่พบไมโครโฟนบนอุปกรณ์นี้';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'ไมโครโฟนถูกใช้งานอยู่ ปิดแอปอื่นที่ใช้ไมค์แล้วลองใหม่';
    }
    if (name === 'SecurityError') {
      return 'เบราว์เซอร์บล็อกไมโครโฟน ต้องเปิดแอปผ่านการเชื่อมต่อที่ปลอดภัย';
    }
    return 'ใช้ไมโครโฟนไม่ได้ กรุณาอนุญาตไมโครโฟนแล้วลองใหม่';
  }

  function callErrorMessage(err) {
    var code = (err && err.code) || '';
    if (code === 'permission-denied') {
      return 'โทรไม่ได้ กฎ Firestore ยังไม่เปิดให้ส่งสัญญาณสาย ต้อง Publish กฎใหม่ก่อน';
    }
    return 'โทรไม่สำเร็จ ลองอีกครั้ง';
  }

  function mount() {
    if (root) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="chauat-call-root" class="chauat-call-root" hidden>' +
        '<div class="chauat-call-card">' +
          '<div class="chauat-call-kicker" id="chauat-call-kicker">สายเรียกเข้า</div>' +
          '<div class="chauat-call-name" id="chauat-call-name">—</div>' +
          '<div class="chauat-call-sub" id="chauat-call-sub">—</div>' +
          '<div class="chauat-call-timer" id="chauat-call-timer">กำลังเรียก…</div>' +
          '<p class="chauat-call-note">โทรได้เฉพาะตอนเปิดหน้านี้ค้างไว้ ถ้าเสียงเบา ให้เปิดลำโพงที่ตัวเครื่อง — แอปเว็บสลับลำโพงให้เองไม่ได้</p>' +
          '<div class="chauat-call-actions" id="chauat-call-actions"></div>' +
          '<button type="button" class="chauat-call-banner" id="chauat-call-banner" hidden>แตะเพื่อเปิดเสียงสายเรียกเข้า</button>' +
        '</div>' +
        '<audio id="chauat-call-remote" autoplay playsinline></audio>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    root = document.getElementById('chauat-call-root');
    remoteAudio = document.getElementById('chauat-call-remote');
    remoteAudio.setAttribute('playsinline', '');
    document.getElementById('chauat-call-banner').addEventListener('click', function () {
      unlockAudio();
    });
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function showBanner(on) {
    var el = document.getElementById('chauat-call-banner');
    if (el) el.hidden = !on;
  }

  function showOverlay(opts) {
    mount();
    setText('chauat-call-kicker', opts.kicker || '');
    setText('chauat-call-name', opts.name || 'คู่สาย');
    setText('chauat-call-sub', opts.sub || '');
    setText('chauat-call-timer', opts.timer || '');
    var actions = document.getElementById('chauat-call-actions');
    if (actions) actions.innerHTML = opts.actions || '';
    root.hidden = false;
  }

  function hideOverlay() {
    if (root) root.hidden = true;
    showBanner(false);
  }

  function actionButtons() {
    if (!session) return '';
    if (session.phase === 'incoming') {
      return '<button type="button" class="chauat-call-decline" onclick="ChauatCall.decline()">ปฏิเสธ</button>' +
        '<button type="button" class="chauat-call-accept" onclick="ChauatCall.accept()">รับสาย</button>';
    }
    var muteLabel = session.muted ? 'เปิดไมค์' : 'ปิดไมค์';
    var mute = session.phase === 'active'
      ? '<button type="button" class="chauat-call-mute" onclick="ChauatCall.toggleMute()">' + muteLabel + '</button>'
      : '';
    return mute + '<button type="button" class="chauat-call-hangup" onclick="ChauatCall.hangup()">วางสาย</button>';
  }

  function paintSession() {
    if (!session) return hideOverlay();
    var kicker = session.phase === 'incoming' ? 'สายเรียกเข้า'
      : (session.phase === 'active' ? 'กำลังคุย' : 'กำลังโทร…');
    var timer = session.phase === 'active' ? formatDuration() : (session.timerText || (session.phase === 'incoming' ? 'แตะรับสาย' : 'กำลังเรียก…'));
    showOverlay({
      kicker: kicker,
      name: session.peerName,
      sub: session.sub || '',
      timer: timer,
      actions: actionButtons()
    });
  }

  function formatDuration() {
    var started = session && session.answeredAt;
    if (!started) return '00:00';
    var sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    var m = String(Math.floor(sec / 60)).padStart(2, '0');
    var s = String(sec % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function unlockAudio() {
    if (typeof window.unlockRiderAudio === 'function') {
      try { window.unlockRiderAudio(); } catch (e) {}
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve(false);
    if (!ringCtx) {
      try { ringCtx = new Ctx(); }
      catch (e) { return Promise.resolve(false); }
    }
    var pending = ringCtx.state === 'suspended' ? ringCtx.resume() : Promise.resolve();
    try {
      var buf = ringCtx.createBuffer(1, 1, 22050);
      var src = ringCtx.createBufferSource();
      src.buffer = buf;
      src.connect(ringCtx.destination);
      src.start(0);
    } catch (e) {}
    return Promise.resolve(pending).then(function () {
      var ok = ringCtx && ringCtx.state === 'running';
      if (ok && session && session.phase === 'incoming') startRingtone();
      else showBanner(session && session.phase === 'incoming' && !ok);
      return ok;
    }).catch(function () {
      showBanner(session && session.phase === 'incoming');
      return false;
    });
  }

  function bindUnlock() {
    var once = function () { unlockAudio(); };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('touchend', once, true);
  }

  function beep(freq, when) {
    if (!ringCtx || ringCtx.state !== 'running') return;
    var osc = ringCtx.createOscillator();
    var gain = ringCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    var t = ringCtx.currentTime + when;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain);
    gain.connect(ringCtx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  function startRingtone() {
    if (ringOn) return;
    if (!ringCtx || ringCtx.state !== 'running') {
      showBanner(true);
      return;
    }
    showBanner(false);
    ringOn = true;
    var loop = function () {
      if (!ringOn) return;
      beep(440, 0);
      beep(480, 0);
      beep(440, 0.4);
      beep(480, 0.4);
      ringWait = setTimeout(loop, 2200);
    };
    loop();
  }

  function stopRingtone() {
    ringOn = false;
    if (ringWait) { clearTimeout(ringWait); ringWait = null; }
  }

  function notifyMissed() {
    var sig = Object.keys(missed).sort().join(',');
    if (sig === lastMissSig) return;
    lastMissSig = sig;
    try { onChange(); } catch (e) {}
  }

  function noteMissed(orderId, data) {
    if (!data || seenMiss[data.id]) return;
    seenMiss[data.id] = true;
    missed[orderId] = { name: data.callerName || 'คู่สาย', callId: data.id };
    toast('ไม่ได้รับสายจาก ' + missed[orderId].name);
    notifyMissed();
  }

  function callAge(data) {
    var created = data && data.createdAt;
    var t = created && created.toDate ? created.toDate().getTime()
      : (typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now());
    return Date.now() - t;
  }

  function labEnsure() {
    if (labChannel) return;
    var relay = window.__CHAUAT_CALL_LAB && window.__CHAUAT_CALL_LAB.relay;
    if (relay && typeof WebSocket !== 'undefined') {
      var ws = new WebSocket(relay);
      var queue = [];
      labChannel = {
        postMessage: function (m) {
          var raw = JSON.stringify(m);
          if (ws.readyState === 1) ws.send(raw);
          else queue.push(raw);
        }
      };
      ws.onopen = function () {
        window.__CHAUAT_CALL_RELAY_OPEN = true;
        queue.forEach(function (raw) { ws.send(raw); });
        queue = [];
      };
      ws.onmessage = function (ev) {
        try { labApply(JSON.parse(ev.data), false); } catch (e) {}
      };
      return;
    }
    if (typeof BroadcastChannel === 'undefined') return;
    labChannel = new BroadcastChannel('chauat-voice-lab');
    labChannel.onmessage = function (ev) {
      labApply(ev.data, false);
    };
  }

  function labApply(m, local) {
    if (!m) return;
    if (m.op === 'call' && m.call) lab.calls[m.call.id] = m.call;
    if (m.op === 'offer') lab.offer[m.callId] = m.sdp;
    if (m.op === 'answer') lab.answer[m.callId] = m.sdp;
    if (m.op === 'ice') {
      lab.ice[m.callId] = lab.ice[m.callId] || [];
      lab.ice[m.callId].push(m.ice);
    }
    var orderId = m.orderId || (m.call && m.call.orderId);
    lab.orderSubs.forEach(function (sub) {
      if (!orderId || sub.orderId === orderId) sub.fn(labCalls(sub.orderId));
    });
    var subs = lab.callSubs[m.callId] || [];
    subs.forEach(function (fn) { fn(); });
    if (local && labChannel) {
      try { labChannel.postMessage(m); } catch (e) {}
    }
  }

  function labCalls(orderId) {
    return Object.keys(lab.calls).map(function (id) { return lab.calls[id]; })
      .filter(function (c) { return c.orderId === orderId; });
  }

  function subscribeOrder(orderId, fn) {
    if (useLab()) {
      labEnsure();
      var sub = { orderId: orderId, fn: fn };
      lab.orderSubs.push(sub);
      fn(labCalls(orderId));
      return function () {
        lab.orderSubs = lab.orderSubs.filter(function (s) { return s !== sub; });
      };
    }
    var store = db();
    if (!store) return function () {};
    return store.collection('orders').doc(orderId).collection('calls').onSnapshot(function (snap) {
      var list = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      fn(list);
    }, function (err) { console.warn('call listen', err && err.code); });
  }

  function subscribeCall(orderId, callId, handlers) {
    if (useLab()) {
      labEnsure();
      var fn = function () {
        var call = lab.calls[callId];
        if (call && handlers.onCall) handlers.onCall(call);
        if (lab.offer[callId] && handlers.onOffer) handlers.onOffer(lab.offer[callId]);
        if (lab.answer[callId] && handlers.onAnswer) handlers.onAnswer(lab.answer[callId]);
        (lab.ice[callId] || []).forEach(function (ice) {
          if (handlers.onIce) handlers.onIce(ice);
        });
      };
      lab.callSubs[callId] = lab.callSubs[callId] || [];
      lab.callSubs[callId].push(fn);
      fn();
      return function () {
        lab.callSubs[callId] = (lab.callSubs[callId] || []).filter(function (f) { return f !== fn; });
      };
    }
    var store = db();
    if (!store) return function () {};
    var base = store.collection('orders').doc(orderId).collection('calls').doc(callId);
    var stops = [];
    stops.push(base.onSnapshot(function (snap) {
      if (snap.exists && handlers.onCall) handlers.onCall(Object.assign({ id: snap.id }, snap.data()));
    }, function () {}));
    stops.push(base.collection('offer').doc('main').onSnapshot(function (snap) {
      if (snap.exists && handlers.onOffer) handlers.onOffer(snap.data().sdp);
    }, function () {}));
    stops.push(base.collection('answer').doc('main').onSnapshot(function (snap) {
      if (snap.exists && handlers.onAnswer) handlers.onAnswer(snap.data().sdp);
    }, function () {}));
    stops.push(base.collection('ice').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'added' && handlers.onIce) handlers.onIce(Object.assign({ id: ch.doc.id }, ch.doc.data()));
      });
    }, function () {}));
    return function () { stops.forEach(function (s) { try { s(); } catch (e) {} }); };
  }

  function createCallDoc(orderId, fields) {
    if (useLab()) {
      labEnsure();
      var id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var call = Object.assign({ id: id, orderId: orderId, createdAtMs: Date.now() }, fields);
      labApply({ op: 'call', orderId: orderId, callId: id, call: call }, true);
      return Promise.resolve(id);
    }
    var store = db();
    var ref = store.collection('orders').doc(orderId).collection('calls').doc();
    return ref.set(fields).then(function () { return ref.id; });
  }

  function patchCall(orderId, callId, fields) {
    if (useLab()) {
      var call = lab.calls[callId];
      if (!call) return Promise.resolve();
      var next = Object.assign({}, call, fields);
      labApply({ op: 'call', orderId: orderId, callId: callId, call: next }, true);
      return Promise.resolve();
    }
    return db().collection('orders').doc(orderId).collection('calls').doc(callId).update(fields);
  }

  function putOffer(orderId, callId, sdp) {
    if (useLab()) {
      labApply({ op: 'offer', orderId: orderId, callId: callId, sdp: sdp }, true);
      return Promise.resolve();
    }
    return db().collection('orders').doc(orderId).collection('calls').doc(callId)
      .collection('offer').doc('main').set({ type: 'offer', sdp: sdp });
  }

  function putAnswer(orderId, callId, sdp) {
    if (useLab()) {
      labApply({ op: 'answer', orderId: orderId, callId: callId, sdp: sdp }, true);
      return Promise.resolve();
    }
    return db().collection('orders').doc(orderId).collection('calls').doc(callId)
      .collection('answer').doc('main').set({ type: 'answer', sdp: sdp });
  }

  function putIce(orderId, callId, ice) {
    if (!session || session.callId !== callId) return Promise.resolve();
    if (useLab()) {
      labApply({ op: 'ice', orderId: orderId, callId: callId, ice: ice }, true);
      return Promise.resolve();
    }
    return db().collection('orders').doc(orderId).collection('calls').doc(callId)
      .collection('ice').add(ice);
  }

  function waitFor(fn, ms) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function tick() {
        var value = fn();
        if (value) return resolve(value);
        if (Date.now() - start > ms) return reject(new Error('timeout'));
        setTimeout(tick, 150);
      })();
    });
  }

  function attachPc(stream) {
    var pc = new RTCPeerConnection({ iceServers: iceServers() });
    session.pc = pc;
    session.iceSeen = session.iceSeen || {};
    session.iceQueue = session.iceQueue || [];
    stream.getTracks().forEach(function (track) { pc.addTrack(track, stream); });
    pc.ontrack = function (ev) {
      var streamRemote = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
      remoteAudio.srcObject = streamRemote;
      var play = remoteAudio.play();
      if (play && play.catch) play.catch(function () {});
      if (session && session.phase !== 'active') {
        session.phase = 'active';
        session.answeredAt = session.answeredAt || Date.now();
        startDuration();
        paintSession();
      }
    };
    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !session) return;
      var c = ev.candidate;
      if (!c.candidate) return;
      putIce(session.orderId, session.callId, {
        fromUid: uid(),
        candidate: c.candidate,
        sdpMid: c.sdpMid || '0',
        sdpMLineIndex: typeof c.sdpMLineIndex === 'number' ? c.sdpMLineIndex : 0
      }).catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      if (!session || !pc) return;
      if (pc.connectionState === 'failed') {
        toast('เชื่อมเสียงไม่สำเร็จ บางเครือข่ายมือถือต้องตั้งเซิร์ฟเวอร์ TURN');
      }
    };
    return pc;
  }

  function takeIce(ice) {
    if (!session || !ice || ice.fromUid === uid()) return;
    var key = ice.id || (ice.fromUid + '|' + ice.candidate);
    if (session.iceSeen[key]) return;
    session.iceSeen[key] = true;
    var candidate = {
      candidate: ice.candidate,
      sdpMid: ice.sdpMid || '0',
      sdpMLineIndex: typeof ice.sdpMLineIndex === 'number' ? ice.sdpMLineIndex : 0
    };
    if (!candidate.candidate) return;
    if (session.pc && session.pc.remoteDescription && !session.iceBusy) {
      session.pc.addIceCandidate(candidate).catch(function () {});
    } else {
      session.iceQueue.push(candidate);
    }
  }

  function flushIce() {
    if (!session || !session.pc || !session.pc.remoteDescription) return Promise.resolve();
    var pc = session.pc;
    var queued = session.iceQueue || [];
    session.iceQueue = [];
    return queued.reduce(function (chain, c) {
      return chain.then(function () {
        return pc.addIceCandidate(c).catch(function () {});
      });
    }, Promise.resolve());
  }

  function bindCall(orderId, callId) {
    if (session.detailUnsub) session.detailUnsub();
    session.detailUnsub = subscribeCall(orderId, callId, {
      onCall: function (call) { handleCallDoc(orderId, call); },
      onOffer: function (sdp) { if (session) session.offerSdp = sdp; },
      onAnswer: function (sdp) { applyAnswer(sdp); },
      onIce: function (ice) { takeIce(ice); }
    });
  }

  function applyAnswer(sdp) {
    if (!session || session.answerApplied || !session.outgoing || !sdp) return;
    session.answerApplied = true;
    session.iceBusy = true;
    session.pc.setRemoteDescription({ type: 'answer', sdp: sdp }).then(function () {
      return flushIce();
    }).then(function () {
      if (session) session.iceBusy = false;
      return flushIce();
    }).then(function () {
      if (!session) return;
      session.phase = 'active';
      session.answeredAt = Date.now();
      clearRingTimeout();
      startDuration();
      paintSession();
    }).catch(function () {
      toast('เชื่อมเสียงไม่สำเร็จ');
    });
  }

  function startDuration() {
    if (!session || session.tick) return;
    session.answeredAt = session.answeredAt || Date.now();
    session.tick = setInterval(function () {
      if (!session || session.phase !== 'active') return;
      setText('chauat-call-timer', formatDuration());
    }, 500);
  }

  function clearRingTimeout() {
    if (session && session.ringTimer) {
      clearTimeout(session.ringTimer);
      session.ringTimer = null;
    }
  }

  function armRingTimeout() {
    clearRingTimeout();
    if (!session) return;
    var remain = Math.max(0, ringMs - (session.startedAt ? (Date.now() - session.startedAt) : 0));
    session.ringTimer = setTimeout(function () { timeoutMiss(); }, remain);
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
  }

  function cleanupMedia() {
    stopRingtone();
    if (session && session.tick) { clearInterval(session.tick); session.tick = null; }
    clearRingTimeout();
    if (session && session.detailUnsub) { session.detailUnsub(); session.detailUnsub = null; }
    if (session && session.orderWatch) { session.orderWatch(); session.orderWatch = null; }
    if (session && session.pc) {
      try { session.pc.onicecandidate = null; session.pc.close(); } catch (e) {}
      session.pc = null;
    }
    if (session) stopStream(session.stream);
    if (remoteAudio) {
      try { remoteAudio.pause(); } catch (e) {}
      remoteAudio.srcObject = null;
    }
  }

  function finishLocal(msg, doToast) {
    if (closing) return;
    closing = true;
    cleanupMedia();
    session = null;
    hideOverlay();
    closing = false;
    if (doToast) toast(msg);
  }

  function handleCallDoc(orderId, data) {
    if (!data) return;
    var me = uid();
    if (session && session.callId === data.id) {
      if (session.leaving) return;
      if (data.status === 'active' && session.outgoing && session.phase === 'outgoing') {
        session.phase = 'connecting';
        session.timerText = 'อีกฝ่ายรับแล้ว กำลังเชื่อมเสียง…';
        paintSession();
      }
      if (data.status === 'missed' && !session.outgoing) {
        noteMissed(orderId, data);
        return finishLocal('ไม่ได้รับสาย', true);
      }
      if (data.status === 'declined' && session.outgoing) return finishLocal('อีกฝ่ายปฏิเสธสาย', true);
      if (data.status === 'missed' && session.outgoing) return finishLocal('ไม่รับสาย', true);
      if (data.status === 'cancelled' && !session.outgoing) return finishLocal('อีกฝ่ายวางสาย', true);
      if (data.status === 'ended') return finishLocal('วางสายแล้ว', true);
      return;
    }
    if (data.calleeUid === me && data.status === 'ringing') {
      if (callAge(data) > ringMs) {
        patchCall(orderId, data.id, { status: 'missed' }).catch(function () {});
        noteMissed(orderId, data);
        return;
      }
      showIncoming(orderId, data);
    } else if (data.calleeUid === me && data.status === 'missed') {
      noteMissed(orderId, data);
    }
  }

  function showIncoming(orderId, data) {
    if (session) return;
    var order = orders[orderId] || {};
    session = {
      orderId: orderId,
      callId: data.id,
      outgoing: false,
      phase: 'incoming',
      peerName: data.callerName || nameFor(order, data.callerRole),
      sub: (order.title || 'ออเดอร์') + ' • ' + (ROLE_LABEL[data.callerRole] || ''),
      startedAt: Date.now() - Math.max(0, callAge(data)),
      offerSdp: '',
      iceSeen: {},
      iceQueue: []
    };
    bindCall(orderId, data.id);
    watchThisOrder(orderId);
    armRingTimeout();
    paintSession();
    unlockAudio().then(function (ok) {
      if (ok) startRingtone();
      else showBanner(true);
    });
  }

  function watchThisOrder(orderId) {
    if (!session || session.orderWatch || useLab()) return;
    var store = db();
    if (!store) return;
    session.orderWatch = store.collection('orders').doc(orderId).onSnapshot(function (snap) {
      var status = snap.exists ? snap.data().status : 'cancelled';
      if (terminal(status)) endBecauseOrder();
    }, function () {});
  }

  function endBecauseOrder() {
    if (!session || session.leaving) return;
    var next = (session.phase === 'active' || session.phase === 'connecting')
      ? 'ended'
      : (session.outgoing ? 'cancelled' : 'missed');
    var orderId = session.orderId;
    var callId = session.callId;
    var peerName = session.peerName;
    var outgoing = session.outgoing;
    session.leaving = true;
    var fields = { status: next };
    if (next === 'ended') fields.endedBy = uid();
    patchCall(orderId, callId, fields).catch(function () {});
    if (!outgoing && next === 'missed') noteMissed(orderId, { id: callId, callerName: peerName });
    finishLocal('ออเดอร์จบแล้ว จึงวางสาย', true);
  }

  function timeoutMiss() {
    if (!session || session.leaving || session.phase === 'active') return;
    var orderId = session.orderId;
    var callId = session.callId;
    var outgoing = session.outgoing;
    var peerName = session.peerName;
    session.leaving = true;
    patchCall(orderId, callId, { status: 'missed' }).catch(function () {});
    if (!outgoing) noteMissed(orderId, { id: callId, callerName: peerName });
    finishLocal(outgoing ? 'ไม่รับสาย' : 'ไม่ได้รับสาย', true);
  }

  function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject({ name: 'NotFoundError' });
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    });
  }

  function otherParties(order, myRole) {
    var parties = ['customer', 'rider', 'merchant'];
    var out = [];
    parties.forEach(function (party) {
      if (party === myRole) return;
      var id = uidFor(order, party);
      if (!id || id === uid()) return;
      out.push({ role: party, label: ROLE_LABEL[party] });
    });
    return out;
  }

  function buttons(orderId) {
    var order = orders[orderId];
    var me = uid();
    if (!order || !me || terminal(order.status)) return '';
    var myRole = roleOn(order, me);
    if (!myRole) return '';
    var html = '';
    if (missed[orderId]) {
      html += '<button type="button" class="chauat-call-missed" onclick="event.stopPropagation();ChauatCall.dismissMissed(\'' + esc(orderId) + '\')">พลาดสายจาก ' + esc(missed[orderId].name) + '</button>';
    }
    otherParties(order, myRole).forEach(function (party) {
      html += '<button type="button" class="chauat-call-btn" onclick="event.stopPropagation();ChauatCall.start(\'' + esc(orderId) + '\',\'' + party.role + '\')">📞 โทรหา' + esc(party.label) + '</button>';
    });
    if (!html) return '';
    return '<div class="chauat-call-row">' + html + '</div>';
  }

  function watch(list) {
    var next = {};
    (list || []).forEach(function (order) {
      if (order && order.id) next[order.id] = order;
    });
    orders = next;
    var want = {};
    Object.keys(orders).forEach(function (id) {
      if (!terminal(orders[id].status)) want[id] = true;
    });
    Object.keys(orderUnsubs).forEach(function (id) {
      if (!want[id]) {
        try { orderUnsubs[id](); } catch (e) {}
        delete orderUnsubs[id];
      }
    });
    if (!useLab() && !db()) return;
    Object.keys(want).forEach(function (id) {
      if (orderUnsubs[id]) return;
      orderUnsubs[id] = subscribeOrder(id, function (calls) {
        calls.forEach(function (call) { handleCallDoc(id, call); });
      });
    });
    if (session && (!orders[session.orderId] || terminal(orders[session.orderId].status))) {
      endBecauseOrder();
    }
  }

  async function start(orderId, calleeRole) {
    await unlockAudio();
    if (session) return toast('กำลังสายอยู่ วางสายก่อน');
    var order = orders[orderId];
    var me = uid();
    if (!order || !me) return toast('ยังโทรไม่ได้');
    if (terminal(order.status)) return toast('ออเดอร์จบแล้ว');
    var myRole = roleOn(order, me);
    var calleeUid = uidFor(order, calleeRole);
    if (!myRole || !calleeUid || calleeUid === me) return toast('ไม่มีคู่สายในออเดอร์นี้');
    if (!useLab() && !db()) return toast('ยังเชื่อมระบบโทรไม่ได้');
    var stream;
    try { stream = await openMic(); }
    catch (err) { return toast(micMessage(err)); }
    delete missed[orderId];
    notifyMissed();
    var fields = {
      orderId: orderId,
      callerUid: me,
      callerRole: myRole,
      calleeUid: calleeUid,
      calleeRole: calleeRole,
      callerName: clip(nameFor(order, myRole)),
      calleeName: clip(nameFor(order, calleeRole)),
      status: 'ringing'
    };
    if (!useLab()) fields.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    var callId = '';
    try { callId = await createCallDoc(orderId, fields); }
    catch (err) {
      stopStream(stream);
      return toast(callErrorMessage(err));
    }
    session = {
      orderId: orderId,
      callId: callId,
      outgoing: true,
      phase: 'outgoing',
      peerName: nameFor(order, calleeRole),
      sub: order.title || 'ออเดอร์',
      stream: stream,
      startedAt: Date.now(),
      muted: false,
      offerSdp: '',
      iceSeen: {},
      iceQueue: []
    };
    try {
      bindCall(orderId, callId);
      watchThisOrder(orderId);
      var pc = attachPc(stream);
      var offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await putOffer(orderId, callId, offer.sdp);
    } catch (err) {
      if (session) session.leaving = true;
      patchCall(orderId, callId, { status: 'cancelled' }).catch(function () {});
      finishLocal('', false);
      return toast(callErrorMessage(err));
    }
    armRingTimeout();
    paintSession();
  }

  async function accept() {
    if (!session || session.phase !== 'incoming') return;
    await unlockAudio();
    stopRingtone();
    var stream;
    try { stream = await openMic(); }
    catch (err) {
      startRingtone();
      return toast(micMessage(err));
    }
    session.stream = stream;
    session.muted = false;
    try {
      var pc = attachPc(stream);
      var sdp = await waitFor(function () { return session && session.offerSdp; }, 8000);
      session.iceBusy = true;
      await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      await flushIce();
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      session.iceBusy = false;
      await flushIce();
      await putAnswer(session.orderId, session.callId, answer.sdp);
      var patch = { status: 'active' };
      if (!useLab()) patch.answeredAt = firebase.firestore.FieldValue.serverTimestamp();
      await patchCall(session.orderId, session.callId, patch);
      session.phase = 'active';
    } catch (err) {
      var failedStatus = session && session.phase === 'active' ? 'ended' : 'declined';
      var failPatch = { status: failedStatus };
      if (failedStatus === 'ended') failPatch.endedBy = uid();
      if (session) session.leaving = true;
      patchCall(session.orderId, session.callId, failPatch).catch(function () {});
      finishLocal('', false);
      return toast(callErrorMessage(err));
    }
    clearRingTimeout();
    session.phase = 'active';
    session.answeredAt = Date.now();
    startDuration();
    paintSession();
    var play = remoteAudio.play();
    if (play && play.catch) play.catch(function () {});
  }

  function decline() {
    if (!session || session.outgoing || session.leaving) return;
    var orderId = session.orderId;
    var callId = session.callId;
    session.leaving = true;
    patchCall(orderId, callId, { status: 'declined' }).catch(function () {});
    finishLocal('', false);
  }

  function hangup() {
    if (!session || session.leaving) return;
    var orderId = session.orderId;
    var callId = session.callId;
    var next = (session.phase === 'active' || session.phase === 'connecting') ? 'ended' : 'cancelled';
    session.leaving = true;
    var fields = { status: next };
    if (next === 'ended') fields.endedBy = uid();
    patchCall(orderId, callId, fields).catch(function () {});
    finishLocal('', false);
  }

  function toggleMute() {
    if (!session || !session.stream) return;
    session.muted = !session.muted;
    session.stream.getAudioTracks().forEach(function (track) { track.enabled = !session.muted; });
    paintSession();
  }

  function dismissMissed(orderId) {
    if (missed[orderId]) {
      delete missed[orderId];
      notifyMissed();
    }
  }

  function reset() {
    if (session && !session.leaving) {
      var orderId = session.orderId;
      var callId = session.callId;
      var next = (session.phase === 'active' || session.phase === 'connecting') ? 'ended' : (session.outgoing ? 'cancelled' : 'missed');
      session.leaving = true;
      patchCall(orderId, callId, { status: next }).catch(function () {});
    }
    finishLocal('', false);
    Object.keys(orderUnsubs).forEach(function (id) {
      try { orderUnsubs[id](); } catch (e) {}
    });
    orderUnsubs = {};
    orders = {};
  }

  function debug() {
    var remoteTracks = 0;
    if (remoteAudio && remoteAudio.srcObject) remoteTracks = remoteAudio.srcObject.getAudioTracks().length;
    return {
      phase: session ? session.phase : '',
      outgoing: !!(session && session.outgoing),
      muted: !!(session && session.muted),
      overlay: !!(root && !root.hidden),
      kicker: (document.getElementById('chauat-call-kicker') || {}).textContent || '',
      name: (document.getElementById('chauat-call-name') || {}).textContent || '',
      remoteTracks: remoteTracks,
      localEnabled: session && session.stream ? session.stream.getAudioTracks().every(function (t) { return t.enabled; }) : null,
      connection: session && session.pc ? session.pc.connectionState : '',
      missed: Object.keys(missed)
    };
  }

  window.ChauatCall = {
    boot: function (opts) {
      opts = opts || {};
      role = opts.role || '';
      getDb = opts.getDb || getDb;
      getUid = opts.getUid || getUid;
      onChange = opts.onChange || onChange;
      ringMs = opts.ringMs || RING_MS_DEFAULT;
      mount();
      bindUnlock();
    },
    watch: watch,
    start: function (orderId, calleeRole) { start(orderId, calleeRole); },
    accept: function () { accept(); },
    decline: decline,
    hangup: hangup,
    toggleMute: toggleMute,
    dismissMissed: dismissMissed,
    buttons: buttons,
    reset: reset,
    debug: debug
  };

  if (window.__CHAUAT_CALL_LAB) {
    var labOpts = window.__CHAUAT_CALL_LAB;
    window.ChauatCall.boot({
      role: labOpts.role,
      getDb: function () { return null; },
      getUid: function () { return labOpts.uid; },
      ringMs: labOpts.ringMs || RING_MS_DEFAULT,
      onChange: function () {
        var box = document.getElementById('lab-actions');
        if (box && labOpts.order) box.innerHTML = window.ChauatCall.buttons(labOpts.order.id);
      }
    });
    if (labOpts.order) window.ChauatCall.watch([labOpts.order]);
    var box = document.getElementById('lab-actions');
    if (box && labOpts.order) box.innerHTML = window.ChauatCall.buttons(labOpts.order.id);
  }
})();
