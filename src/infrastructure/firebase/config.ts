/**
 * Firebase web app configuration.
 *
 * Values are read from Vite environment variables (`VITE_FIREBASE_*`),
 * provided by `.env.local` (git-ignored). See `.env.example` for the
 * template and where to find the values in the Firebase console.
 *
 * These values identify the Firebase project inside a client-side app; they
 * are public by design. Protection comes from App Check, security rules, and
 * API quotas — never from hiding these values.
 */

export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

const env = import.meta.env as unknown as Record<string, string | undefined>

function readRequiredEnv(key: string): string {
  const value = env[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${key} is missing. Copy .env.example to .env.local and fill in the ` +
        'Firebase web app config (Firebase console → Project settings → Your apps).',
    )
  }
  return value.trim()
}

/**
 * Returns the Firebase web app configuration.
 *
 * Fails with an actionable message (instead of silently degrading) when the
 * environment is incomplete, so misconfiguration is visible during development.
 */
export function getFirebaseWebConfig(): FirebaseWebConfig {
  return {
    apiKey: readRequiredEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readRequiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readRequiredEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readRequiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readRequiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readRequiredEnv('VITE_FIREBASE_APP_ID'),
  }
}
