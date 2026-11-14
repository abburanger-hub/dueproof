import type { AppCheck } from 'firebase/app-check'
import type { FirebaseApp } from 'firebase/app'
import { getFirebaseApp } from './app'

/**
 * App Check setup.
 *
 * Firebase AI Logic enforces App Check: without a valid attestation token,
 * AI requests are rejected. DueProof has no server and no accounts, so App
 * Check is the only project-level abuse control for the AI calls.
 *
 * Two modes:
 *
 * - Development: the App Check debug provider. `window.FIREBASE_APPCHECK_DEBUG_TOKEN`
 *   must be set to `true` (or a token string) before `initializeAppCheck`;
 *   the SDK then prints a debug token to the browser console on first run.
 *   That token must be registered once in the Firebase console
 *   (App Check → Apps → dueproof web app → Manage debug tokens).
 *   This module never sets the debug flag in production builds
 *   (`import.meta.env.PROD` is statically replaced by Vite).
 * - Production: reCAPTCHA Enterprise. The site key is provided at deploy time
 *   via `VITE_APP_CHECK_RECAPTCHA_SITE_KEY` and must be registered in the
 *   Firebase console during the deployment phase. A missing key is a hard
 *   error — production must not ship without attestation.
 *
 * App Check is not user authentication and not a spending cap; it only
 * attests that requests come from this app.
 */

declare global {
  interface Window {
    /**
     * App Check debug token for development. When set to `true` before
     * `initializeAppCheck`, the App Check SDK uses the debug provider and
     * prints a registration token to the console on first run.
     */
    FIREBASE_APPCHECK_DEBUG_TOKEN?: true | string
  }
}

let appCheckPromise: Promise<AppCheck> | undefined

async function initializeAppCheck(app: FirebaseApp): Promise<AppCheck> {
  const { initializeAppCheck, CustomProvider, ReCaptchaEnterpriseProvider } =
    await import('firebase/app-check')

  if (import.meta.env.PROD) {
    const siteKey = import.meta.env.VITE_APP_CHECK_RECAPTCHA_SITE_KEY
    if (typeof siteKey !== 'string' || siteKey === '') {
      throw new Error(
        'DueProof production builds require VITE_APP_CHECK_RECAPTCHA_SITE_KEY ' +
          '(reCAPTCHA Enterprise site key) for Firebase App Check. Register the ' +
          'site key in the Firebase console (App Check → Apps → Manage reCAPTCHA ' +
          'keys), then deploy with the variable set.',
      )
    }
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
  }

  // Development: the App Check debug provider. Setting the debug flag to
  // `true` BEFORE initializeAppCheck makes the SDK (a) use the debug token for
  // attestation — the real provider is never called — and (b) print
  // "Firebase App Check debug token: <uuid>" to the console on every session,
  // persisting the same token in IndexedDB until it is registered once in
  // the Firebase console (App Check → Apps → dueproof → Manage debug tokens).
  //
  // initializeAppCheck still requires a provider instance. CustomProvider is
  // used instead of a reCAPTCHA provider so development loads no third-party
  // script; its getToken intentionally rejects — in debug mode the SDK
  // short-circuits before ever calling it, so this only fires if the debug
  // flag ever fails to be set (a loud failure, not a silent bypass).
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  return initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () =>
        Promise.reject(
          new Error(
            'DueProof development App Check must use the debug provider. ' +
              'This CustomProvider is a placeholder that must never be called.',
          ),
        ),
    }),
    isTokenAutoRefreshEnabled: true,
  })
}

/**
 * Lazily initializes and returns the App Check instance.
 *
 * Called only when an AI feature needs Firebase; the local-first workflow
 * never touches this module. Initialization is cached so the App Check token
 * refresh lifecycle is managed by a single instance.
 */
export function getAppCheck(): Promise<AppCheck> {
  if (!appCheckPromise) {
    appCheckPromise = initializeAppCheck(getFirebaseApp()).catch((error: unknown) => {
      // Reset so a later retry can attempt initialization again.
      appCheckPromise = undefined
      throw error
    })
  }
  return appCheckPromise
}
