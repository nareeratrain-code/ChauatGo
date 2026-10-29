'use strict';

/* Soft App Check check for callable handlers.
   enforce=false logs and allows the call. enforce=true rejects a missing
   or invalid token. Firebase only sets req.app when the token is valid. */

function appCheckStatus(req) {
  return !!(req && req.app && req.app.appId);
}

function presentedToken(req) {
  const raw = req && req.rawRequest;
  const headers = raw && raw.headers;
  if (!headers) return '';
  const value = headers['x-firebase-appcheck'] || headers['X-Firebase-AppCheck'] || '';
  const token = Array.isArray(value) ? value[0] : value;
  return String(token || '').trim();
}

function assertAppCheck(req, name, enforce, log) {
  const logger = log || console;
  const fn = String(name || 'unknown');
  let state = 'missing';
  if (appCheckStatus(req)) state = 'ok';
  else if (presentedToken(req)) state = 'invalid';
  const line = '[appcheck] ' + state + ' fn=' + fn;
  if (state === 'ok') logger.info(line);
  else logger.warn(line);
  if (state !== 'ok' && enforce) {
    const err = new Error('app-check');
    err.code = 'app-check';
    throw err;
  }
  return state === 'ok';
}

function enforceFromEnv(env) {
  return String((env && env.APP_CHECK_ENFORCE) || '') === 'true';
}

module.exports = { appCheckStatus, assertAppCheck, enforceFromEnv };
