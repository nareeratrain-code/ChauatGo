#!/usr/bin/env node
'use strict';

/**
 * Safely trigger onCustomerSlipUploaded in Firebase Production.
 *
 * Default: dry-run. A real write requires both --send and
 * --confirm-production, plus --rider-uid.
 *
 * Usage:
 *   node tools/test-production-fcm-event.js --rider-uid RIDER_UID
 *   node tools/test-production-fcm-event.js --rider-uid RIDER_UID --send --confirm-production
 *   node tools/test-production-fcm-event.js --order-id ORDER_ID --cleanup --confirm-production
 *
 * Authentication: Firebase Admin Application Default Credentials, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON file.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'chauat-go-b9841';
const TEST_PREFIX = 'qa-fcm-production-';

function usage(exitCode = 0) {
  console.log(`
ChauatGo Production FCM Test Event

Options:
  --rider-uid UID          Assigned Rider UID to test (required for --send)
  --order-id ID            Existing test Order ID (required for --cleanup)
  --send                   Create a test Order and trigger the Firestore event
  --cleanup                Delete a test Order created by this script
  --confirm-production     Required for any Production write/delete
  --project ID             Firebase project (default: ${PROJECT_ID})
  --help                   Show this help

Examples:
  # Safe inspection only; no Production write
  node tools/test-production-fcm-event.js --rider-uid RIDER_UID

  # Create the event in Production
  node tools/test-production-fcm-event.js \\
    --rider-uid RIDER_UID --send --confirm-production

  # Remove the test Order after checking the device
  node tools/test-production-fcm-event.js \\
    --order-id ORDER_ID --cleanup --confirm-production
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { send: false, cleanup: false, confirm: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send') out.send = true;
    else if (arg === '--cleanup') out.cleanup = true;
    else if (arg === '--confirm-production') out.confirm = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--rider-uid') out.riderUid = argv[++i];
    else if (arg === '--order-id') out.orderId = argv[++i];
    else if (arg === '--project') out.project = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function maskToken(token) {
  const value = String(token || '');
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-6)}` : '(short token)';
}

function requireConfirmation(args) {
  if (!args.confirm) {
    throw new Error('Production write blocked. Add --confirm-production explicitly.');
  }
}

function initAdmin(projectId) {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  return admin.firestore();
}

async function inspectRider(db, riderUid) {
  const snap = await db.collection('riders').doc(riderUid).get();
  if (!snap.exists) throw new Error(`Rider document not found: riders/${riderUid}`);
  const rider = snap.data() || {};
  const tokens = Array.isArray(rider.fcmTokens) ? rider.fcmTokens.filter(Boolean) : [];
  console.log(JSON.stringify({
    riderUid,
    riderName: rider.name || null,
    verified: rider.verified === true,
    status: rider.status || null,
    fcmTokenCount: tokens.length,
    maskedTokens: tokens.slice(0, 3).map(maskToken)
  }, null, 2));
  if (!tokens.length) {
    throw new Error('Rider has no fcmTokens. Open Rider Production, grant notifications, and enable push first.');
  }
  return tokens;
}

function newOrderId() {
  return `${TEST_PREFIX}${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

async function sendTestEvent(db, riderUid) {
  const orderId = newOrderId();
  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();
  await orderRef.set({
    type: 'express',
    title: 'QA • FCM Production Test',
    userId: `qa-fcm-sender-${crypto.randomBytes(4).toString('hex')}`,
    riderId: riderUid,
    status: 'picked_up',
    paymentMode: 'transfer',
    total: 1,
    fare: 1,
    customerSlipUrl: '',
    customerSlipPath: '',
    customerSlipUploadedAt: null,
    testEvent: true,
    createdAt: now,
    updatedAt: now
  });
  const slipUrl = `https://qa.invalid/chauatgo-fcm-test/${orderId}.png`;
  await orderRef.update({
    customerSlipUrl: slipUrl,
    customerSlipPath: `qa-fcm-production/${orderId}.png`,
    customerSlipUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { orderId, slipUrl };
}

async function cleanupTestEvent(db, orderId) {
  if (!orderId.startsWith(TEST_PREFIX)) {
    throw new Error(`Refusing to delete non-test Order. ID must start with ${TEST_PREFIX}`);
  }
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`Already absent: orders/${orderId}`);
    return;
  }
  const data = snap.data() || {};
  if (data.testEvent !== true) {
    throw new Error('Refusing to delete an Order without testEvent:true.');
  }
  await ref.delete();
  console.log(`Deleted test Order: orders/${orderId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);
  const projectId = args.project || PROJECT_ID;
  if (projectId !== PROJECT_ID && process.env.ALLOW_NON_DEFAULT_PROJECT !== 'true') {
    throw new Error(`Project override blocked. Set ALLOW_NON_DEFAULT_PROJECT=true to use ${projectId}.`);
  }
  if ((args.send && args.cleanup) || (!args.send && !args.cleanup)) {
    throw new Error('Choose exactly one action: --send or --cleanup.');
  }
  if (args.send && !args.riderUid) throw new Error('--rider-uid is required with --send.');
  if (args.cleanup && !args.orderId) throw new Error('--order-id is required with --cleanup.');

  console.log(`Target Firebase project: ${projectId}`);
  if (args.send) {
    if (!args.confirm) {
      console.log('DRY RUN: no Production data was written.');
      console.log('Would inspect riders/' + args.riderUid + ' and create a test Order that adds customerSlipUrl.');
      return;
    }
    requireConfirmation(args);
    const db = initAdmin(projectId);
    const tokens = await inspectRider(db, args.riderUid);
    const result = await sendTestEvent(db, args.riderUid);
    console.log(JSON.stringify({
      action: 'production-event-sent',
      projectId,
      orderId: result.orderId,
      riderUid: args.riderUid,
      fcmTokenCountAtSend: tokens.length,
      trigger: 'onCustomerSlipUploaded',
      note: 'Wait for the Rider device notification, then inspect Cloud Function logs before cleanup.'
    }, null, 2));
    return;
  }

  requireConfirmation(args);
  const db = initAdmin(projectId);
  await cleanupTestEvent(db, args.orderId);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
