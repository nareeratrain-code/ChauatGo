/* Chauat Go — public site config. This file is NOT minified.
   Paste the reCAPTCHA v3 SITE key below. The site key is public.
   Never put the reCAPTCHA SECRET key in this file or in git.
   Until the placeholder is replaced, the app does not activate App Check,
   so Firestore, Storage, and callable functions keep working.

   Phone steps (do these before turning enforcement on):
   1. Phone browser → https://www.google.com/recaptcha/admin/create
      Type: reCAPTCHA v3 (Score based). Domains: the live site address
      (the Vercel domain in the address bar) and localhost.
      Copy the Site key. Leave the Secret key for Firebase only.
   2. https://console.firebase.google.com/project/chauat-go-b9841/appcheck
      Apps → Web app (1:282197694521:web:0528c22747a0c04bd815e8)
      → Register → reCAPTCHA → paste Site key + Secret → Save.
      Do not tap Enforce yet.
   3. Replace REPLACE_WITH_RECAPTCHA_V3_SITE_KEY below with that Site key,
      then redeploy the website (Vercel).
   4. Open the app. Firebase → Functions → Logs should show "[appcheck] ok".
   5. Only after those logs appear: App Check → APIs → Enforce
      Firestore, Storage, and Cloud Functions.
      Then set functions/.env APP_CHECK_ENFORCE=true and redeploy functions.
      Do not enforce Cloud Messaging (background push runs in the service worker).
*/
window.CHAUAT_ENV = {
  appCheckSiteKey: 'REPLACE_WITH_RECAPTCHA_V3_SITE_KEY',
  /* Notes only. This flag does not block Firestore.
     Real enforcement is the Firebase console toggle plus
     functions/.env APP_CHECK_ENFORCE=true. */
  appCheckEnforce: false
};
