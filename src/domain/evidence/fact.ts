/**
 * Domain: evidence facts for a payment case.
 *
 * A fact is a candidate statement extracted from ONE source block (or entered
 * manually by the user). Facts are NEVER automatically financial truth:
 * - Every AI-proposed fact starts as `proposed` and requires user review.
 * - Quotes are exact excerpts; amounts and dates are parsed deterministically
 *   from the quote by application code, never by the model.
 * - Money is integer minor units. A fact records its currency; the case never
 *   mixes currencies in the ledger (Phase 5).
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

export const FACT_KINDS = [
  'agreement',
  'deliverable',
  'commitment',
  'deadline',
  'delivery',
  'approval',
  'invoice',
  'payment',
  'credit',
  'dispute',
  'other',
] as const

export type FactKind = (typeof FACT_KINDS)[number]

/**
 * Review lifecycle:
 * - proposed: suggested by on-device extraction, not yet reviewed.
 * - user_reviewed: the user checked the transcription/interpretation.
 * - rejected: not relevant or wrong.
 * - disputed: contradicted by other evidence or the user.
 * - unresolved: kept but explicitly marked open.
 */
export type FactStatus = 'proposed' | 'user_reviewed' | 'rejected' | 'disputed' | 'unresolved'

/** Dates are never forced to a false precision. */
export type DatePrecision = 'day' | 'month' | 'year' | 'ambiguous' | 'relative' | 'unresolved'

export interface FactAmount {
  /** Integer minor units (e.g. paise/cents). Never floating-point money. */
  minorUnits: number
  /** ISO-4217 code, uppercased. */
  currency: string
  /** True when the quote contained multiple money values — the user must pick. */
  ambiguous: boolean
  /** True when this currency differs from the case currency. */
  currencyMismatch: boolean
}

export interface FactDate {
  /** Verbatim text as it appears in the source. */
  text: string
  /** Normalized form when determinable: YYYY-MM-DD, YYYY-MM, or YYYY. */
  iso?: string
  precision: DatePrecision
}

