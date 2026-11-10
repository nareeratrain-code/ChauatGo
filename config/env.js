/* Chauat Go — public site config. This file is NOT minified.
   The Enterprise site key below is public and safe for client-side use.
   Never put a secret key or service-account key in this file or in git.
   The key below covers chauat-go-i5ec.vercel.app. Add chauatgo.com on the
   same reCAPTCHA Enterprise key before that domain serves the app.
   Enforcement is still off: Firestore, Storage, and callable functions
   keep working even when a token is missing.

   Phone steps (ship the client, watch metrics, then enforce):
   1. Firebase Console → App Check → Apps → the web app
      1:282197694521:web:0528c22747a0c04bd815e8.
      Provider: reCAPTCHA Enterprise. Site key: the value below.
   2. Redeploy the website on Vercel so every page activates App Check.
   3. Watch App Check metrics for a day or two. Verified requests should
      climb. Do not turn on Enforce yet.
   4. Callable enforcement is functions/.env APP_CHECK_ENFORCE=true,
      then firebase deploy --only functions. Leave it false until step 3
      looks healthy. A missing token is logged and still allowed.
   5. Firestore and Storage Enforce are Console toggles under
      App Check → APIs. Turn those on only after the client has been
      sending tokens. The app does not wait on those toggles.
      Leave Cloud Messaging unenforced.
   6. On localhost the client prints an App Check debug token.
      Register it in App Check → Manage debug tokens. Never commit it.
*/
window.CHAUAT_ENV = {
  appCheckSiteKey: '6LdQGwMuAAAAAN5YWq3TIJVrVhWJw19RVbSgn2-_',
  /* Notes only. This flag does not block Firestore.
     Real enforcement is the Firebase console toggle plus
     functions/.env APP_CHECK_ENFORCE=true. */
  appCheckEnforce: false
};
