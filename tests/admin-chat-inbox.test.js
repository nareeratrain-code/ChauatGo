'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const inbox = require('../admin-chat-inbox');

const root = path.resolve(__dirname, '..');
const adminJs = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'admin.css'), 'utf8');

function at(iso) {
  return new Date(iso);
}

const orders = [
  { id: 'ord-a', code: 'OD-1101' },
  { id: 'ord-b', code: 'OD-1102' },
  { id: 'ord-c', code: 'OD-1108' }
];

const chats = [
  {
    id: 'ord-a', thread: 'rider', orderId: 'ord-a', userId: 'cust-kong', userName: 'เฮียกง',
    riderId: 'rider-som', riderName: 'สมหมาย', merchantId: 'shop-lao', merchantName: 'เหล่าเต๋งชะอวด',
    lastMessage: 'ถึงแล้ว', lastMessageAt: at('2026-11-11T14:02:00+07:00')
  },
  {
    id: 'ord-a__shop', thread: 'shop', orderId: 'ord-a', userId: 'cust-kong', userName: 'เฮียกง',
    riderId: '', riderName: 'สมหมาย', merchantId: 'shop-lao', merchantName: 'เหล่าเต๋งชะอวด',
    lastMessage: 'ของพร้อม', lastMessageAt: at('2026-11-11T13:10:00+07:00')
  },
  {
    id: 'ord-b', thread: 'rider', orderId: 'ord-b', userId: 'cust-kong', userName: 'เฮียกง',
    riderId: 'rider-som', riderName: 'สมหมาย', merchantId: 'shop-lao', merchantName: 'เหล่าเต๋งชะอวด',
    lastMessage: 'กำลังไป', lastMessageAt: at('2026-11-10T18:40:00+07:00')
  },
  {
    id: 'ord-c', thread: 'rider', orderId: 'ord-c', userId: 'cust-other', userName: 'สมหญิง',
    riderId: 'rider-som', riderName: 'สมหมาย', merchantId: 'shop-lao', merchantName: 'เหล่าเต๋งชะอวด',
    lastMessage: 'รับงาน', lastMessageAt: at('2026-11-11T09:00:00+07:00')
  }
];

const settlements = [
  {
    id: 'shop_shop-lao', kind: 'shop', partyId: 'shop-lao', partyName: 'เหล่าเต๋งชะอวด',
    lastMessage: 'GP ครบกำหนด', lastMessageAt: at('2026-11-11T08:00:00+07:00')
  },
  {
    id: 'rider_rider-som', kind: 'rider', partyId: 'rider-som', partyName: 'สมหมาย',
    lastMessage: 'โอนแล้ว', lastMessageAt: at('2026-11-11T21:05:00+07:00')
  }
];

function grouped() {
  return inbox.groupInbox(chats, settlements, { orders: orders });
}

test('the people list is one row per person, split by role', () => {
  const box = grouped();
  assert.deepEqual(box.customer.map((person) => person.name), ['เฮียกง', 'สมหญิง']);
  assert.deepEqual(box.rider.map((person) => person.name), ['สมหมาย']);
  assert.deepEqual(box.shop.map((person) => person.name), ['เหล่าเต๋งชะอวด']);
  assert.equal(box.customer[0].threads ? undefined : box.customer[0].days.length > 0, true);
  const html = inbox.renderPeople(box, 'customer');
  assert.equal(html.split('data-chat-person="customer:cust-kong"').length - 1, 1);
  assert.equal(html.includes('data-chat-person="customer:cust-other"'), true);
  assert.equal(html.includes('สมหมาย'), false);
  assert.match(html, /data-chat-role="customer"/);
  assert.match(html, /data-chat-role="rider"/);
  assert.match(html, /data-chat-role="shop"/);
});

test('a person page groups that person\'s chats by day, newest day first', () => {
  const kong = grouped().byKey['customer:cust-kong'];
  assert.deepEqual(kong.days.map((day) => day.key), ['2026-11-11', '2026-11-10']);
  assert.deepEqual(kong.days[0].threads.map((thread) => thread.id), ['ord-a', 'ord-a__shop']);
  assert.deepEqual(kong.days[1].threads.map((thread) => thread.id), ['ord-b']);
  const html = inbox.renderPerson(kong);
  assert.match(html, /OD-1101 • ไรเดอร์/);
  assert.match(html, /OD-1101 • ร้าน/);
  assert.equal(html.indexOf('2026-11-11') === -1, true);
  assert.ok(html.indexOf(inbox.dayLabel('2026-11-11')) < html.indexOf(inbox.dayLabel('2026-11-10')));
  assert.match(html, /data-chat-back="1"/);
});

test('shop and rider threads stay apart, and settlement stays on the payer', () => {
  const box = grouped();
  const riderThreads = box.byKey['rider:rider-som'].days.flatMap((day) => day.threads);
  const shopThreads = box.byKey['shop:shop-lao'].days.flatMap((day) => day.threads);
  const customerThreads = box.byKey['customer:cust-kong'].days.flatMap((day) => day.threads);
  assert.equal(riderThreads.some((thread) => thread.id === 'ord-a__shop'), false);
  assert.equal(shopThreads.some((thread) => thread.kind === 'rider'), false);
  assert.equal(customerThreads.some((thread) => thread.source === 'settlement'), false);
  assert.equal(riderThreads.some((thread) => thread.title === 'ชำระเงิน • ต้องโอน'), true);
  assert.equal(shopThreads.some((thread) => thread.title === 'ชำระเงิน • GP'), true);
  assert.equal(inbox.renderPerson(box.byKey['shop:shop-lao']).includes('ชำระเงิน • GP'), true);
  assert.equal(inbox.renderPerson(box.byKey['rider:rider-som']).includes('ชำระเงิน • ต้องโอน'), true);
  assert.equal(inbox.renderPerson(box.byKey['customer:cust-kong']).includes('ชำระเงิน'), false);
  const ids = riderThreads.map((thread) => thread.source + ':' + thread.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('admin chat inbox is wired in the client and the theme control sits in the header', () => {
  assert.match(adminHtml, /admin-chat-inbox\.js/);
  const header = adminHtml.slice(adminHtml.indexOf('<header class="app-header">'), adminHtml.indexOf('</header>'));
  assert.match(header, /id="theme-fab"/);
  assert.equal(adminHtml.includes('class="theme-fab"'), false);
  assert.match(adminCss, /\.app-header #theme-fab[\s\S]*position:\s*static/);
  assert.match(adminJs, /ChauatChatInbox/);
  assert.match(adminJs, /settlement_chats/);
  assert.equal(fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8').includes('match /settlement_chats/{chatId}'), true);
});
