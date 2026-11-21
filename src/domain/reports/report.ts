/**
 * Domain: report composition.
 *
 * A report is a SNAPSHOT of the reviewed record — composed from the case's
 * current reviewed facts, ledger, timeline, kept findings, and the user's
 * own request letter. Deterministic, local-only: no AI runs here, and the
 * composed result never leaves the device except through the user's own
 * export action.
 *
 * Honesty rules enforced here:
 * - Only `user_reviewed` / `unresolved` facts and non-rejected findings are
 *   included; proposed material is excluded, never silently promoted.
 * - The balance is labelled "based on reviewed supplied records".
 * - Every included fact keeps its source reference; a report fact without a
 *   resolvable source is labelled honestly instead of dropped silently.
 * - The letter is the user's editable text, stored verbatim.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import type { EvidenceFact } from '../evidence'
import type { Finding } from '../reconciliation/finding'
import { buildLedger, type LedgerResult, type MissingEvidenceSignal } from '../ledger/ledger'
import { buildTimeline, type TimelineResult } from '../timeline/timeline'
import type { PaymentCase } from '../cases/case'
import { formatMinorUnits } from '../evidence/format'

export const REPORT_SCHEMA = 'dueproof.report/v1'
export const LETTER_MAX = 4_000

/* ------------------------------------------------------------------ */
/* Source references                                                   */
/* ------------------------------------------------------------------ */

export interface ReportSourceRef {
  factId: string
  documentName: string | null
  pageNumber: number | null
  lineStart: number | null
  lineEnd: number | null
  /** True when the fact's cited source block no longer resolves. */
  sourceMissing: boolean
}

/* ------------------------------------------------------------------ */
/* Report model                                                        */
/* ------------------------------------------------------------------ */

export type ReportFact = Pick<
  EvidenceFact,
  'id' | 'kind' | 'statement' | 'amount' | 'date' | 'status'
> & { source: ReportSourceRef | null }

export type ReportFinding = Pick<
  Finding,
  'id' | 'type' | 'evidenceStatus' | 'explanation' | 'unresolvedQuestion' | 'status'
>

export interface PaymentRequestReport {
  schema: typeof REPORT_SCHEMA
  caseId: string
  caseRevision: number
  title: string
  currency: string
  composedAt: number
  /** Deterministic recorded balance, from the ledger. */
  ledger: LedgerResult
  timeline: TimelineResult
  facts: ReportFact[]
  findings: ReportFinding[]
  /** The user's editable request letter, stored verbatim. */
  letter: string
  signals: MissingEvidenceSignal[]
}

export interface SourceMeta {
  factId: string
  documentName: string | null
  pageNumber: number | null
  lineStart: number | null
  lineEnd: number | null
  sourceMissing: boolean
}

export type ReportErrorCode =
  | 'not_found'
  | 'letter_empty'
  | 'letter_too_long'
  | 'storage_error'

export interface ReportError {
  code: ReportErrorCode
  message: string
}

export function reportError(code: ReportErrorCode): ReportError {
  const messages: Record<ReportErrorCode, string> = {
    not_found: 'This case is no longer on this device.',
    letter_empty: 'Write the request letter before composing the report.',
    letter_too_long: `Keep the letter under ${LETTER_MAX} characters.`,
    storage_error: 'Saving the report failed because of a local storage problem.',
  }
  return { code, message: messages[code] }
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

export interface ComposeReportInput {
  paymentCase: PaymentCase
  facts: EvidenceFact[]
  findings: Finding[]
  sourceMetaById: ReadonlyMap<string, SourceMeta>
  letter: string
  now: number
}

/** Includes only reviewed/unresolved facts and kept findings. */
function includableFact(fact: EvidenceFact): boolean {
  return fact.status === 'user_reviewed' || fact.status === 'unresolved'
}

function includableFinding(finding: Finding): boolean {
  return finding.status !== 'rejected'
}

/**
 * Composes the report snapshot from the current reviewed record.
 * The ledger/timeline are derived here so the report can never disagree
 * with the live workspace views the user just reviewed.
 */
export function composeReport(input: ComposeReportInput):
  | { ok: true; report: PaymentRequestReport }
  | { ok: false; error: ReportError } {
  const letter = input.letter.trim()
  if (letter.length === 0) return { ok: false, error: reportError('letter_empty') }
  if (letter.length > LETTER_MAX) return { ok: false, error: reportError('letter_too_long') }

  const visibleFacts = input.facts.filter(includableFact)
  const ledger = buildLedger(input.facts, input.paymentCase.currency)
  const timeline = buildTimeline(input.facts)

  const reportFacts: ReportFact[] = visibleFacts.map((fact) => {
    const meta = input.sourceMetaById.get(fact.id)
    const source: ReportSourceRef | null = meta
      ? {
          factId: fact.id,
          documentName: meta.documentName,
          pageNumber: meta.pageNumber,
          lineStart: meta.lineStart,
          lineEnd: meta.lineEnd,
          sourceMissing: meta.sourceMissing,
        }
      : null
    return {
      id: fact.id,
      kind: fact.kind,
      statement: fact.statement,
      amount: fact.amount,
      date: fact.date,
      status: fact.status,
      source,
    }
  })

  const reportFindings: ReportFinding[] = input.findings
    .filter(includableFinding)
    .map((finding) => ({
      id: finding.id,
      type: finding.type,
      evidenceStatus: finding.evidenceStatus,
      explanation: finding.explanation,
      unresolvedQuestion: finding.unresolvedQuestion,
      status: finding.status,
    }))

  return {
    ok: true,
    report: {
      schema: REPORT_SCHEMA,
      caseId: input.paymentCase.id,
      caseRevision: input.paymentCase.revision,
      title: input.paymentCase.title,
      currency: input.paymentCase.currency,
      composedAt: input.now,
      ledger,
      timeline,
      facts: reportFacts,
      findings: reportFindings,
      letter,
      signals: ledger.signals,
    },
  }
}

/** Default letter template seeded from the reviewed record (fully editable). */
export function draftLetterTemplate(input: {
  title: string
  currency: string
  recordedBalanceMinorUnits: number | null
}): string {
  const lines = [
    'Subject: Request for clarification and payment — ' + input.title,
    '',
    'Hello,',
    '',
    'I am writing to share a summary of the records I hold for this engagement.',
    'Based on the supplied records reviewed to date, the recorded balance is ' +
      (input.recordedBalanceMinorUnits !== null
        ? `${formatMinorUnits(input.recordedBalanceMinorUnits, input.currency)} (${input.currency}).`
        : 'not yet determined from the reviewed records.'),
    '',
    'I would appreciate confirmation of the following:',
    '1. Whether the recorded balance matches your records.',
    '2. Any payments, credits, or corrections that should be reflected.',
    '',
    'Thank you for helping resolve this quickly.',
    '',
    'Best regards,',
  ]
  return lines.join('\n')
}
