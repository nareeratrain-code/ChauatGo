'use strict';

/* Soft App Check check for callable handlers.
   enforce=false logs and allows the call. enforce=true rejects a missing
   or invalid token. Firebase only sets req.app when the token is valid. */

function appCheckStatus(req) {
  return !!(req && req.app && req.app.appId);
}

function assertAppCheck(req, name, enforce, log) {
  const logger = log || console;
  const ok = appCheckStatus(req);
  if (ok) {
    logger.info('[appcheck] ok ' + name + ' ' + req.app.appId);
  } else {
    logger.warn('[appcheck] missing ' + name + ' enforce=' + !!enforce);
  }
  if (!ok && enforce) {
    const err = new Error('app-check');
    err.code = 'app-check';
    throw err;
  }
  return ok;
}

function enforceFromEnv(env) {
  return String((env && env.APP_CHECK_ENFORCE) || '') === 'true';
}

module.exports = { appCheckStatus, assertAppCheck, enforceFromEnv };
