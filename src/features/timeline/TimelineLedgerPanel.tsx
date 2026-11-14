import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react'
import type { PaymentCase } from '../../domain/cases/case'
import type { EvidenceFact } from '../../domain/evidence'
import { formatMinorUnits } from '../../domain/evidence'
import type { TimelineResult } from '../../domain/timeline/timeline'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { useCaseAccount } from './useCaseAccount'

const KIND_LABELS: Record<EvidenceFact['kind'], string> = {
  agreement: 'Agreement',
  deliverable: 'Deliverable',
  commitment: 'Commitment',
  deadline: 'Deadline',
  delivery: 'Delivery',
  approval: 'Approval',
  invoice: 'Invoice / charge',
  payment: 'Payment',
  credit: 'Credit',
  dispute: 'Dispute',
  other: 'Other',
}

/**
 * Timeline + recorded-balance panel for one case.
 *
 * Everything shown is derived deterministically from reviewed facts —
 * no AI runs here, and every figure is labelled as a record of supplied
 * evidence, never a legal claim.
 */
export function TimelineLedgerPanel({ paymentCase }: { paymentCase: PaymentCase }) {
  const account = useCaseAccount(paymentCase)

  return (
    <section
      aria-labelledby="account-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="account-heading" className="text-lg font-semibold text-slate-900">
            Evidence account
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            A chronological account and recorded balance derived from your reviewed facts.
            Totals are <strong>based on reviewed supplied records</strong> — never a legal
            claim about what is owed.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void account.refresh()}>
          Refresh
        </Button>
      </div>

      {account.status === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Building the account from your facts…
        </p>
      )}

      {account.status === 'error' && (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
        >
          <p className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {account.errorMessage}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void account.refresh()}>
            Try again
          </Button>
        </div>
      )}

      {account.status === 'ready' && account.timeline && account.ledger && (
        <div className="mt-5 flex flex-col gap-8">
          <RecordedBalance ledger={account.ledger} />
          <TimelineView timeline={account.timeline} />
          <SignalsView ledger={account.ledger} />
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Recorded balance                                                    */
/* ------------------------------------------------------------------ */

function RecordedBalance({ ledger }: { ledger: NonNullable<ReturnType<typeof useCaseAccount>['ledger']> }) {
  if (!ledger.totals) {
    return (
      <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
        <p className="text-sm text-slate-700">
          No reviewed amounts yet. Review facts of kind <em>Invoice / charge</em>,{' '}
          <em>Payment</em>, or <em>Credit</em> to build a recorded balance.
        </p>
      </div>
    )
  }

  const { totals } = ledger
  const hasMismatch = ledger.mismatches.length > 0

  return (
    <div className="rounded-md border border-line px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recorded balance
        </h3>
        <Badge tone="neutral">{totals.currency}</Badge>
      </div>

      <p className="mt-3 text-3xl font-bold text-slate-900" data-testid="recorded-balance">
        {formatMinorUnits(totals.recordedBalance, totals.currency)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Based on reviewed supplied records · charges − payments − credits
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-surface-muted px-3 py-2">
          <dt className="text-xs text-slate-500">Charges</dt>
          <dd className="text-sm font-semibold text-slate-900">
            {formatMinorUnits(totals.charges, totals.currency)}
          </dd>
        </div>
        <div className="rounded-md bg-surface-muted px-3 py-2">
          <dt className="text-xs text-slate-500">Payments</dt>
          <dd className="text-sm font-semibold text-slate-900">
            {formatMinorUnits(totals.payments, totals.currency)}
          </dd>
        </div>
        <div className="rounded-md bg-surface-muted px-3 py-2">
          <dt className="text-xs text-slate-500">Credits</dt>
          <dd className="text-sm font-semibold text-slate-900">
            {formatMinorUnits(totals.credits, totals.currency)}
          </dd>
        </div>
      </dl>

      {ledger.entries.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {ledger.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-sm text-slate-800">
                <span className="font-medium">{KIND_LABELS[entry.fact.kind]}</span>
                {' — '}
                {entry.fact.statement}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={entry.kind === 'charge' ? 'neutral' : 'positive'}>
                  {entry.kind}
                </Badge>
                <span className="text-sm font-semibold text-slate-900">
                  {formatMinorUnits(entry.minorUnits, entry.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasMismatch && (
        <ul className="mt-4 flex flex-col gap-2">
          {ledger.mismatches.map((mismatch) => (
            <li
              key={`${mismatch.kind}-${mismatch.fact.id}`}
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {mismatch.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function TimelineView({ timeline }: { timeline: TimelineResult }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Evidence timeline
        </h3>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{timeline.includedCount} facts included</Badge>
          {timeline.uncertainCount > 0 && (
            <Badge tone="caution">{timeline.uncertainCount} date uncertain</Badge>
          )}
        </div>
      </div>

      {timeline.groups.length === 0 && (
        <p className="mt-3 text-sm text-slate-600">
          No facts yet. Reviewed facts with a parsed date appear here in order.
        </p>
      )}

      {timeline.groups.length > 0 && (
        <ol className="mt-3 flex flex-col gap-5">
          {timeline.groups.map((group) => (
            <li key={group.key}>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-slate-800">{group.label}</h4>
                <Badge tone="neutral">{group.precision}</Badge>
              </div>
              <ul className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-4">
                {group.entries.map((fact) => (
                  <li key={fact.id} className="rounded-md border border-line px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{KIND_LABELS[fact.kind]}</Badge>
                      {fact.amount && (
                        <Badge tone="neutral">
                          {formatMinorUnits(fact.amount.minorUnits, fact.amount.currency)}
                        </Badge>
                      )}
                      {fact.status === 'unresolved' && <Badge tone="caution">Unresolved</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-800">{fact.statement}</p>
                    {fact.date && fact.date.iso && (
                      <p className="mt-1 text-xs text-slate-500">
                        Date in source: “{fact.date.text}” (≈ {fact.date.iso})
                      </p>
                    )}
                    {group.precision === 'uncertain' && (
                      <p className="mt-1 text-xs text-slate-500">
                        Not placed on the timeline — the date could not be determined from
                        the source. Nothing was guessed.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Signals                                                            */
/* ------------------------------------------------------------------ */

function SignalsView({ ledger }: { ledger: NonNullable<ReturnType<typeof useCaseAccount>['ledger']> }) {
  if (ledger.signals.length === 0) return null

  const statusTone: Record<string, 'neutral' | 'accent' | 'caution'> = {
    supported: 'accent',
    not_found: 'caution',
    conflicting: 'caution',
    uncertain: 'neutral',
  }

  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Missing-evidence signals
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        These are observations about what your supplied records contain. Absence of a record
        never proves an event did not happen.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {ledger.signals.map((signal) => (
          <li
            key={signal.id}
            className="rounded-md border border-line bg-surface-muted px-3 py-2"
            data-testid="signal"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone[signal.evidenceStatus] ?? 'neutral'}>
                {signal.evidenceStatus === 'not_found'
                  ? 'Not found in supplied records'
                  : signal.evidenceStatus === 'supported'
                    ? 'Supported by supplied records'
                    : signal.evidenceStatus}
              </Badge>
              <Badge tone="neutral">{signal.rule}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-800">{signal.message}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