export interface EvidenceFact {
  id: string
  caseId: string
  /** Null for manual facts that are not tied to a document. */
  documentId: string | null
  blockId: string | null
  kind: FactKind
  /** Short neutral summary (user-editable). */
  statement: string
  /** Exact excerpt copied from the source block; null for manual facts. */
  quote: string | null
  /** Offsets of the quote inside the block text. */
  charStart: number | null
  charEnd: number | null
  /** The quote was matched after whitespace normalization (citation adjusted). */
  normalizedMatch: boolean
  amount: FactAmount | null
  date: FactDate | null
  status: FactStatus
  /** Document textVersion at extraction time — used for staleness display. */
  sourceVersion: number | null
  /** True when the user created this fact manually. */
  manual: boolean
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const STATEMENT_MAX = 200
export const QUOTE_MAX = 400
/** Application cap per block — bounds output tokens for on-device calls. */
export const MAX_FACTS_PER_BLOCK = 4

/* ------------------------------------------------------------------ */
/* Safe error vocabulary (shared by the port, adapter, service, repo)  */
/* ------------------------------------------------------------------ */

export type EvidenceErrorCode =
  | 'model_unavailable'
  | 'unexpected_source'
  | 'invalid_output'
  | 'blocked'
  | 'cancelled'
  | 'not_ready'
  | 'not_found'
  | 'storage_error'
  | 'already_running'
  | 'validation_error'
  | 'extraction_failed'

export interface EvidenceError {
  code: EvidenceErrorCode
  message: string
}

const EVIDENCE_ERROR_MESSAGES: Record<EvidenceErrorCode, string> = {
  model_unavailable:
    'The on-device model is not available right now. Prepare it, or add facts manually. Nothing was sent to the cloud.',
  unexpected_source:
    'The response did not run on-device as required. It was discarded and nothing left this device.',
  invalid_output:
    'A suggestion from the on-device model could not be read reliably and was skipped.',
  blocked: 'A block of text was skipped by the model safety filter.',
  cancelled: 'Extraction was cancelled. Previously reviewed facts are unchanged.',
  not_ready: 'Extract text from this document first.',
  not_found: 'This document or fact is no longer on this device.',
  storage_error: 'Saving facts failed because of a local storage problem.',
  already_running: 'Extraction is already running for this document.',
  validation_error: 'Check the highlighted field and try again.',
  extraction_failed:
    'On-device extraction failed. You can retry, or add facts manually.',
}

export function evidenceError(code: EvidenceErrorCode): EvidenceError {
  return { code, message: EVIDENCE_ERROR_MESSAGES[code] }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function normalizeKind(kind: string): FactKind | null {
  const value = kind.trim().toLowerCase() as FactKind
  return (FACT_KINDS as readonly string[]).includes(value) ? value : null
}

export function validateStatement(statement: string): { ok: true; value: string } | { ok: false } {
  const value = statement.trim().replace(/\s+/g, ' ')
  if (value.length === 0 || value.length > STATEMENT_MAX) return { ok: false }
  return { ok: true, value }
}

export function validateQuoteText(quote: string): { ok: true; value: string } | { ok: false } {
  const value = quote.trim()
  if (value.length === 0 || value.length > QUOTE_MAX) return { ok: false }
  return { ok: true, value }
}

/* ------------------------------------------------------------------ */
/* Factories and transitions                                           */
/* ------------------------------------------------------------------ */

export interface ManualFactInput {
  id: string
  caseId: string
  kind: string
  statement: string
  amount: FactAmount | null
  date: FactDate | null
  createdAt: number
}

/** Manual facts are user-authored, so they start as user_reviewed. */
export function createManualFact(input: ManualFactInput):
  | { ok: true; fact: EvidenceFact }
  | { ok: false; error: EvidenceError } {
  const kind = normalizeKind(input.kind)
  if (!kind) {
    return {
      ok: false,
      error: { ...evidenceError('validation_error'), message: 'Choose a fact type.' },
    }
  }
  const statement = validateStatement(input.statement)
  if (!statement.ok) {
    return {
      ok: false,
      error: {
        ...evidenceError('validation_error'),
        message: `Keep the statement between 1 and ${STATEMENT_MAX} characters.`,
      },
    }
  }
  return {
    ok: true,
    fact: {
      id: input.id,
      caseId: input.caseId,
      documentId: null,
      blockId: null,
      kind,
      statement: statement.value,
      quote: null,
      charStart: null,
      charEnd: null,
      normalizedMatch: false,
      amount: input.amount,
      date: input.date,
      status: 'user_reviewed',
      sourceVersion: null,
      manual: true,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  }
}

export interface FactEditInput {
  statement: string
  amount: FactAmount | null
  date: FactDate | null
}

/**
 * Applying an edit means the user just reviewed this fact, so the status
 * becomes `user_reviewed`. Review means the transcription/interpretation was
 * checked — never that the source was authenticated.
 */
export function applyFactEdit(fact: EvidenceFact, input: FactEditInput, now: number):
  | { ok: true; fact: EvidenceFact }
  | { ok: false; error: EvidenceError } {
  const statement = validateStatement(input.statement)
  if (!statement.ok) {
    return {
      ok: false,
      error: {
        ...evidenceError('validation_error'),
        message: `Keep the statement between 1 and ${STATEMENT_MAX} characters.`,
      },
    }
  }
  return {
    ok: true,
    fact: {
      ...fact,
      statement: statement.value,
      amount: input.amount,
      date: input.date,
      status: 'user_reviewed',
      updatedAt: now,
    },
  }
}

export type FactAction = 'confirm' | 'reject' | 'dispute' | 'restore'

/** Explicit status transitions. */
export function nextStatusForAction(current: FactStatus, action: FactAction): FactStatus {
  switch (action) {
    case 'confirm':
      return 'user_reviewed'
    case 'reject':
      return 'rejected'
    case 'dispute':
      return 'disputed'
    case 'restore':
      return current === 'rejected' ? 'proposed' : current
  }
}

export function applyFactStatus(fact: EvidenceFact, action: FactAction, now: number): EvidenceFact {
  const next = nextStatusForAction(fact.status, action)
  if (next === fact.status) return fact
  return { ...fact, status: next, updatedAt: now }
}

