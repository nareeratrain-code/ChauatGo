/* Chauat Go — public site config. This file is NOT minified.
   Paste the reCAPTCHA v3 SITE key below. The site key is public.
   Never put the reCAPTCHA SECRET key in this file or in git.
   The site key below is for https://chauat-go-i5ec.vercel.app only.
   Enforcement is still off: Firestore, Storage, and callable functions
   keep working even when a token is missing.

   Phone steps (do these before turning enforcement on):
   1. Phone browser → https://www.google.com/recaptcha/admin/create
      Type: reCAPTCHA v3 (Score based). Domain already registered:
      chauat-go-i5ec.vercel.app. localhost is not on that key.
      Copy the Site key. Leave the Secret key for Firebase only.
   2. https://console.firebase.google.com/project/chauat-go-b9841/appcheck
      Apps → Web app (1:282197694521:web:0528c22747a0c04bd815e8)
      → Register → reCAPTCHA → paste Site key + Secret → Save.
      Do not tap Enforce yet.
   3. The Site key for chauat-go-i5ec.vercel.app is already in appCheckSiteKey.
      Redeploy the website (Vercel) after any change to this file.
   4. Open the app. Firebase → Functions → Logs should show "[appcheck] ok".
   5. Only after those logs appear: App Check → APIs → Enforce
      Firestore, Storage, and Cloud Functions.
      Then set functions/.env APP_CHECK_ENFORCE=true and redeploy functions.
      Do not enforce Cloud Messaging (background push runs in the service worker).
*/
window.CHAUAT_ENV = {
  appCheckSiteKey: '6Lfl7vMtAAAAAEPCZ_2qEK1y3l37ztkcjQgE2bIm',
  /* Notes only. This flag does not block Firestore.
     Real enforcement is the Firebase console toggle plus
     functions/.env APP_CHECK_ENFORCE=true. */
  appCheckEnforce: false
};
