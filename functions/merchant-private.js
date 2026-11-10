'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// These fields used to live on merchants/{id}, which is world-readable once
// verified == true. The storefront phone stays on the public doc because the
// customer shop page dials it. Everything here is owner/admin only.
const FINANCE_KEYS = [
  'email',
  'gpPending',
  'gpPaid',
  'gpHistory',
  'gpStartDate',
  'gpConsent',
  'soundSettings',
  'notes',
  'internalNote',
  'bankAccount',
  'bankName',
  'promptPay',
  'lastGpTransferAt',
  'lastGpTransferStatus',
  'lastGpTransferId',
  'lastGpTransferReviewedAt'
];

function hasOwn(data, key) {
  return !!data && Object.prototype.hasOwnProperty.call(data, key);
}

function pickFinance(data) {
  const out = {};
  FINANCE_KEYS.forEach((key) => {
    if (hasOwn(data, key)) out[key] = data[key];
  });
  return out;
}

function mergeHistory(publicHistory, privateHistory) {
  const rows = []
    .concat(Array.isArray(publicHistory) ? publicHistory : [])
    .concat(Array.isArray(privateHistory) ? privateHistory : []);
  const byId = new Map();
  const anon = [];
  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    if (row.transferId) byId.set(row.transferId, Object.assign({}, byId.get(row.transferId) || {}, row));
    else anon.push(row);
  });
  return anon.concat(Array.from(byId.values()));
}

// Private values win. History is the union so a sweep cannot drop a transfer
// that was written only on one side.
function mergedFinance(publicData, privateData) {
  const fromPublic = pickFinance(publicData);
  const fromPrivate = pickFinance(privateData);
  const merged = Object.assign({}, fromPublic, fromPrivate);
  if (hasOwn(fromPublic, 'gpHistory') || hasOwn(fromPrivate, 'gpHistory')) {
    merged.gpHistory = mergeHistory(fromPublic.gpHistory, fromPrivate.gpHistory);
  }
  return merged;
}

function privateProfileRef(merchantRef) {
  return merchantRef.collection('private').doc('profile');
}

// Copy leftover finance fields onto the private profile and delete them from
// the public shop document. Returns false when the public doc is already clean.
async function migrateMerchantDoc(docRef, data) {
  const sensitive = pickFinance(data);
  if (!Object.keys(sensitive).length) return false;
  const privRef = privateProfileRef(docRef);
  const privSnap = await privRef.get();
  const merged = mergedFinance(data, privSnap.exists ? privSnap.data() : {});
  await privRef.set(merged, { merge: true });
  const del = {};
  Object.keys(sensitive).forEach((key) => { del[key] = FieldValue.delete(); });
  await docRef.update(del);
  return true;
}

module.exports = {
  FINANCE_KEYS,
  pickFinance,
  mergeHistory,
  mergedFinance,
  privateProfileRef,
  migrateMerchantDoc
};
