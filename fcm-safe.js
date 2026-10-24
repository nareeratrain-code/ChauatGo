/* FCM must never reject or delay an order.
   firebase-functions-compat 9.22 does this inside httpsCallable:

     try { return this.messaging.getToken(); } catch (e) { return; }

   getToken() returns a promise. The published bundle dropped await, so the
   try/catch misses the rejection. With notification permission granted,
   that promise registers /firebase-messaging-sw.js. A 404 there rejects
   the promise and aborts createOrder.

   httpsCallable holds the private messaging-internal component, not the
   object returned by firebase.messaging(). Patching only the public
   getToken does not stop the callable. disarm() patches the private one.

   A call with no serviceWorkerRegistration is the callable SDK. Resolve
   it immediately and do not register the default worker. A call that
   passes the app's /sw.js registration may fetch a token; failures
   resolve to undefined. */
(function (root) {
  function vapidKey() {
    var env = root.CHAUAT_ENV || {};
    var key = String(env.vapidKey || '').trim();
    return key.length > 20 ? key : '';
  }

  function patchGetToken(messaging) {
    if (!messaging || typeof messaging.getToken !== 'function' || messaging.__chauatSafe) return messaging;
    var raw = messaging.getToken.bind(messaging);
    messaging.getToken = function (options) {
      var opts = options || {};
      if (!opts.serviceWorkerRegistration) return Promise.resolve(undefined);
      return Promise.resolve().then(function () {
        return raw(opts);
      }).then(function (token) {
        return token || undefined;
      }, function (err) {
        console.warn('[fcm] token skipped', err);
        return undefined;
      });
    };
    messaging.__chauatSafe = true;
    return messaging;
  }

  function install(app) {
    if (!root.firebase || !root.firebase.messaging || !app) return null;
    var messaging;
    try {
      messaging = root.firebase.messaging(app);
    } catch (err) {
      console.warn('[fcm] init skipped', err);
      return null;
    }
    return patchGetToken(messaging);
  }

  /* Patch the instance httpsCallable actually calls. */
  function disarm(app) {
    var modular = app && (app._delegate || app);
    var container = modular && modular.container;
    if (!container || typeof container.getProvider !== 'function') return;
    var provider;
    try {
      provider = container.getProvider('messaging-internal');
    } catch (err) {
      return;
    }
    if (!provider) return;
    function take(internal) {
      patchGetToken(internal);
    }
    try {
      if (typeof provider.getImmediate === 'function') take(provider.getImmediate({ optional: true }));
    } catch (err) {}
    if (typeof provider.get !== 'function') return;
    Promise.resolve().then(function () {
      return provider.get();
    }).then(take, function () {});
  }

  /* Explicit registration. Callers must not await this on the order path. */
  function warm(app) {
    var key = vapidKey();
    if (!key || !root.navigator || !root.navigator.serviceWorker) return Promise.resolve(undefined);
    var messaging = install(app);
    if (!messaging || !root.navigator.serviceWorker.getRegistration) return Promise.resolve(undefined);
    return root.navigator.serviceWorker.getRegistration('/sw.js').then(function (reg) {
      if (!reg) return undefined;
      return messaging.getToken({ vapidKey: key, serviceWorkerRegistration: reg });
    }, function () {
      return undefined;
    });
  }

  root.ChauatFcm = { install: install, disarm: disarm, warm: warm };
})(typeof self !== 'undefined' ? self : this);
