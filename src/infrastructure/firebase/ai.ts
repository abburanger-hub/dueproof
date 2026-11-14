import { GoogleAIBackend, InferenceMode, getAI, getGenerativeModel } from 'firebase/ai'
import type { AI, GenerateContentRequest, GenerativeModel } from 'firebase/ai'
import type { FirebaseApp } from 'firebase/app'
import { getAppCheck } from './app-check'
import { getFirebaseApp } from './app'

/**
 * Central access to Firebase AI Logic for DueProof.
 *
 * Two strictly separate model instances are exposed — this separation IS the
 * privacy architecture:
 *
 * - `getLocalOnlyModel()` — created with `InferenceMode.ONLY_ON_DEVICE`.
 *   Used exclusively for private document extraction. If the on-device
 *   model is unavailable it throws; it can never silently fall back to the
 *   cloud. Callers must handle the failure and offer manual entry instead.
 *
 * - `getCloudOnlyModel()` — created with `InferenceMode.ONLY_IN_CLOUD`.
 *   Used exclusively for reconciliation of an explicitly approved,
 *   pseudonymized disclosure payload. It must never receive raw document
 *   text, originals, filenames, or identity mappings.
 *
 * Both paths enforce App Check (required by Firebase AI Logic).
 */

let localModel: GenerativeModel | undefined
let cloudModel: GenerativeModel | undefined
let aiService: AI | undefined

/**
 * Prepares the shared AI service and App Check, then returns the AI service.
 * The heavy Firebase AI module is imported dynamically so the local-first
 * workflow (which never touches AI) does not pay the bundle cost.
 */
async function getAIService(): Promise<AI> {
  if (!aiService) {
    const app: FirebaseApp = getFirebaseApp()
    // App Check must be active before any AI request; AI Logic enforces it.
    await getAppCheck()
    aiService = getAI(app, { backend: new GoogleAIBackend() })
  }
  return aiService
}

/**
 * The local-only model. Intentionally hard-fails when the on-device model is
 * not available — the privacy boundary depends on this never falling back.
 */
export async function getLocalOnlyModel(): Promise<GenerativeModel> {
  if (!localModel) {
    const ai = await getAIService()
    localModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })
  }
  return localModel
}

/**
 * The cloud-only model for approved disclosure payloads. Hard-fails rather
 * than silently degrading to on-device inference.
 */
export async function getCloudOnlyModel(): Promise<GenerativeModel> {
  if (!cloudModel) {
    const ai = await getAIService()
    cloudModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD })
  }
  return cloudModel
}

/**
 * Prepares the on-device model for use. Must be called from a user-gesture
 * handler (e.g., a button click), because the browser may need to download
 * the model on first use and Chrome requires a user gesture for that.
 *
 * The progress callback receives a 0–1 fraction during any download.
 */
export async function prepareDeviceModel(
  onDownloadProgress?: (progressValue: number) => void,
): Promise<void> {
  const model = await getLocalOnlyModel()
  await model.initializeDeviceModel(onDownloadProgress)
}

export type { GenerateContentRequest, GenerativeModel }
