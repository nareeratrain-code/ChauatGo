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

  return { asDate, payoutSearchText, filterPayouts };
});
