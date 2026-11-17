/**
 * Domain: reconciliation findings from the consent-gated cloud analysis.
 *
 * Trust model (mirrors the fact model, deliberately stricter):
 * - Cloud findings are PROPOSALS. They start as `proposed` and require user
 *   review before they can be used in any report.
 * - Every finding must carry one of the four mandatory evidence statuses and
 *   cite real supplied fact ids; anything structurally invalid is dropped,
 *   never guessed into place.
 * - Findings record the case revision they were produced from, so they can
 *   be shown as stale when evidence changes later.
 * - Findings are never legal advice and never proof of authenticity.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import type { EvidenceStatus } from '../ledger/ledger'

export const FINDING_TYPES = ['contradiction', 'gap', 'clarification', 'draft_request'] as const
export type FindingType = (typeof FINDING_TYPES)[number]

export const FINDING_EVIDENCE_STATUSES = [
  'supported',
  'not_found',
  'conflicting',
  'uncertain',
] as const

export type FindingReviewStatus = 'proposed' | 'user_reviewed' | 'rejected'

export const MAX_FINDINGS = 12
export const EXPLANATION_MAX = 600
export const QUESTION_MAX = 300
export const DRAFT_MAX = 1500

export interface Finding {
  id: string
  caseId: string
  /** Case revision at analysis time — used to mark stale findings. */
  caseRevision: number
  type: FindingType
  evidenceStatus: EvidenceStatus
  explanation: string
  unresolvedQuestion: string | null
  draftText: string | null
  supportingFactIds: string[]
  conflictingFactIds: string[]
  status: FindingReviewStatus
  /** The approved disclosure snapshot this finding came from. */
  snapshotId: string
  model: string
  promptVersion: string
  inferenceSource: string
  createdAt: number
  updatedAt: number
}

export interface ValidatedFinding {
  type: FindingType
  evidenceStatus: EvidenceStatus
  explanation: string
  unresolvedQuestion: string | null
  draftText: string | null
  supportingFactIds: string[]
  conflictingFactIds: string[]
}

/* ------------------------------------------------------------------ */
/* Safe error vocabulary                                               */
/* ------------------------------------------------------------------ */

export type ReconciliationErrorCode =
  | 'no_eligible_facts'
  | 'consent_required'
  | 'stale_consent'
  | 'already_analyzed'
  | 'unexpected_source'
  | 'invalid_output'
  | 'offline'
  | 'quota'
  | 'model_error'
  | 'cancelled'
  | 'not_found'
  | 'storage_error'
  | 'already_running'

export interface ReconciliationError {
  code: ReconciliationErrorCode
  message: string
}

const MESSAGES: Record<ReconciliationErrorCode, string> = {
  no_eligible_facts:
    'No reviewed facts are available to analyze. Review some facts first — only reviewed facts can be approved for cloud analysis.',
  consent_required:
    'Cloud analysis needs your explicit approval of the exact payload first. Nothing was sent.',
  stale_consent:
    'The approved disclosure no longer matches this case (facts or evidence changed). Review and approve it again — nothing was sent.',
  already_analyzed:
    'This approved disclosure was already analyzed. Build a new preview if the evidence changed.',
  unexpected_source:
    'The response did not come from the cloud model as expected. It was discarded.',
  invalid_output:
    'The cloud response could not be read reliably, so no findings were kept. You can retry with the same approved payload.',
  offline: 'You appear to be offline. The approved payload was not sent.',
  quota: 'The cloud model is temporarily unavailable (usage limits). Try again later.',
  model_error: 'Cloud analysis failed. You can retry with the same approved payload.',
  cancelled:
    'Cloud analysis was cancelled. The approved payload was not sent again. Note: cancelling stops waiting — it cannot recall a request that already reached the provider.',
  not_found: 'This case or its approved disclosure is no longer on this device.',
  storage_error: 'Saving the analysis failed because of a local storage problem.',
  already_running: 'Cloud analysis is already running for this case.',
}

export function reconciliationError(code: ReconciliationErrorCode): ReconciliationError {
  return { code, message: MESSAGES[code] }
}

/* ------------------------------------------------------------------ */
/* Raw finding validation                                              */
/* ------------------------------------------------------------------ */

export interface FindingValidationResult {
  findings: ValidatedFinding[]
  /** Count dropped for structural reasons: bad shape, unverifiable citations, duplicates, over cap. */
  dropped: number
}

function normalizeFindingType(value: unknown): FindingType | null {
  return (FINDING_TYPES as readonly string[]).includes(value as string)
    ? (value as FindingType)
    : null
}

