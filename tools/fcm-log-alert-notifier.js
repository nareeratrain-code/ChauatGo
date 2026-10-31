#!/usr/bin/env node
'use strict';

/**
 * FCM structured-log alert notifier.
 *
 * It accepts a Google Cloud Monitoring/Webhook-style JSON payload from stdin
 * or through a small HTTP server, filters only send_exception and
 * send_partial_failure, and forwards a safe summary to Slack and/or LINE.
 *
 * No webhook token is stored in this file. Configure secrets through env vars.
 *
 * CLI examples:
 *   ALERT_SHARED_SECRET=test \
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
 *   node tools/fcm-log-alert-notifier.js --sample
 *
 * HTTP mode:
 *   ALERT_SHARED_SECRET=... PORT=8787 \
 *   node tools/fcm-log-alert-notifier.js --serve
 */

const http = require('node:http');
const crypto = require('node:crypto');

const ALERT_EVENTS = new Set(['send_exception', 'send_partial_failure']);
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 256 * 1024;
const DEDUPE_MS = Math.max(0, Number(process.env.ALERT_DEDUPE_SECONDS || 300) * 1000);
const recentAlerts = new Map();

function safeString(value, fallback = '') {
  return value == null ? fallback : String(value).slice(0, 500);
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getHeader(req, name) {
  return req && req.headers ? req.headers[name.toLowerCase()] : '';
}

function authorized(req) {
  const expected = process.env.ALERT_SHARED_SECRET;
  if (!expected) return false;
  const supplied = getHeader(req, 'x-alert-secret')
    || safeString(getHeader(req, 'authorization')).replace(/^Bearer\s+/i, '');
  return constantTimeEqual(supplied, expected);
}

function unwrapPayload(input) {
  const root = input && typeof input === 'object' ? input : {};
  const candidates = [
    root,
    root.jsonPayload,
    root.payload,
    root.incident && root.incident.jsonPayload,
    root.incident && root.incident.payload
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && ALERT_EVENTS.has(candidate.event)) return candidate;
    if (candidate && candidate.message && typeof candidate.message === 'object'
      && ALERT_EVENTS.has(candidate.message.event)) return candidate.message;
    if (candidate && typeof candidate.message === 'string') {
      try {
        const parsed = JSON.parse(candidate.message);
        if (ALERT_EVENTS.has(parsed.event)) return parsed;
      } catch (_) {}
    }
  }
  return null;
}

function alertKey(event) {
  return [event.event, event.riderId || '', event.orderId || '', event.errorCode || '', event.timestamp || ''].join('|');
}

function shouldSuppress(event) {
  if (!DEDUPE_MS) return false;
  const key = alertKey(event);
  const now = Date.now();
  const previous = recentAlerts.get(key) || 0;
  recentAlerts.set(key, now);
  for (const [entry, at] of recentAlerts) {
    if (now - at > DEDUPE_MS) recentAlerts.delete(entry);
  }
  return previous > 0 && now - previous < DEDUPE_MS;
}

function normalizeEvent(event) {
  const fields = event || {};
  const codes = fields.failureCodes && typeof fields.failureCodes === 'object'
    ? Object.entries(fields.failureCodes).map(([code, count]) => `${code}=${count}`).join(', ')
    : '';
  return {
    event: safeString(fields.event),
    riderId: safeString(fields.riderId, 'ไม่ระบุ'),
    orderId: safeString(fields.orderId, 'ไม่ระบุ'),
    errorCode: safeString(fields.errorCode, codes || 'ไม่ระบุ'),
    errorMessage: safeString(fields.errorMessage, 'ไม่ระบุ'),
    tokenCount: Number.isFinite(Number(fields.tokenCount)) ? Number(fields.tokenCount) : null,
    successCount: Number.isFinite(Number(fields.successCount)) ? Number(fields.successCount) : null,
    failureCount: Number.isFinite(Number(fields.failureCount)) ? Number(fields.failureCount) : null,
    invalidTokenCount: Number.isFinite(Number(fields.invalidTokenCount)) ? Number(fields.invalidTokenCount) : null,
    timestamp: safeString(fields.timestamp, new Date().toISOString())
  };
}

