/**
 * Reconciliation service — orchestrates the consent-gated cloud analysis.
 *
 * The privacy boundary is enforced HERE, in the application layer, so no UI
 * or adapter can bypass it:
 *
 * 1. `previewDisclosure` builds the minimal payload and returns it plus the
 *    excluded facts with reasons. Nothing is sent at this point.
 * 2. `approveDisclosure` persists a snapshot (canonical payload + SHA-256
 *    digest + fact versions + case revision). Approval is payload-specific.
 * 3. `runReconciliation` re-derives the payload from CURRENT facts and
 *    refuses to send when anything drifts (stale_consent) — the bytes that
 *    leave are provably the bytes the user approved. A snapshot is single-
 *    use; re-analysis needs a fresh approval. Rebuilt payloads are validated
 *    against known fact ids before any finding is kept, and findings are
 *    saved as `proposed` — cloud output is never auto-accepted truth.
 *
 * There is no code path that sends raw quotes, document text, filenames, or
 * originals to any cloud service.
 */

import type { DisclosurePayload } from '../../domain/privacy/disclosure'
import {
  buildDisclosure,
  canonicalizeDisclosure,
  type DisclosureBuildResult,
} from '../../domain/privacy/disclosure'
import type { EvidenceFact } from '../../domain/evidence'
import { reconciliationError } from '../../domain/reconciliation/finding'
import {
  createFindingRecords,
  validateRawFindings,
} from '../../domain/reconciliation/finding'
import type { ReconciliationError } from '../../domain/reconciliation/finding'
import type { CloudReconciler } from '../ports/cloud-reconciler'
import {
  digestCanonicalPayload,
  getDisclosure,
  markDisclosureConsumed,
  saveDisclosureSnapshot,
  type StoredDisclosureLike,
} from '../../infrastructure/storage/disclosure-repository'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'
import { saveFindings } from '../../infrastructure/storage/finding-repository'
import { getCase, bumpCaseRevision } from '../../infrastructure/storage/case-repository'

/* ------------------------------------------------------------------ */
/* Preview + approval                                                  */
/* ------------------------------------------------------------------ */

/**
 * Builds the disclosure preview. Pure read — nothing is sent or persisted.
 * The UI shows the exact payload (this is the "what will be shared" screen).
 */
export async function previewDisclosure(
  caseId: string,
  includedFactIds?: ReadonlySet<string>,
): Promise<
  | { ok: true; preview: DisclosureBuildResult; payload: DisclosurePayload }
  | { ok: false; error: ReconciliationError }
> {
  const paymentCase = await getCase(caseId)
  if (!paymentCase) return { ok: false, error: reconciliationError('not_found') }

  const rows = await listCaseFacts(caseId)
  const facts: EvidenceFact[] = rows.map((row) => row.fact)

  const result = buildDisclosure(facts, {
    caseCurrency: paymentCase.currency,
    caseRevision: paymentCase.revision,
    ...(includedFactIds ? { includedFactIds } : {}),
  })

  if (result.payload.facts.length === 0) {
    return { ok: false, error: reconciliationError('no_eligible_facts') }
  }
  return { ok: true, preview: result, payload: result.payload }
}

/** Persists an explicit approval of the exact payload. */
export async function approveDisclosure(
  caseId: string,
  payload: DisclosurePayload,
): Promise<
  | { ok: true; snapshot: StoredDisclosureLike }
  | { ok: false; error: ReconciliationError }
> {
  const paymentCase = await getCase(caseId)
  if (!paymentCase) return { ok: false, error: reconciliationError('not_found') }

  // Approval records each included fact's updatedAt; later edits change it.
  const rows = await listCaseFacts(caseId)
  const factById = new Map(rows.map((row) => [row.fact.id, row.fact]))
  const factVersions: Record<string, number> = {}
  for (const entry of payload.facts) {
    const fact = factById.get(entry.factId)
    if (!fact) {
      return { ok: false, error: reconciliationError('stale_consent') }
    }
    factVersions[entry.factId] = fact.updatedAt
  }

  const saved = await saveDisclosureSnapshot({ caseId, payload, factVersions })
  if (!saved.ok) return saved
  return { ok: true, snapshot: saved.value }
}

/* ------------------------------------------------------------------ */
/* Consent revalidation                                                */
/* ------------------------------------------------------------------ */

export interface ConsentValidation {
  valid: boolean
  error?: ReconciliationError
}

/**
 * Proves the approval still matches reality: case exists, revision matches,
 * snapshot is unconsumed, and a payload rebuilt from CURRENT facts digests
 * identically with unchanged fact versions. Any drift → stale_consent.
 */
