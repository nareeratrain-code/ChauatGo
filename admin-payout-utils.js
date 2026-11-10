'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChauatPayoutAuditUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function asDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function payoutSearchText(payout, riderNames = {}) {
    return [
      payout.id, payout.payoutId, payout.payoutKey, payout.riderId,
      riderNames[payout.riderId], payout.note, payout.roundLabel,
      ...(Array.isArray(payout.orderIds) ? payout.orderIds : [])
    ].map(normalize).join(' ');
  }

  function filterPayouts(payouts, options = {}) {
    const query = normalize(options.query);
    const status = normalize(options.status || 'all');
    const riderId = String(options.riderId || '');
    const from = options.from ? new Date(`${options.from}T00:00:00`) : null;
    const to = options.to ? new Date(`${options.to}T23:59:59.999`) : null;
    const riderNames = options.riderNames || {};

    return (Array.isArray(payouts) ? payouts : []).filter(payout => {
      if (status !== 'all' && normalize(payout.status) !== status) return false;
      if (riderId && String(payout.riderId || '') !== riderId) return false;
      const date = asDate(payout.paidAt || payout.createdAt);
      if (from && (!date || date < from)) return false;
      if (to && (!date || date > to)) return false;
      return !query || payoutSearchText(payout, riderNames).includes(query);
    }).sort((a, b) => {
      const aTime = asDate(a.paidAt || a.createdAt)?.getTime() || 0;
      const bTime = asDate(b.paidAt || b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
  }

  function localDayKey(value) {
    const date = asDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function summarizeDailyFinance(orders, payouts, options = {}) {
    const dateKey = String(options.date || localDayKey(new Date()));
    const getOrderValues = typeof options.getOrderValues === 'function'
      ? options.getOrderValues : () => ({ platformGp: 0, storeGp: 0, riderPayout: 0 });
    const completed = (Array.isArray(orders) ? orders : []).filter(order =>
      ['done', 'delivered'].includes(order?.status) && localDayKey(order?.createdAt) === dateKey
    );
    const totals = completed.reduce((sum, order) => {
      const values = getOrderValues(order) || {};
      sum.platformGp += Number(values.platformGp || 0);
      sum.storeGp += Number(values.storeGp || 0);
      sum.riderPayout += Number(values.riderPayout || 0);
      sum.fare += Number(values.fare || 0);
      sum.food += Number(values.food || 0);
      if (order.riderPayoutPaid !== true && Number(values.riderPayout || 0) > 0) {
        sum.unpaidRiderPayout += Number(values.riderPayout || 0);
      }
      return sum;
    }, { platformGp: 0, storeGp: 0, riderPayout: 0, unpaidRiderPayout: 0, fare: 0, food: 0 });
    const dayPayouts = (Array.isArray(payouts) ? payouts : []).filter(p => localDayKey(p?.paidAt || p?.createdAt) === dateKey);
    const paidPayouts = dayPayouts.filter(p => p?.status === 'paid');
    const pendingPayouts = dayPayouts.filter(p => !['paid', 'cancelled'].includes(p?.status));
    return {
      date: dateKey, orderCount: completed.length,
      platformGp: totals.platformGp, storeGp: totals.storeGp,
      totalGp: totals.platformGp + totals.storeGp,
      fare: totals.fare, food: totals.food,
      expectedRiderPayout: totals.riderPayout,
      unpaidRiderPayout: totals.unpaidRiderPayout,
      paidPayout: paidPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      paidPayoutCount: paidPayouts.length,
      pendingPayout: pendingPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      pendingPayoutCount: pendingPayouts.length, payoutCount: dayPayouts.length
    };
  }

  return { asDate, localDayKey, payoutSearchText, filterPayouts, summarizeDailyFinance };
});
