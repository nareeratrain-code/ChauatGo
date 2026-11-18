'use strict';

/*
 * Integration probe for Firebase Functions v2 native App Check enforcement.
 *
 * This script intentionally uses HTTP instead of the Firebase Functions SDK so
 * it can observe the platform response (including a 401/403 with no callable
 * body/CORS headers) that a browser would receive.
 *
 * Important: the Functions Emulator may not reproduce production's platform-
 * level App Check rejection. In that case the script reports
 * NATIVE_APPCHECK_UNOBSERVABLE instead of treating a handler-level response as
 * proof that `enforceAppCheck: true` is active.
 *
 * Usage:
 *   firebase emulators:start --only auth,functions --project demo-chauatgo
 *   node scripts/test-native-appcheck-emulator.js --strict
 *
 * Optional environment variables:
 *   FIREBASE_PROJECT_ID=demo-chauatgo
 *   FUNCTIONS_REGION=asia-southeast1
 *   FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001
 *   NATIVE_APPCHECK_FUNCTIONS=syncMySettlement,submitRiderRemittance
 *   FIREBASE_AUTH_TOKEN=<emulator ID token, optional>
 *   FIREBASE_APPCHECK_TOKEN=<valid emulator/provider token, optional>
 *
 * Exit codes:
 *   0 = all probes observed native 401/403 rejection, or fallback explicitly allowed
 *   1 = one or more native probes did not reject in strict mode
 *   2 = Functions Emulator is unreachable
 */

const DEFAULT_PROJECT = process.env.FIREBASE_PROJECT_ID || 'demo-chauatgo';
const DEFAULT_REGION = process.env.FUNCTIONS_REGION || 'asia-southeast1';
const DEFAULT_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const DEFAULT_FUNCTIONS = process.env.NATIVE_APPCHECK_FUNCTIONS
  || 'syncMySettlement,submitRiderRemittance';

const strict = process.argv.includes('--strict') || !process.argv.includes('--allow-emulator-fallback');
const allowFallback = process.argv.includes('--allow-emulator-fallback');
const functions = DEFAULT_FUNCTIONS.split(',').map((name) => name.trim()).filter(Boolean);
const baseUrl = `http://${DEFAULT_HOST}/${DEFAULT_PROJECT}/${DEFAULT_REGION}`;

function log(label, message) {
  console.log(`[native-appcheck] ${label} ${message}`);
}

function callableUrl(name) {
  return `${baseUrl}/${encodeURIComponent(name)}`;
}

async function postCallable(name, appCheckToken) {
  const headers = {
    'Content-Type': 'application/json',
    // A fake bearer is sufficient for a native App Check probe: native
    // enforcement should reject before business logic. A real emulator ID
    // token can be supplied when a handler must be reached for comparison.
    Authorization: `Bearer ${process.env.FIREBASE_AUTH_TOKEN || 'native-appcheck-probe'}`
  };
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(callableUrl(name), {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: {} }),
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON platform response */ }
    return {
      status: response.status,
      hasCors: Boolean(response.headers.get('access-control-allow-origin')),
      body,
      text: text.slice(0, 500)
    };
  } finally {
    clearTimeout(timer);
  }
}

function isNativeReject(result) {
  // Native platform rejection is expected to be 401/403. The body may be
  // empty because the request was rejected before the callable handler/CORS.
  return result.status === 401 || result.status === 403;
}

function describe(result) {
  const bodyStatus = result.body && result.body.error && result.body.error.status;
  const bodyMessage = result.body && result.body.error && result.body.error.message;
  return `HTTP ${result.status}; cors=${result.hasCors ? 'yes' : 'no'}; `
    + `body=${bodyStatus || bodyMessage || (result.text ? result.text : 'empty')}`;
}

async function main() {
  if (!functions.length) throw new Error('ไม่พบรายชื่อ Function สำหรับทดสอบ');

  log('CONFIG', `endpoint=${baseUrl}`);
  log('CONFIG', `functions=${functions.join(', ')}`);
  log('CONFIG', `mode=${strict ? 'strict' : 'fallback-allowed'}`);

  const results = [];
  for (const name of functions) {
    const probes = [
      { label: 'missing-token', token: '' },
      { label: 'invalid-token', token: 'not-a-real-app-check-token' }
    ];
    if (process.env.FIREBASE_APPCHECK_TOKEN) {
      probes.push({ label: 'provided-token', token: process.env.FIREBASE_APPCHECK_TOKEN, expectedReach: true });
    }
    for (const probe of probes) {
      try {
        const result = await postCallable(name, probe.token);
        const nativeRejected = isNativeReject(result);
        const expectedReject = !probe.expectedReach;
        results.push({ name, probe: probe.label, nativeRejected, result });
        const label = expectedReject === nativeRejected ? 'PASS' : 'WARN';
        log(label, `${name}/${probe.label}: ${describe(result)}`);
      } catch (err) {
        if (err && err.name === 'AbortError') {
          throw new Error(`Timeout while calling ${name}/${probe.label}`);
        }
        throw err;
      }
    }
  }

  const failed = results.filter((item) => item.probe !== 'provided-token' && !item.nativeRejected);
  if (!failed.length) {
    log('PASS', 'ทุก probe ถูกปฏิเสธด้วย 401/403 — Native App Check enforcement สังเกตได้จาก Emulator');
    return;
  }

  log('LIMITATION', 'Emulator ไม่ได้แสดง platform-level Native App Check rejection สำหรับ probe นี้');
  for (const item of failed) {
    log('LIMITATION', `${item.name}/${item.probe}: ${describe(item.result)}`);
  }
  log('ACTION', 'ยืนยันอีกครั้งด้วย Firebase Production/Preview หรือ deploy canary ที่ตั้ง enforceAppCheck: true');

  if (strict && !allowFallback) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err && (err.code === 'ECONNREFUSED' || /fetch failed|ECONNRESET|ENOTFOUND/i.test(String(err.message)))) {
    console.error(`[native-appcheck] UNAVAILABLE Functions Emulator: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  console.error(`[native-appcheck] ERROR ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
