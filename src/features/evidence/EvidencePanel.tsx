import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Quote,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import type { CaseDocument } from '../../domain/documents/document'
import type { PaymentCase } from '../../domain/cases/case'
import type { EvidenceFact, FactKind } from '../../domain/evidence'
import { formatMinorUnits } from '../../domain/evidence'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'
import { Field } from '../../shared/ui/field'
import { TextArea, TextInput } from '../../shared/ui/input'
import { useEvidence, type ExtractionRunState, type FactWithSourceState } from './useEvidence'
import type { LocalFactExtractor } from '../../application/ports/local-fact-extractor'
import type { EvidenceError } from '../../domain/evidence'
import { extractDocumentFacts } from '../../application/evidence/extraction-service'

export interface EvidencePanelProps {
  paymentCase: PaymentCase
  documents: CaseDocument[]
  extractor: LocalFactExtractor
}

const STATUS_LABELS: Record<EvidenceFact['status'], string> = {
  proposed: 'Needs review',
  user_reviewed: 'Reviewed',
  rejected: 'Rejected',
  disputed: 'Disputed',
  unresolved: 'Unresolved',
}

/**
 * Evidence review workspace for one case.
 *
 * Everything here is local and privacy-preserving: extraction runs through
 * the injected on-device extractor, facts are stored locally, and the user's
 * review is the only path from `proposed` to `user_reviewed`.
 */
