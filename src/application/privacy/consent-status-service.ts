/**
 * Application: stale-consent surfacing.
 *
 * `validateConsent` already blocks a send when the approved payload no
 * longer matches reality. This module explains WHY it is stale so the UI can
 * tell the user what changed (records changed → rebuild and re-approve)
 * instead of surfacing a generic error.
 *
 * Reads repositories; no AI, no network.
 */

import { getCase } from '../../infrastructure/storage/case-repository'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'
import {
  getDisclosure,
  type StoredDisclosureLike,
} from '../../infrastructure/storage/disclosure-repository'
import { reconciliationError } from '../../domain/reconciliation/finding'
import type { ReconciliationError } from '../../domain/reconciliation/finding'

export type ConsentIssue =
  | 'case_missing'
  | 'case_revision_changed'
  | 'fact_edited'
  | 'fact_missing'
  | 'snapshot_consumed'

export interface ConsentStatus {
  /** The snapshot the status was computed for. */
  snapshot: StoredDisclosureLike
  valid: boolean
  issue: ConsentIssue | null
  /** Ids of facts that changed or vanished (for `fact_edited` / `fact_missing`). */
  changedFactIds: string[]
  /** Case revision recorded at approval time, for display. */
  approvedCaseRevision: number
}

/** Loads a snapshot and reports exactly why its approval is (in)valid. */
export async function getConsentStatus(snapshotId: string): Promise<
  { ok: true; status: ConsentStatus } | { ok: false; error: ReconciliationError }
> {
  const snapshot = await getDisclosure(snapshotId)
  if (!snapshot) return { ok: false, error: reconciliationError('not_found') }

  const base = {
    snapshot,
    approvedCaseRevision: snapshot.caseRevision,
  }

  if (snapshot.consumedAt !== null) {
    return { ok: true, status: { ...base, valid: false, issue: 'snapshot_consumed', changedFactIds: [] } }
  }

  const paymentCase = await getCase(snapshot.caseId)
  if (!paymentCase) {
    return { ok: true, status: { ...base, valid: false, issue: 'case_missing', changedFactIds: [] } }
  }
  if (paymentCase.revision !== snapshot.caseRevision) {
    return {
      ok: true,
      status: { ...base, valid: false, issue: 'case_revision_changed', changedFactIds: [] },
    }
  }

  const rows = await listCaseFacts(snapshot.caseId)
  const factById = new Map(rows.map((row) => [row.fact.id, row.fact]))
  const edited: string[] = []
  const missing: string[] = []
  for (const [factId, version] of Object.entries(snapshot.factVersions)) {
    const fact = factById.get(factId)
    if (!fact) {
      missing.push(factId)
    } else if (fact.updatedAt !== version) {
      edited.push(factId)
    }
  }
  if (edited.length > 0 || missing.length > 0) {
    return {
      ok: true,
      status: {
        ...base,
        valid: false,
        issue: edited.length > 0 ? 'fact_edited' : 'fact_missing',
        changedFactIds: [...edited, ...missing],
      },
    }
  }

  return { ok: true, status: { ...base, valid: true, issue: null, changedFactIds: [] } }
}

export const CONSENT_ISSUE_MESSAGES: Record<ConsentIssue, string> = {
  case_missing: 'The case for this approval no longer exists on this device.',
  case_revision_changed:
    'Evidence in this case changed since the approval (documents, facts, or analysis). Build a new preview and approve again.',
  fact_edited:
    'One or more approved facts were edited after the approval. Build a new preview and approve again.',
  fact_missing: 'One or more approved facts are no longer on this device.',
  snapshot_consumed: 'This approval was already used for an analysis. Build a new preview.',
}
