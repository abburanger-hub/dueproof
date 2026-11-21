/**
 * Application: report service — compose, persist, load, and export.
 *
 * The report snapshot is composed from the CURRENT reviewed record and the
 * user's edited letter, saved locally with the case revision it belongs to,
 * and rendered to PDF entirely client-side with pdf-lib.
 *
 * Privacy:
 * - The PDF is generated on this device from local data only.
 * - Before any export the UI shows a privacy warning: the file contains
 *   sensitive client information and leaves the app's local storage the
 *   moment the user saves/shares it.
 * - Exported PDFs cannot link into IndexedDB; the source index prints
 *   readable references (document name, page, lines) instead of fake links.
 */

import type { PaymentCase } from '../../domain/cases/case'
import type { EvidenceFact } from '../../domain/evidence'
import type { Finding } from '../../domain/reconciliation/finding'
import {
  composeReport,
  draftLetterTemplate,
  reportError,
  type PaymentRequestReport,
  type ReportError,
  type SourceMeta,
} from '../../domain/reports/report'
import {
  listCaseFacts,
  type FactWithSource,
} from '../../infrastructure/storage/fact-repository'
import { listFindings } from '../../infrastructure/storage/finding-repository'
import { buildLedger } from '../../domain/ledger/ledger'

/* ------------------------------------------------------------------ */
/* Snapshot persistence                                                */
/* ------------------------------------------------------------------ */

const snapshots = new Map<string, PaymentRequestReport>()

export type ReportResult<T> = { ok: true; value: T } | { ok: false; error: ReportError }

/** Composes and stores the report snapshot for a case. */
export async function composeAndSaveReport(input: {
  paymentCase: PaymentCase
  letter: string
}): Promise<ReportResult<PaymentRequestReport>> {
  let rows: FactWithSource[]
  let findings: Finding[]
  try {
    rows = await listCaseFacts(input.paymentCase.id)
    findings = (await listFindings(input.paymentCase.id)).map((row) => row.finding)
  } catch {
    return { ok: false, error: reportError('storage_error') }
  }

  const facts: EvidenceFact[] = rows.map((row) => row.fact)
  const sourceMetaById = new Map<string, SourceMeta>()
  for (const row of rows) {
    sourceMetaById.set(row.fact.id, {
      factId: row.fact.id,
      documentName: row.documentName,
      pageNumber: row.block?.pageNumber ?? null,
      lineStart: row.block?.lineStart ?? null,
      lineEnd: row.block?.lineEnd ?? null,
      sourceMissing: row.fact.blockId !== null && row.block === null,
    })
  }

  const composed = composeReport({
    paymentCase: input.paymentCase,
    facts,
    findings,
    sourceMetaById,
    letter: input.letter,
    now: Date.now(),
  })
  if (!composed.ok) return composed

  snapshots.set(input.paymentCase.id, composed.report)
  return { ok: true, value: composed.report }
}

/** Loads the stored snapshot for a case (in-memory for this MVP slice). */
export function loadReport(caseId: string): PaymentRequestReport | null {
  return snapshots.get(caseId) ?? null
}

/** Clears the stored snapshot (case closed / re-composition). */
export function clearReport(caseId: string): void {
  snapshots.delete(caseId)
}

/** Seeds the letter editor from the reviewed record. */
export function seedLetter(paymentCase: PaymentCase, facts: EvidenceFact[]): string {
  const recordedBalance = buildLedger(facts, paymentCase.currency).totals?.recordedBalance ?? null
  return draftLetterTemplate({
    title: paymentCase.title,
    currency: paymentCase.currency,
    recordedBalanceMinorUnits: recordedBalance,
  })
}

export { reportError }