export function EvidencePanel({ paymentCase, documents, extractor }: EvidencePanelProps) {
  const evidence = useEvidence(paymentCase, extractor, extractDocumentFacts)

  const [editing, setEditing] = useState<FactWithSourceState | null>(null)
  const [viewing, setViewing] = useState<FactWithSourceState | null>(null)

  const readyDocuments = useMemo(
    () => documents.filter((document) => document.processingState === 'ready'),
    [documents],
  )

  const proposedCount = evidence.facts.filter((f) => f.fact.status === 'proposed').length
  const reviewedCount = evidence.facts.filter((f) => f.fact.status === 'user_reviewed').length

  const runFor = (documentId: string): ExtractionRunState | null =>
    evidence.run?.documentId === documentId && evidence.run.phase === 'running'
      ? evidence.run
      : null

  return (
    <section
      aria-labelledby="evidence-facts-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="evidence-facts-heading" className="text-lg font-semibold text-slate-900">
            Evidence facts
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Candidate facts are extracted <strong>on this device only</strong>. Nothing is
            uploaded. You review each suggestion before it counts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {proposedCount > 0 && <Badge tone="accent">{proposedCount} to review</Badge>}
          {reviewedCount > 0 && <Badge tone="positive">{reviewedCount} reviewed</Badge>}
          {evidence.modelReadiness === 'unavailable' ? (
            <Badge tone="caution">On-device model unavailable</Badge>
          ) : evidence.modelReadiness === 'ready' ? (
            <Badge tone="positive">Model ready</Badge>
          ) : (
            <Badge tone="neutral">Model not checked</Badge>
          )}
        </div>
      </div>

      {evidence.modelReadiness !== 'ready' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-muted px-4 py-3">
          <p className="text-sm text-slate-700">
            On-device extraction needs the local model prepared once (Chrome downloads it on
            first use — a user click is required).
          </p>
          <Button
            onClick={() => void evidence.prepareModel()}
            disabled={evidence.preparing}
          >
            {evidence.preparing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparing… {evidence.prepareProgress !== null
                  ? `${Math.round(evidence.prepareProgress * 100)}%`
                  : ''}
              </>
            ) : (
              'Prepare on-device model'
            )}
          </Button>
        </div>
      )}

      {evidence.actionError && (
        <p
          role="alert"
          className="mt-3 flex items-start justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {evidence.actionError}
          </span>
          <Button variant="ghost" size="sm" onClick={evidence.dismissActionError}>
            Dismiss
          </Button>
        </p>
      )}

      {documents.length === 0 && (
        <p className="mt-4 text-sm text-slate-600">
          Import documents for this case first — facts are extracted from their text.
        </p>
      )}

      {readyDocuments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Extract with on-device AI
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {readyDocuments.map((document) => {
              const run = runFor(document.id)
              const isRunning = run !== null
              return (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-slate-800">
                    {document.displayName}
                  </span>
                  {isRunning && run ? (
                    <span className="flex items-center gap-3 text-xs text-slate-600">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      {run.processedBlocks}/{run.totalBlocks} blocks · {run.savedFacts} facts
                      <Button variant="ghost" size="sm" onClick={() => evidence.cancel(document.id)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void evidence.extract(document)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Extract facts
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {evidence.status === 'loading' && (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Loading this case’s facts…
        </p>
      )}

      {evidence.status === 'error' && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-800">{evidence.errorMessage}</p>
          <Button variant="secondary" size="sm" onClick={() => void evidence.refresh()}>
            Try again
          </Button>
        </div>
      )}

      {evidence.status === 'ready' && evidence.facts.length === 0 && (
        <p className="mt-4 text-sm text-slate-600">
          No facts yet. Extract suggestions on-device, or add facts manually — manual entry
          always works, even without the model.
        </p>
      )}

      {evidence.status === 'ready' && evidence.facts.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {evidence.facts.map((entry) => {
            const { fact, source, documentName } = entry
            const isProposed = fact.status === 'proposed'
            return (
              <li
                key={fact.id}
                className={
                  'rounded-lg border px-4 py-3 ' +
                  (isProposed ? 'border-accent/40 bg-accent/5' : 'border-line')
                }
                data-fact-status={fact.status}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isProposed ? 'accent' : 'neutral'}>{fact.kind}</Badge>
                      <Badge
                        tone={
                          fact.status === 'user_reviewed'
                            ? 'positive'
                            : fact.status === 'disputed'
                              ? 'caution'
                              : 'neutral'
                        }
                      >
                        {STATUS_LABELS[fact.status]}
                      </Badge>
                      {fact.amount && (
                        <Badge tone={fact.amount.currencyMismatch ? 'caution' : 'neutral'}>
                          {formatMinorUnits(fact.amount.minorUnits, fact.amount.currency)}
                          {fact.amount.ambiguous ? ' · ambiguous' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{fact.statement}</p>
                    {fact.date && (
                      <p className="mt-1 text-xs text-slate-600">
                        Date phrase: “{fact.date.text}”
                        {fact.date.iso ? ` (≈ ${fact.date.iso})` : ''} · precision: {fact.date.precision}
                      </p>
                    )}
                    {source ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Source: {documentName ?? 'document'}
                        {source.pageNumber !== null ? ` · page ${source.pageNumber}` : ''} · lines{' '}
                        {source.lineStart}–{source.lineEnd}
                        {fact.sourceVersion !== null ? ` · text v${fact.sourceVersion}` : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        {fact.manual ? 'Added manually' : 'Source no longer available'}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {fact.quote && (
                      <Button variant="ghost" size="sm" onClick={() => setViewing(entry)}>
                        <Quote className="h-3.5 w-3.5" aria-hidden="true" />
                        Quote
                      </Button>
                    )}
                    {isProposed && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void evidence.review(fact.id, 'confirm')}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void evidence.review(fact.id, 'reject')}
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Reject
                        </Button>
                      </>
                    )}
                    {fact.status !== 'proposed' && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(entry)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {viewing && (
        <Dialog
          onClose={() => setViewing(null)}
          title="Source quote"
          description="The exact excerpt this fact was extracted from, verified against the document text on this device."
        >
          <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted p-3 text-sm text-slate-800">
            {viewing.fact.quote}
          </pre>
          {viewing.source && (
            <p className="mt-2 text-xs text-slate-500">
              Matched at characters {viewing.fact.charStart}–{viewing.fact.charEnd} of the block
              {viewing.fact.normalizedMatch ? ' (whitespace-normalized match)' : ' (exact match)'}.
            </p>
          )}
        </Dialog>
      )}

      {editing && (
        <EditFactDialog
          entry={editing}
          onSave={async (input) => {
            const result = await evidence.edit(editing.fact.id, input)
            if (result.ok) setEditing(null)
            return result
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function EditFactDialog({
  entry,
  onSave,
  onClose,
}: {
  entry: FactWithSourceState
  onSave: (input: {
    statement: string
    amount: EvidenceFact['amount']
    date: EvidenceFact['date']
  }) => Promise<{ ok: boolean; error?: EvidenceError }>
  onClose: () => void
}) {
  const [statement, setStatement] = useState(entry.fact.statement)
  const [amountText, setAmountText] = useState(
    entry.fact.amount ? String(entry.fact.amount.minorUnits / 100) : '',
  )
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const amount = entry.fact.amount
    const parsedAmount = amountText.trim().length > 0 ? Number(amountText) : null
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setError('Enter a valid amount or leave it empty.')
      return
    }
    const result = await onSave({
      statement,
      amount:
        amount && parsedAmount !== null
          ? { ...amount, minorUnits: Math.round(parsedAmount * 100) }
          : amount,
      date: entry.fact.date,
    })
    if (!result.ok) setError(result.error?.message ?? 'Saving the fact failed.')
  }

  return (
    <Dialog
      onClose={onClose}
      title="Review fact"
      description="Editing a fact marks it as reviewed by you. The source quote stays unchanged."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Statement" htmlFor="edit-statement" hint="A short neutral restatement.">
          {(control) => (
            <TextArea
              {...control}
              rows={2}
              value={statement}
              maxLength={200}
              onChange={(event) => setStatement(event.target.value)}
            />
          )}
        </Field>
        {entry.fact.amount && (
          <Field
            label={`Amount (${entry.fact.amount.currency})`}
            htmlFor="edit-amount"
            hint="Correct the figure if the extraction read it wrong."
          >
            {(control) => (
              <TextInput
                {...control}
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
              />
            )}
          </Field>
        )}
        {entry.fact.kind as FactKind}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

