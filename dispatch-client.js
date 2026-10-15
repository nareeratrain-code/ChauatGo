/* Call a 2nd-gen Firebase callable in asia-southeast1 without the Functions SDK.
   The compat SDK defaults to us-central1, which is the wrong region. */
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

  function callFunction(name, data, auth) {
    var user = auth && auth.currentUser;
    if (!user) return Promise.reject(new Error('ต้องเข้าสู่ระบบ'));
    return user.getIdToken().then(function (token) {
      return fetch(functionsBase() + '/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ data: data || {} })
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (e) { body = {}; }
        if (!res.ok || (body && body.error)) {
          var msg = (body.error && (body.error.message || body.error.status)) || '';
          if (!msg || res.status === 404 || res.status === 0) {
            msg = 'ระบบจ่ายงานยังไม่เปิด — แอดมินต้องติดตั้ง Cloud Functions';
          }
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return body.result;
      });
    });
  }

  root.ChauatFn = { functionsBase: functionsBase, callFunction: callFunction };
})(typeof self !== 'undefined' ? self : this);
