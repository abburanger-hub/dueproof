import type { DisclosurePayload } from '../../domain/privacy/disclosure'
import type { ReconciliationError } from '../../domain/reconciliation/finding'

/**
 * Application port: consent-gated cloud reconciliation.
 *
 * This port is the cloud half of the privacy boundary:
 * - Its ONLY input type is an approved `DisclosurePayload` — the type system
 *   gives raw document text, quotes, and originals no path into it.
 * - It exposes no local/on-device capability, no retry-elsewhere option,
 *   and no way to widen the payload at send time.
 * - The application layer depends on this interface, never on the Firebase
 *   SDK, so tests substitute a fake and the privacy boundary stays auditable.
 */
export type ReconcileResult =
  | {
      ok: true
      /** Raw finding objects exactly as returned by the model (validated downstream). */
      rawFindings: Array<Record<string, unknown>>
      model: string
      inferenceSource: string
    }
  | { ok: false; error: ReconciliationError }

export interface CloudReconciler {
  reconcile(payload: DisclosurePayload, signal?: AbortSignal): Promise<ReconcileResult>
}
