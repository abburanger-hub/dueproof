import { getApp, getApps, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { getFirebaseWebConfig } from './config'

/**
 * Lazily initialized Firebase app singleton.
 *
 * DueProof's core workflow (cases, documents, review, reports) is fully local
 * and must keep working without Firebase. The SDK is therefore initialized
 * only when an AI feature actually needs it — never at application startup.
 */
export function getFirebaseApp(): FirebaseApp {
  const existingApps = getApps()
  if (existingApps.length > 0) {
    return getApp()
  }
  return initializeApp(getFirebaseWebConfig())
}
