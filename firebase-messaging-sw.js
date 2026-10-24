/* Default worker for Firebase Cloud Messaging.
   getToken() with no serviceWorkerRegistration registers
   /firebase-messaging-sw.js at scope /firebase-cloud-messaging-push-scope.
   This file must stay JavaScript (a 404 text/plain response aborts that
   registration). It is a different scope from /sw.js, so it must not claim
   clients, cache the app, or navigate open windows. */
try {
  importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM',
    authDomain: 'chauat-go-b9841.firebaseapp.com',
    projectId: 'chauat-go-b9841',
    storageBucket: 'chauat-go-b9841.firebasestorage.app',
    messagingSenderId: '282197694521',
    appId: '1:282197694521:web:0528c22747a0c04bd815e8'
  });
  firebase.messaging().onBackgroundMessage(function (payload) {
    var note = (payload && payload.notification) || {};
    var data = (payload && payload.data) || {};
    var title = note.title || 'ChauatGo';
    var body = note.body || '';
    self.registration.showNotification(title, {
      body: body,
      icon: '/icons/icon-512.png',
      data: data,
      tag: data.offerId || data.orderId || 'chauat-push'
    });
  });
} catch (err) {}
