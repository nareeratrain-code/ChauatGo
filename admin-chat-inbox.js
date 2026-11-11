'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChauatChatInbox = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const ROLES = [
    { id: 'customer', label: 'ลูกค้า' },
    { id: 'rider', label: 'ไรเดอร์' },
    { id: 'shop', label: 'ร้าน' }
  ];
  const BANGKOK_MS = 7 * 60 * 60 * 1000;

  function asDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function dayKey(value) {
    const date = asDate(value);
    if (!date) return '';
    return new Date(date.getTime() + BANGKOK_MS).toISOString().slice(0, 10);
  }

  function dayLabel(key) {
    if (!key) return 'ไม่ทราบวัน';
    const parts = key.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !n)) return key;
    return new Intl.DateTimeFormat('th-TH', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
  }

  function formatTime(value) {
    const date = asDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Bangkok'
    }).format(date);
  }

  function isShopThread(chat) {
    if (!chat || chat.source === 'settlement') return false;
    return chat.thread === 'shop' || String(chat.id || '').endsWith('__shop');
  }

  function orderIdOf(chat) {
    if (chat && chat.orderId) return String(chat.orderId);
    const id = String((chat && chat.id) || '');
    return id.endsWith('__shop') ? id.slice(0, -6) : id;
  }

  function shortOrderId(chat, orders) {
    const oid = orderIdOf(chat);
    const found = (orders || []).find((order) => order && order.id === oid);
    const code = found && String(found.code || '').trim();
    if (code) return code;
    return oid.slice(-6);
  }

  function previewOf(chat) {
    return String((chat && (chat.lastMessage || chat.text)) || '').trim();
  }

  function momentOf(chat) {
    return asDate(chat && (chat.lastMessageAt || chat.updatedAt || chat.createdAt));
  }

  function settlementKind(chat) {
    const kind = String((chat && chat.kind) || '');
    if (kind === 'rider' || kind === 'shop') return kind;
    return String((chat && chat.id) || '').startsWith('rider_') ? 'rider' : 'shop';
  }

  function threadFromOrder(chat, orders) {
    const shop = isShopThread(chat);
    const at = momentOf(chat);
    const code = shortOrderId(chat, orders);
    return {
      id: String(chat.id || ''),
      source: 'order',
      kind: shop ? 'shop' : 'rider',
      orderId: orderIdOf(chat),
      shortId: code,
      title: code + (shop ? ' • ร้าน' : ' • ไรเดอร์'),
      preview: previewOf(chat),
      at: at,
      dayKey: dayKey(at)
    };
  }

  function threadFromSettlement(chat) {
    const kind = settlementKind(chat);
    const at = momentOf(chat);
    return {
      id: String(chat.id || ''),
      source: 'settlement',
      kind: 'settlement',
      orderId: '',
      shortId: '',
      title: kind === 'rider' ? 'ชำระเงิน • ต้องโอน' : 'ชำระเงิน • GP',
      preview: previewOf(chat),
      at: at,
      dayKey: dayKey(at)
    };
  }

  function named(role, id, fallback, names) {
    const table = names && (role === 'customer' ? names.users : role === 'rider' ? names.riders : names.merchants);
    const stored = table && table[id];
    const name = String(fallback || stored || '').trim();
    if (name) return name;
    return role === 'customer' ? 'ลูกค้า' : role === 'rider' ? 'ไรเดอร์' : 'ร้าน';
  }

  function ensurePerson(bucket, role, id, name) {
    const key = role + ':' + id;
    if (!bucket.has(key)) {
      bucket.set(key, { key: key, role: role, id: id, name: name, threads: [] });
    }
    const person = bucket.get(key);
    if (name && name !== 'ลูกค้า' && name !== 'ไรเดอร์' && name !== 'ร้าน') person.name = name;
    return person;
  }

  function pushThread(person, thread) {
    if (!thread.id) return;
    if (person.threads.some((item) => item.source === thread.source && item.id === thread.id)) return;
    person.threads.push(thread);
  }

  function byNewest(a, b) {
    const am = a.at ? a.at.getTime() : 0;
    const bm = b.at ? b.at.getTime() : 0;
    if (bm !== am) return bm - am;
    return String(a.id || a.key || '').localeCompare(String(b.id || b.key || ''));
  }

  function packPerson(person) {
    const threads = person.threads.slice().sort(byNewest);
    const days = [];
    const index = new Map();
    threads.forEach((thread) => {
      const key = thread.dayKey || '';
      if (!index.has(key)) {
        const day = { key: key, label: dayLabel(key), threads: [] };
        index.set(key, day);
        days.push(day);
      }
      index.get(key).threads.push(thread);
    });
    days.sort((a, b) => {
      if (!a.key) return 1;
      if (!b.key) return -1;
      return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
    });
    const latest = threads[0] || null;
    return {
      key: person.key,
      role: person.role,
      id: person.id,
      name: person.name,
      preview: latest ? latest.preview : '',
      at: latest ? latest.at : null,
      days: days
    };
  }

  function groupInbox(chats, settlements, options) {
    const names = (options && options.names) || {};
    const orders = (options && options.orders) || [];
    const bucket = new Map();
    (Array.isArray(chats) ? chats : []).forEach((chat) => {
      if (!chat || chat.source === 'settlement') return;
      const thread = threadFromOrder(chat, orders);
      const userId = String(chat.userId || '');
      if (userId) {
        pushThread(ensurePerson(bucket, 'customer', userId, named('customer', userId, chat.userName, names)), thread);
      }
      if (isShopThread(chat)) {
        const shopId = String(chat.merchantId || '');
        if (shopId) {
          pushThread(ensurePerson(bucket, 'shop', shopId, named('shop', shopId, chat.merchantName, names)), thread);
        }
      } else {
        const riderId = String(chat.riderId || '');
        if (riderId) {
          pushThread(ensurePerson(bucket, 'rider', riderId, named('rider', riderId, chat.riderName, names)), thread);
        }
      }
    });
    (Array.isArray(settlements) ? settlements : []).forEach((chat) => {
      if (!chat) return;
      const kind = settlementKind(chat);
      const partyId = String(chat.partyId || String(chat.id || '').replace(/^(shop_|rider_)/, ''));
      if (!partyId) return;
      const role = kind === 'rider' ? 'rider' : 'shop';
      const person = ensurePerson(bucket, role, partyId, named(role, partyId, chat.partyName, names));
      pushThread(person, threadFromSettlement(chat));
    });
    const grouped = { customer: [], rider: [], shop: [], byKey: {} };
    bucket.forEach((person) => {
      const packed = packPerson(person);
      grouped[packed.role].push(packed);
      grouped.byKey[packed.key] = packed;
    });
    ROLES.forEach((role) => grouped[role.id].sort(byNewest));
    return grouped;
  }

  function roleLabel(role) {
    const found = ROLES.find((item) => item.id === role);
    return found ? found.label : '';
  }

  function renderPeople(inbox, role) {
    const selected = ROLES.some((item) => item.id === role) ? role : 'customer';
    const chips = ROLES.map((item) => {
      const count = (inbox && inbox[item.id] ? inbox[item.id] : []).length;
      return `<button type="button" class="status-filter${item.id === selected ? ' on' : ''}" data-chat-role="${item.id}">${esc(item.label)} ${count}</button>`;
    }).join('');
    const people = (inbox && inbox[selected]) || [];
    const rows = people.length ? people.map((person) => `<button type="button" class="chat-person" data-chat-person="${esc(person.key)}">
      <div class="chat-person-top">
        <div class="chat-person-name">${esc(person.name)}</div>
        <span class="status-chip">${esc(roleLabel(person.role))}</span>
        <time>${esc(formatTime(person.at))}</time>
      </div>
      <div class="chat-person-preview">${esc(person.preview || 'ยังไม่มีข้อความ')}</div>
    </button>`).join('') : '<div class="empty"><div class="icon">💬</div><div>ยังไม่มีการสนทนา</div></div>';
    return `<div class="chat-role-bar">${chips}</div>${rows}`;
  }

  function renderPerson(person) {
    if (!person) {
      return `<button type="button" class="chat-back" data-chat-back="1">← รายชื่อ</button><div class="empty"><div>ไม่พบรายชื่อนี้</div></div>`;
    }
    const days = (person.days || []).map((day) => {
      const threads = day.threads.map((thread) => `<button type="button" class="chat-thread${thread.source === 'settlement' ? ' settle' : ''}" data-open-chat="${esc(thread.id)}" data-chat-source="${esc(thread.source)}">
        <div class="chat-thread-top"><b>${esc(thread.title)}</b><time>${esc(formatTime(thread.at))}</time></div>
        <div class="chat-person-preview">${esc(thread.preview || 'ยังไม่มีข้อความ')}</div>
      </button>`).join('');
      return `<section class="chat-day"><h3>${esc(day.label)}</h3>${threads}</section>`;
    }).join('');
    return `<button type="button" class="chat-back" data-chat-back="1">← รายชื่อ</button>
      <div class="chat-person-head"><div class="chat-person-name">${esc(person.name)}</div><span class="status-chip">${esc(roleLabel(person.role))}</span></div>
      ${days || '<div class="empty"><div>ยังไม่มีบทสนทนา</div></div>'}`;
  }

  return {
    ROLES: ROLES,
    dayKey: dayKey,
    dayLabel: dayLabel,
    formatTime: formatTime,
    groupInbox: groupInbox,
    renderPeople: renderPeople,
    renderPerson: renderPerson,
    roleLabel: roleLabel
  };
});
