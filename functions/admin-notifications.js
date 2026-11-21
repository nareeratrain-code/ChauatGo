'use strict';

const { getMessaging } = require('firebase-admin/messaging');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

const MAX_TOKENS_PER_MESSAGE = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

function tokenFingerprint(token) {
  return crypto.createHash('sha256')
    .update(String(token || ''))
    .digest('hex')
    .slice(0, 12);
}

function log(level, event, fields = {}) {
  const payload = JSON.stringify({
    component: 'admin-fcm',
    event,
    timestamp: new Date().toISOString(),
    ...fields
  });
  if (level === 'error') return console.error(payload);
  if (level === 'warn') return console.warn(payload);
  return console.log(payload);
}

function uniqueTokens(values) {
  return [...new Set((values || [])
    .filter((token) => typeof token === 'string' && token.trim())
    .map((token) => token.trim()))];
}

async function loadAdminTokenSources(db) {
  const [adminRoleSnap, userRoleSnap] = await Promise.all([
    db.collection('admins').where('role', 'in', ['active', 'super']).get(),
    db.collection('users').where('role', '==', 'admin').get()
  ]);

  const sources = new Map();
  for (const doc of adminRoleSnap.docs) {
    sources.set(`admins/${doc.id}`, doc);
  }
  for (const doc of userRoleSnap.docs) {
    sources.set(`users/${doc.id}`, doc);
  }
  return [...sources.values()];
}

async function removeInvalidTokens(sources, invalidTokens, db) {
  if (!invalidTokens.length) return;

  const invalid = new Set(invalidTokens);
  await Promise.all(sources.map(async (source) => {
    const tokens = Array.isArray(source.data().fcmTokens)
      ? source.data().fcmTokens
      : [];
    const owned = tokens.filter((token) => invalid.has(token));
    if (!owned.length) return;

    await source.ref.update({
      fcmTokens: FieldValue.arrayRemove(...owned),
      fcmTokenUpdatedAt: FieldValue.serverTimestamp()
    });
  }));
}

async function notifyAdminsOfRemittance(db, remittance, options = {}) {
  const sources = await loadAdminTokenSources(db);
  const tokenOwners = new Map();

  for (const source of sources) {
    const tokens = Array.isArray(source.data().fcmTokens)
      ? source.data().fcmTokens
      : [];
    for (const token of uniqueTokens(tokens)) {
      if (!tokenOwners.has(token)) tokenOwners.set(token, []);
      tokenOwners.get(token).push(source);
    }
  }

  const tokens = [...tokenOwners.keys()];
  if (!tokens.length) {
    log('warn', 'no_admin_tokens', {
      remittanceId: String(remittance.remittanceId || ''),
      sourceCount: sources.length
    });
    return { ok: false, status: 'no_tokens', successCount: 0, failureCount: 0 };
  }

  const message = {
    notification: {
      title: 'มีสลิปไรเดอร์รอตรวจสอบ',
      body: `${String(remittance.riderName || remittance.riderId || 'ไรเดอร์')} ส่งสลิปยอด ${Number(remittance.amountSubmitted || remittance.amount || 0).toFixed(2)} บาท`
    },
    data: {
      kind: 'rider_remittance_submitted',
      remittanceId: String(remittance.remittanceId || ''),
      riderId: String(remittance.riderId || ''),
      dateKey: String(remittance.dateKey || ''),
      status: 'pending',
      clickAction: '/admin.html?view=remittance'
    },
    webpush: {
      fcmOptions: { link: '/admin.html?view=remittance' },
      notification: { icon: '/icons/icon-512.png' }
    }
  };

  const messaging = options.messaging || getMessaging();
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const failureCodes = {};

  for (let offset = 0; offset < tokens.length; offset += MAX_TOKENS_PER_MESSAGE) {
    const batch = tokens.slice(offset, offset + MAX_TOKENS_PER_MESSAGE);
    const result = await messaging.sendEachForMulticast({
      tokens: batch,
      ...message
    });

    successCount += Number(result.successCount || 0);
    failureCount += Number(result.failureCount || 0);

    result.responses.forEach((response, index) => {
      if (response.success) return;
      const code = response.error?.code || 'unknown';
      failureCodes[code] = (failureCodes[code] || 0) + 1;
      if (INVALID_TOKEN_CODES.has(code)) invalidTokens.push(batch[index]);
    });
  }

  await removeInvalidTokens(sources, invalidTokens, db);

  const status = failureCount === 0
    ? 'sent'
    : successCount > 0
      ? 'partial_failure'
      : 'failed';

  log(status === 'sent' ? 'info' : 'warn', 'remittance_admin_notification', {
    remittanceId: String(remittance.remittanceId || ''),
    tokenCount: tokens.length,
    successCount,
    failureCount,
    invalidTokenCount: invalidTokens.length,
    failureCodes,
    tokenFingerprints: invalidTokens.map(tokenFingerprint)
  });

  return {
    ok: status === 'sent',
    status,
    tokenCount: tokens.length,
    successCount,
    failureCount,
    invalidTokenCount: invalidTokens.length
  };
}

function shouldNotifyFinalizedRemittance(result) {
  return !!result && result.alreadyFinalized === false;
}

module.exports = {
  notifyAdminsOfRemittance,
  shouldNotifyFinalizedRemittance,
  loadAdminTokenSources
};