function normalizeEvidenceStatus(value: unknown): EvidenceStatus | null {
  return (FINDING_EVIDENCE_STATUSES as readonly string[]).includes(value as string)
    ? (value as EvidenceStatus)
    : null
}

/** Keeps only ids that exist in the approved payload; hallucinated ids vanish. */
function filterKnownIds(value: unknown, knownFactIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && knownFactIds.has(item) && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

/** Optional bounded string; invalid or overlong values become null, never truncated guesses. */
function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0 || text.length > max) return null
  return text
}

/**
 * Validates the cloud model's raw JSON findings against the contract.
 * A finding survives only if its shape, enums, text bounds, and citations
 * are all valid. Never throws — malformed output is data, not an exception.
 */
export function validateRawFindings(
  raw: unknown,
  knownFactIds: ReadonlySet<string>,
): FindingValidationResult {
  if (!Array.isArray(raw)) return { findings: [], dropped: 0 }

  const findings: ValidatedFinding[] = []
  const seen = new Set<string>()
  let dropped = 0

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      dropped += 1
      continue
    }
    const record = item as Record<string, unknown>

    const type = normalizeFindingType(record['type'])
    if (!type) {
      dropped += 1
      continue
    }
    const evidenceStatus = normalizeEvidenceStatus(record['evidenceStatus'])
    if (!evidenceStatus) {
      dropped += 1
      continue
    }

    const explanationRaw = typeof record['explanation'] === 'string' ? record['explanation'] : ''
    const explanation = explanationRaw.replace(/\s+/g, ' ').trim()
    if (explanation.length === 0 || explanation.length > EXPLANATION_MAX) {
      dropped += 1
      continue
    }

    const supportingFactIds = filterKnownIds(record['supportingFactIds'], knownFactIds)
    const conflictingFactIds = filterKnownIds(record['conflictingFactIds'], knownFactIds)

    // Citation rules: a finding must cite supplied facts it is about.
    // Contradictions additionally need at least one fact on each side.
    const citationsOk =
      type === 'contradiction'
        ? supportingFactIds.length > 0 && conflictingFactIds.length > 0
        : supportingFactIds.length > 0
    if (!citationsOk) {
      dropped += 1
      continue
    }

    const unresolvedQuestion = boundedString(record['unresolvedQuestion'], QUESTION_MAX)
    const draftText = boundedString(record['draftText'], DRAFT_MAX)
    if (type === 'draft_request' && draftText === null) {
      dropped += 1
      continue
    }

    const dedupeKey = `${type}::${explanation.toLowerCase()}`
    if (seen.has(dedupeKey)) {
      dropped += 1
      continue
    }
    if (findings.length >= MAX_FINDINGS) {
      dropped += 1
      continue
    }
    seen.add(dedupeKey)

    findings.push({
      type,
      evidenceStatus,
      explanation,
      unresolvedQuestion,
      draftText,
      supportingFactIds,
      conflictingFactIds,
    })
  }

  return { findings, dropped }
}

/* ------------------------------------------------------------------ */
/* Records + review transitions                                        */
/* ------------------------------------------------------------------ */

export interface FindingRecordContext {
  caseId: string
  caseRevision: number
  snapshotId: string
  model: string
  promptVersion: string
  inferenceSource: string
  now: number
}

/** Turns validated findings into persisted records (ids assigned by storage). */
export function createFindingRecords(
  validated: ValidatedFinding[],
  context: FindingRecordContext,
): Array<Omit<Finding, 'id'>> {
  return validated.map((finding) => ({
    caseId: context.caseId,
    caseRevision: context.caseRevision,
    type: finding.type,
    evidenceStatus: finding.evidenceStatus,
    explanation: finding.explanation,
    unresolvedQuestion: finding.unresolvedQuestion,
    draftText: finding.draftText,
    supportingFactIds: finding.supportingFactIds,
    conflictingFactIds: finding.conflictingFactIds,
    status: 'proposed',
    snapshotId: context.snapshotId,
    model: context.model,
    promptVersion: context.promptVersion,
    inferenceSource: context.inferenceSource,
    createdAt: context.now,
    updatedAt: context.now,
  }))
}

export type FindingAction = 'confirm' | 'reject' | 'restore'

/** Explicit review transitions; no-ops return the finding unchanged. */
export function applyFindingStatus(
  finding: Finding,
  action: FindingAction,
  now: number,
): Finding {
  let next: FindingReviewStatus
  switch (action) {
    case 'confirm':
      next = 'user_reviewed'
      break
    case 'reject':
      next = 'rejected'
      break
    case 'restore':
      next = finding.status === 'rejected' ? 'proposed' : finding.status
      break
  }
  if (next === finding.status) return finding
  return { ...finding, status: next, updatedAt: now }
}
