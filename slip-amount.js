/* Expected transfer for food and buy-for-me.
   No slip-OCR library is in this repo, and Thai bank slips (K+, SCB Easy)
   are not reliable enough to gate payment on a parse. The customer types
   the amount on the slip. The server charge is transferDue when createOrder
   stored it, otherwise total (net goods + service fee). Goods + fare is
   only the fallback when those fields are missing. Tolerance is ±1 baht. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChauatSlipAmount = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var TOLERANCE = 1;

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function finiteOrNull(value) {
    if (value == null || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function goodsPlusFare(order) {
    var goods = finiteOrNull(order && order.foodTotal);
    if (goods == null) goods = finiteOrNull(order && order.itemsTotal);
    if (goods == null) goods = 0;
    var fare = finiteOrNull(order && order.fare);
    if (fare == null) fare = 0;
    return round2(goods + fare);
  }

  function expectedTransferAmount(order) {
    if (!order) return 0;
    var due = finiteOrNull(order.transferDue);
    if (due == null) due = finiteOrNull(order.total);
    if (due == null) due = goodsPlusFare(order);
    return round2(due);
  }

  function parseSlipAmount(raw) {
    if (raw == null) return null;
    var text = String(raw).replace(/บาท/g, '').replace(/฿/g, '').replace(/,/g, '').replace(/\s/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    var n = round2(text);
    if (!Number.isFinite(n) || n < 0 || n > 1000000) return null;
    return n;
  }

  function slipAmountsMatch(entered, expected) {
    var a = finiteOrNull(entered);
    var b = finiteOrNull(expected);
    if (a == null || b == null) return false;
    return Math.abs(round2(a) - round2(b)) <= TOLERANCE + 1e-9;
  }

  function formatBaht(n) {
    var v = round2(n);
    if (!Number.isFinite(v)) return '0';
    return Math.abs(v % 1) < 1e-9 ? String(Math.round(v)) : v.toFixed(2);
  }

  function slipMismatchText(expected) {
    return 'ยอดสลิปไม่ตรง ต้องโอน ฿' + formatBaht(expected);
  }

  return {
    TOLERANCE: TOLERANCE,
    expectedTransferAmount: expectedTransferAmount,
    parseSlipAmount: parseSlipAmount,
    slipAmountsMatch: slipAmountsMatch,
    formatBaht: formatBaht,
    slipMismatchText: slipMismatchText
  };
});
