/* Chauat Go — public site config. This file is NOT minified.
   The Enterprise site key below is public and safe for client-side use.
   Never put a secret key or service-account key in this file or in git.
   The key below covers the production Vercel domains.
   Enforcement is still off: Firestore, Storage, and callable functions
   keep working even when a token is missing.

   Phone steps (do these before turning enforcement on):
   1. Create a Fraud Defense / reCAPTCHA Enterprise website key for the
      production domains: 5ec.vercel.app and chauat-go-i5ec.vercel.app.
   2. Register the same key in Firebase App Check for Web App
      1:282197694521:web:0528c22747a0c04bd815e8.
   3. Redeploy the website (Vercel) after any change to this file.
   4. Open the app and confirm the App Check token works before enforcement.
   5. Only after successful upload tests: App Check → APIs → Enforce
      Firestore, Storage, and Cloud Functions.
      Then set functions/.env APP_CHECK_ENFORCE=true and redeploy functions.
      Do not enforce Cloud Messaging (background push runs in the service worker).
*/
window.CHAUAT_ENV = {
  appCheckSiteKey: '6LdQGwMuAAAAAN5YWq3TIJVrVhWJw19RVbSgn2-_',
  /* Notes only. This flag does not block Firestore.
     Real enforcement is the Firebase console toggle plus
     functions/.env APP_CHECK_ENFORCE=true. */
  appCheckEnforce: false
};