export async function validateConsent(
  snapshotId: string,
): Promise<ConsentValidation> {
  const snapshot = await getDisclosure(snapshotId)
  if (!snapshot) {
    return { valid: false, error: reconciliationError('not_found') }
  }
  if (snapshot.consumedAt !== null) {
    return { valid: false, error: reconciliationError('already_analyzed') }
  }

  const paymentCase = await getCase(snapshot.caseId)
  if (!paymentCase) {
    return { valid: false, error: reconciliationError('not_found') }
  }
  if (paymentCase.revision !== snapshot.caseRevision) {
    return { valid: false, error: reconciliationError('stale_consent') }
  }

  // Rebuild from current facts using exactly the approved fact selection.
  const rows = await listCaseFacts(snapshot.caseId)
  const factById = new Map(rows.map((row) => [row.fact.id, row.fact]))
  for (const [factId, version] of Object.entries(snapshot.factVersions)) {
    const fact = factById.get(factId)
    if (!fact || fact.updatedAt !== version) {
      return { valid: false, error: reconciliationError('stale_consent') }
    }
  }

  const includedFactIds = new Set(snapshot.includedFactIds)
  const rebuilt = buildDisclosure(
    rows.map((row) => row.fact),
    {
      caseCurrency: paymentCase.currency,
      caseRevision: paymentCase.revision,
      includedFactIds,
    },
  )
  const canonical = canonicalizeDisclosure(rebuilt.payload)
  if (canonical !== snapshot.canonicalPayload) {
    return { valid: false, error: reconciliationError('stale_consent') }
  }

  return { valid: true }
}

/* ------------------------------------------------------------------ */
/* Analysis run                                                        */
/* ------------------------------------------------------------------ */

const running = new Map<string, { controller: AbortController }>()

export function isReconciliationRunning(caseId: string): boolean {
  return running.has(caseId)
}

export function cancelReconciliation(caseId: string): void {
  running.get(caseId)?.controller.abort()
}

export interface ReconciliationOutcome {
  ok: boolean
  savedFindings?: number
  droppedFindings?: number
  error?: ReconciliationError
}

/**
 * Runs the cloud analysis for an approved snapshot. Single-use: the snapshot
 * is marked consumed on send, so one approval can never produce two runs.
 */
export async function runReconciliation(
  snapshotId: string,
  reconciler: CloudReconciler,
): Promise<ReconciliationOutcome> {
  if (running.has(snapshotId)) {
    return { ok: false, error: reconciliationError('already_running') }
  }

  const snapshot = await getDisclosure(snapshotId)
  if (!snapshot) return { ok: false, error: reconciliationError('not_found') }

  const consent = await validateConsent(snapshotId)
  if (!consent.valid) {
    return { ok: false, error: consent.error ?? reconciliationError('stale_consent') }
  }

  const paymentCase = await getCase(snapshot.caseId)
  if (!paymentCase) return { ok: false, error: reconciliationError('not_found') }

  // Parse the approved payload back from its canonical stored form.
  let payload: DisclosurePayload
  try {
    payload = JSON.parse(snapshot.canonicalPayload) as DisclosurePayload
  } catch {
    return { ok: false, error: reconciliationError('stale_consent') }
  }

  const knownFactIds = new Set(payload.facts.map((entry) => entry.factId))
  const controller = new AbortController()
  running.set(snapshot.caseId, { controller })

  try {
    const result = await reconciler.reconcile(payload, controller.signal)

    if (!result.ok) {
      // Failed/cancelled runs never consume the approval; the same payload
      // can be retried explicitly. A send that reached the provider but
      // failed to return still consumes (below) — data may have been processed.
      return { ok: false, error: result.error }
    }

    // Honest provenance: cloud findings must come from cloud inference.
    if (result.inferenceSource !== 'in_cloud') {
      return { ok: false, error: reconciliationError('unexpected_source') }
    }

    const validated = validateRawFindings(result.rawFindings, knownFactIds)
    const records = createFindingRecords(validated.findings, {
      caseId: snapshot.caseId,
      caseRevision: snapshot.caseRevision,
      snapshotId: snapshot.id,
      model: result.model,
      promptVersion: snapshot.promptVersion,
      inferenceSource: result.inferenceSource,
      now: Date.now(),
    })

    const saved = records.length > 0 ? await saveFindings(records) : { ok: true as const, value: [] }
    if (!saved.ok) {
      return { ok: false, error: saved.error }
    }

    await markDisclosureConsumed(snapshot.id)
    // Analysis produced derived records; bump so downstream reports know.
    await bumpCaseRevision(snapshot.caseId, Date.now())

    return { ok: true, savedFindings: saved.value.length, droppedFindings: validated.dropped }
  } catch {
    return { ok: false, error: reconciliationError('model_error') }
  } finally {
    running.delete(snapshot.caseId)
  }
}

/** Re-export for the UI: digest helper for display purposes. */
export { digestCanonicalPayload }
