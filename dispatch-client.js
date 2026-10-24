/* Call a 2nd-gen Firebase callable in asia-southeast1 without the Functions SDK.
   The compat SDK defaults to us-central1, which is the wrong region and was
   one cause of the browser "Failed to fetch" on accept. The function is
   deployed with invoker public. App Check is enforced inside the function,
   not by the platform, so a rejection still has CORS headers. */
(function (root) {
  var PROJECT = 'chauat-go-b9841';
  var REGION = 'asia-southeast1';

  function functionsBase() {
    var host = (root.location && root.location.hostname) || '';
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5001/' + PROJECT + '/' + REGION;
    }
    return 'https://' + REGION + '-' + PROJECT + '.cloudfunctions.net';
  }

  function appCheckHeader() {
    if (!root.ChauatAppCheck || typeof root.ChauatAppCheck.token !== 'function') {
      return Promise.resolve('');
    }
    return Promise.resolve().then(function () {
      return root.ChauatAppCheck.token();
    }).then(function (token) {
      return token || '';
    }).catch(function () {
      return '';
    });
  }

  function callFunction(name, data, auth) {
    var user = auth && auth.currentUser;
    if (!user) return Promise.reject(new Error('ต้องเข้าสู่ระบบ'));
    return Promise.all([user.getIdToken(), appCheckHeader()]).then(function (parts) {
      var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + parts[0]
      };
      if (parts[1]) headers['X-Firebase-AppCheck'] = parts[1];
      return fetch(functionsBase() + '/' + name, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ data: data || {} })
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (e) { body = {}; }
        if (!res.ok || (body && body.error)) {
          var msg = (body.error && (body.error.message || body.error.status)) || '';
          if (res.status === 401 || res.status === 403) {
            if (!msg) msg = 'เรียกฟังก์ชันไม่ได้ — แอดมินต้องเปิดสิทธิ์ Cloud Run invoker (allUsers)';
          } else if (!msg || res.status === 404 || res.status === 0) {
            msg = 'ระบบจ่ายงานยังไม่เปิด — แอดมินต้องติดตั้ง Cloud Functions';
          }
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return body.result;
      });
    }).catch(function (err) {
      if (err && err.status) throw err;
      var raw = (err && err.message) || '';
      if (!raw || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
        throw new Error('ติดต่อระบบจ่ายงานไม่ได้ — ตรวจเน็ต หรือแอดมินต้องเปิดสิทธิ์เรียกฟังก์ชัน (Cloud Run invoker)');
      }
      throw err;
    });
  }

  root.ChauatFn = { functionsBase: functionsBase, callFunction: callFunction };
})(typeof self !== 'undefined' ? self : this);
