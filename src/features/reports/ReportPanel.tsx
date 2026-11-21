/**
 * Report panel — the Phase 8 user surface.
 *
 * 1. Editable payment-request letter (seeded from the reviewed record).
 * 2. Compose: snapshots the reviewed record + the letter, labelled with the
 *    case revision so staleness is visible.
 * 3. Export: client-side PDF with a privacy warning before download.
 *
 * Honesty rules shown in the UI, not just the code:
 * - The balance is "based on reviewed supplied records".
 * - A stale snapshot (case revision moved) is labelled stale, never silently
 *   presented as current.
 * - The export warning says plainly that the file contains sensitive client
 *   information and leaves local storage when saved.
 */

import { AlertTriangle, FileDown, Loader2, RefreshCw, Save } from 'lucide-react'
import type { PaymentCase } from '../../domain/cases/case'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Field } from '../../shared/ui/field'
import { TextArea } from '../../shared/ui/input'
import { useReport } from './useReport'
import { LETTER_MAX } from '../../domain/reports/report'

export function ReportPanel({ paymentCase }: { paymentCase: PaymentCase }) {
  const report = useReport(paymentCase)
  const stale =
    report.composed !== null && report.composed.caseRevision !== paymentCase.revision

  if (report.status === 'loading') {
    return (
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-semibold text-slate-900">Payment request report</h2>
        <p className="mt-2 text-sm text-slate-500" role="status">
          Loading this case’s records…
        </p>
      </section>
    )
  }

  if (report.status === 'error') {
    return (
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-semibold text-slate-900">Payment request report</h2>
        <p className="mt-2 text-sm text-amber-800" role="alert">
          {report.errorMessage}
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="report-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="report-heading" className="text-lg font-semibold text-slate-900">
            Payment request report
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Compose an evidence-linked request from your reviewed records. The letter is
            yours — DueProof never sends it.
          </p>
        </div>
        {report.composed && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stale ? 'caution' : 'positive'}>
              {stale ? `Stale — evidence changed (rev ${report.composed.caseRevision} → ${paymentCase.revision})` : `Current · rev ${report.composed.caseRevision}`}
            </Badge>
          </div>
        )}
      </div>

      {/* Letter editor */}
      <div className="mt-5">
        <Field
          label="Payment request letter"
          htmlFor="report-letter"
          hint={`Editable. ${LETTER_MAX} characters max. Nothing is sent anywhere — export is your choice.`}
        >
          {(control) => (
            <TextArea
              {...control}
              rows={10}
              maxLength={LETTER_MAX}
              value={report.letter}
              onChange={(event) => report.setLetter(event.target.value)}
            />
          )}
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={report.seedTemplate}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Seed from reviewed record
          </Button>
          <Button onClick={() => void report.compose()} disabled={report.composing}>
            {report.composing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Composing…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                Compose report
              </>
            )}
          </Button>
        </div>
      </div>

      {report.exportError && (
        <p role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {report.exportError}
        </p>
      )}

      {/* Composed snapshot */}
      {report.composed && (
        <div className="mt-5 rounded-md border border-line px-4 py-4">
          <p className="text-sm font-semibold text-slate-800">Composed snapshot</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Facts included</dt>
              <dd className="font-semibold text-slate-800">{report.composed.facts.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Findings kept</dt>
              <dd className="font-semibold text-slate-800">{report.composed.findings.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Signals</dt>
              <dd className="font-semibold text-slate-800">{report.composed.signals.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Recorded balance</dt>
              <dd className="font-semibold text-slate-800">
                {report.composed.ledger.totals
                  ? `${report.composed.ledger.totals.recordedBalance / 100} ${report.composed.ledger.totals.currency}`
                  : 'None'}
              </dd>
            </div>
          </dl>
          {stale && (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              The case changed since this snapshot was composed (new evidence, edits, or
              analysis). Re-compose to reflect the current record — the export always
              uses the snapshot you reviewed.
            </p>
          )}
          <div className="mt-4">
            <Button
              onClick={() => void report.exportPdf()}
              disabled={report.exporting}
            >
              {report.exporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Generating PDF…
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                  Export PDF
                </>
              )}
            </Button>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The exported PDF contains sensitive client information and leaves this app's
            local storage the moment you save or share it. Generated on this device only.
          </p>
        </div>
      )}
    </section>
  )
}
