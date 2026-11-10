'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const FINISHED = ['done', 'delivered', 'cancelled', 'shop_closed'];

function thaiInitial(token) {
  const chars = Array.from(String(token || ''));
  return chars.find((ch) => /[ก-ฮ]/.test(ch)) || chars[0] || '';
}

function maskThaiName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts.slice(0, -1).join(' ') + ' ' + thaiInitial(parts[parts.length - 1]) + '.';
}

// Pickup may be a district or subdistrict. A free-text address with a house
// number is not copied into the rider history.
function coarseArea(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const district = raw.match(/(?:อำเภอ|อ\.)\s*([ก-๙A-Za-z.\-]+)/);
  if (district) return 'อ.' + district[1];
  const tambon = raw.match(/(?:ตำบล|ต\.)\s*([ก-๙A-Za-z.\-]+)/);
  if (tambon) return 'ต.' + tambon[1];
  if (!/\d/.test(raw) && raw.length <= 40) return raw;
  return '';
}

// Drop-off is district only. A subdistrict or street is not kept.
function districtOnly(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const district = raw.match(/(?:อำเภอ|อ\.)\s*([ก-๙A-Za-z.\-]+)/);
  return district ? 'อ.' + district[1] : '';
}

function historySummary(orderId, after) {
  return {
    orderId: orderId,
    shortId: String(after.code || orderId).slice(-6),
    completedAt: after.doneAt || after.deliveredAt || after.cancelledAt || after.shopClosedAt || new Date(),
    type: after.type || '',
    pickupLabel: after.shopPlaceName || after.merchantName || coarseArea(after.from) || 'จุดรับ',
    dropoffArea: districtOnly(after.to || after.address) || 'พื้นที่ปลายทาง',
    distanceKm: Number(after.distanceKm) || 0,
    fare: Number(after.fare) || 0,
    cashTip: after.paymentMode === 'cash' ? Number(after.cashTip || 0) : 0,
    riderIncome: Number(after.riderIncome) || 0,
    riderOwe: Number(after.riderOwe) || 0,
    paymentMode: after.paymentMode || '',
    status: after.status,
    safe: true
  };
}

async function syncRiderHistory(db, orderId, after) {
  if (!after || !after.riderId || FINISHED.indexOf(after.status) === -1) return false;
  const summary = historySummary(orderId, after);
  await db.collection('riders').doc(after.riderId).collection('jobHistory').doc(orderId).set(summary, { merge: true });
  if (after.piiRedacted === true) return true;
  const masked = maskThaiName(after.riderName);
  const patch = { piiRedacted: true };
  if (after.riderPhone) patch.riderPhone = FieldValue.delete();
  if (masked && masked !== after.riderName) patch.riderName = masked;
  await db.collection('orders').doc(orderId).collection('private').doc('contacts').set({
    riderName: after.riderName || '',
    riderPhone: after.riderPhone || '',
    userName: after.userName || '',
    userPhone: after.userPhone || ''
  }, { merge: true });
  await db.collection('orders').doc(orderId).update(patch);
  return true;
}

module.exports = {
  FINISHED,
  maskThaiName,
  coarseArea,
  districtOnly,
  historySummary,
  syncRiderHistory
};
