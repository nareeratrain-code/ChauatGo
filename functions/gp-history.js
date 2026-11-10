'use strict';

// Merchant documents are readable by anyone once verified == true.
// GP slip URLs are download tokens. Keep them on gp_transfers, which only
// the shop and an admin can read, and never copy them onto the merchant doc.
function merchantHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const copy = Object.assign({}, entry);
  delete copy.slipUrl;
  delete copy.slipPath;
  return copy;
}

module.exports = { merchantHistoryEntry };