function formatText(event) {
  const title = event.event === 'send_exception'
    ? 'FCM ส่งแจ้งเตือนเกิด Exception'
    : 'FCM ส่งแจ้งเตือนล้มเหลวบางส่วน';
  const counts = event.tokenCount == null ? ''
    : `\nToken: ${event.tokenCount} | สำเร็จ: ${event.successCount ?? '-'} | ล้มเหลว: ${event.failureCount ?? '-'}${event.invalidTokenCount == null ? '' : ` | Token เสีย: ${event.invalidTokenCount}`}`;
  return `${title}\nRider: ${event.riderId}\nOrder: ${event.orderId}\nError: ${event.errorCode}\nรายละเอียด: ${event.errorMessage}${counts}\nเวลา: ${event.timestamp}`;
}

function jsonRequest(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const req = httpsRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: Object.assign({
        'content-type': 'application/json',
        'content-length': payload.length
      }, headers)
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function httpsRequest(options, callback) {
  return require(options.protocol === 'http:' ? 'node:http' : 'node:https').request(options, callback);
}

async function sendSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  await jsonRequest(url, { text: `:warning: *ChauatGo FCM Alert*\n${text}` });
  return true;
}

async function sendLine(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TO;
  if (!token || !to) return false;
  await jsonRequest('https://api.line.me/v2/bot/message/push', {
    to,
    messages: [{ type: 'text', text: `ChauatGo FCM Alert\n${text}` }]
  }, { Authorization: `Bearer ${token}` });
  return true;
}

async function handlePayload(payload, req) {
  if (req && !authorized(req)) return { status: 401, body: { ok: false, error: 'unauthorized' } };
  const raw = unwrapPayload(payload);
  if (!raw) return { status: 202, body: { ok: true, ignored: true, reason: 'event_not_targeted' } };
  const event = normalizeEvent(raw);
  if (shouldSuppress(event)) return { status: 202, body: { ok: true, suppressed: true, event: event.event } };
  const text = formatText(event);
  if (process.env.ALERT_DRY_RUN === '1') {
    return { status: 200, body: { ok: true, dryRun: true, event: event.event, text } };
  }
  const sent = [];
  if (process.env.SLACK_WEBHOOK_URL) { await sendSlack(text); sent.push('slack'); }
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_TO) { await sendLine(text); sent.push('line'); }
  if (!sent.length) throw new Error('No alert destination configured: set Slack or LINE environment variables.');
  return { status: 200, body: { ok: true, event: event.event, sent } };
}

function samplePayload() {
  return { event: 'send_partial_failure', riderId: 'rider-demo', orderId: 'order-demo', tokenCount: 2, successCount: 1, failureCount: 1, invalidTokenCount: 1, failureCodes: { 'messaging/registration-token-not-registered': 1 }, timestamp: new Date().toISOString() };
}

async function runCli() {
  if (process.argv.includes('--sample')) {
    const result = await handlePayload(samplePayload());
    console.log(JSON.stringify(result));
    return;
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const result = await handlePayload(JSON.parse(input));
  console.log(JSON.stringify(result));
}

function serve() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/fcm-alert') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) req.destroy(new Error('payload_too_large'));
    });
    req.on('end', async () => {
      try {
        const result = await handlePayload(JSON.parse(body), req);
        res.writeHead(result.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safeString(error.message) }));
      }
    });
  });
  server.listen(PORT, () => console.log(`FCM alert webhook listening on :${PORT}/fcm-alert`));
}

if (require.main === module) {
  if (process.argv.includes('--serve')) serve();
  else runCli().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}

module.exports = { handlePayload, normalizeEvent, unwrapPayload, formatText };
