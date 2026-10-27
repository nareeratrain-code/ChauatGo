/* Firebase App Check (reCAPTCHA Enterprise) for the named page app.
   A placeholder site key does not activate the SDK, so the app keeps
   working until the key is registered in the Firebase console. */
(function (root) {
  var PLACEHOLDER = 'REPLACE_WITH_RECAPTCHA_V3_SITE_KEY';
  var started = null;

  function siteKey() {
    var env = root.CHAUAT_ENV || {};
    var key = String(env.appCheckSiteKey || '').trim();
    if (!key || key === PLACEHOLDER || key.indexOf('REPLACE_') === 0 || key.length < 20) return '';
    return key;
  }

  function cancelledMessage(err) {
    var msg = String((err && (err.message || err.code)) || err || '').trim();
    return /^cancelled$/i.test(msg) || /^canceled$/i.test(msg);
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('unhandledrejection', function (event) {
      if (!cancelledMessage(event && event.reason)) return;
      if (event.preventDefault) event.preventDefault();
      console.warn('[appcheck] cancelled');
    });
  }

  function start(app) {
    if (!app || started) return started;
    var key = siteKey();
    if (!key) {
      console.info('[appcheck] site key not set — App Check stays off');
      return null;
    }
    if (!root.firebase || !root.firebase.appCheck || !root.firebase.appCheck.ReCaptchaEnterpriseProvider) {
      console.warn('[appcheck] Firebase App Check Enterprise provider is not loaded');
      return null;
    }
    try {
      var appCheck = root.firebase.appCheck(app);
      appCheck.activate(new root.firebase.appCheck.ReCaptchaEnterpriseProvider(key), true);
      started = appCheck;
      console.info('[appcheck] reCAPTCHA Enterprise active');
      return appCheck;
    } catch (err) {
      console.warn('[appcheck] activate failed', err);
      return null;
    }
  }

  function token() {
    if (!started || typeof started.getToken !== 'function') return Promise.resolve('');
    return started.getToken(false).then(function (res) {
      return (res && res.token) || '';
    }).catch(function (err) {
      if (cancelledMessage(err)) console.warn('[appcheck] cancelled');
      else console.warn('[appcheck] token failed', err);
      return '';
    });
  }

  root.ChauatAppCheck = { start: start, token: token, siteKey: siteKey };
})(typeof self !== 'undefined' ? self : this);
