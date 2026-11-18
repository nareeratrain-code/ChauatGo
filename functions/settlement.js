'use strict';

const PROMO_DAYS = 60;
const PLATFORM_SHARE = 0.2;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function bangkokParts(ms) {
  const shifted = new Date((Number(ms) || 0) + BANGKOK_OFFSET_MS);
  return {
    key: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours()
  };
}

function addBangkokDays(dateKey, days) {
  const base = Date.parse(String(dateKey || '') + 'T12:00:00+07:00');
  if (!Number.isFinite(base)) return String(dateKey || '');
  return bangkokParts(base + (Number(days) || 0) * DAY_MS).key;
}

// Jobs completed at or after 21:00 belong to the next remittance window.
function riderRemittanceDateKey(job) {
  const when = millisOf(job && (job.deliveredAt || job.doneAt || job.createdAt));
  if (!when) return '';
  const parts = bangkokParts(when);
  return parts.hour >= 21 ? addBangkokDays(parts.key, 1) : parts.key;
}

function gpDueAt(gpStartDate) {
  const start = millisOf(gpStartDate);
  if (!start) return 0;
  return start + PROMO_DAYS * DAY_MS;
}

function shopGpDue(profile, nowMs) {
  const now = Number(nowMs) || Date.now();
  const amount = round2(profile && profile.gpPending);
  const dueAt = gpDueAt(profile && profile.gpStartDate);
  const due = dueAt > 0 && now >= dueAt && amount > 0;
  return { due, amount: due ? amount : 0, dueAt: dueAt || null, overdue: due };
}

// The current remittance window is 21:00–22:00 for the returned dateKey.
// A job completed at/after 21:00 is reported as nextAmount for nextDateKey.
function riderDailyDue(jobs, nowMs) {
  const now = Number(nowMs) || Date.now();
  const today = bangkokParts(now).key;
  const rows = (jobs || []).filter((job) => {
    if (!job || (job.status !== 'done' && job.status !== 'delivered')) return false;
    if (job.riderPaid === true) return false;
    return riderRemittanceDateKey(job) === today;
  });
  const nextDateKey = addBangkokDays(today, 1);
  const nextRows = (jobs || []).filter((job) => {
    if (!job || (job.status !== 'done' && job.status !== 'delivered')) return false;
    if (job.riderPaid === true) return false;
    return riderRemittanceDateKey(job) === nextDateKey;
  });
  const amount = round2(rows.reduce((sum, job) => sum + (Number(job.fare || 0) * PLATFORM_SHARE), 0));
  const nextAmount = round2(nextRows.reduce((sum, job) => sum + (Number(job.fare || 0) * PLATFORM_SHARE), 0));
  return {
    amount,
    jobIds: rows.map((job) => job.id).filter(Boolean),
    dateKey: today,
    nextAmount,
    nextJobIds: nextRows.map((job) => job.id).filter(Boolean),
    nextDateKey,
    cutoff: '21:00',
    overdue: bangkokParts(now).hour >= 21 && amount > 0
  };
}

function settlementChatId(kind, uid) {
  return (kind === 'rider' ? 'rider_' : 'shop_') + String(uid || '');
}

function riderRemittanceId(riderId, dateKey) {
  return 'rider_' + String(riderId || '') + '_' + String(dateKey || '');
}

function publicPayout(doc) {
  const data = doc || {};
  return {
    accountName: String(data.accountName || ''),
    accountNumber: String(data.accountNumber || ''),
    bankName: String(data.bankName || ''),
    promptPay: String(data.promptPay || ''),
    qrUrl: String(data.qrUrl || '')
  };
}

function riderReviewPlan(remittance, jobs, action) {
  const status = String(remittance && remittance.status || 'pending');
  if (status === 'verified') {
    if (action === 'verify') return { already: true, status, jobIds: [] };
    const err = new Error('สลิปนี้อนุมัติแล้ว ไม่สามารถปฏิเสธได้');
    err.code = 'failed-precondition';
    throw err;
  }
  if (status === 'rejected') {
    if (action === 'reject') return { already: true, status, jobIds: [] };
    const err = new Error('สลิปนี้ถูกปฏิเสธแล้ว ไม่สามารถอนุมัติได้');
    err.code = 'failed-precondition';
    throw err;
  }
  if (status !== 'pending') {
    const err = new Error('สถานะสลิปไม่ถูกต้อง');
    err.code = 'failed-precondition';
    throw err;
  }
  if (action === 'reject') return { already: false, status: 'rejected', jobIds: [] };
  const dateKey = String(remittance.dateKey || '');
  const due = riderDailyDue((jobs || []).map((job) => {
    const when = millisOf(job.deliveredAt || job.doneAt || job.createdAt);
    if (!when || riderRemittanceDateKey(job) !== dateKey) return null;
    return job;
  }).filter(Boolean), Date.parse(dateKey + 'T12:00:00+07:00'));
  const submittedAmount = round2(remittance.amount);
  if (due.amount <= 0 || submittedAmount < due.amount) {
    const err = new Error('ยอดสลิปน้อยกว่ายอดที่ต้องโอนวันนี้');
    err.code = 'failed-precondition';
    throw err;
  }
  return {
    already: false,
    status: 'verified',
    jobIds: due.jobIds,
    dueAmount: due.amount,
    overpaidAmount: round2(submittedAmount - due.amount)
  };
}

module.exports = {
  PROMO_DAYS,
  PLATFORM_SHARE,
  bangkokParts,
  gpDueAt,
  shopGpDue,
  riderDailyDue,
  settlementChatId,
  riderRemittanceId,
  riderRemittanceDateKey,
  publicPayout,
  riderReviewPlan
};
