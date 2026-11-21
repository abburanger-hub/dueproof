import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Cloud,
  Eye,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { PaymentCase } from '../../domain/cases/case'
import type { EvidenceFact } from '../../domain/evidence'
import { buildSelectionState, sanitizeSelection } from '../../domain/privacy/consent-selection'
import { CONSENT_ISSUE_MESSAGES } from '../../application/privacy/consent-status-service'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { useReconciliation } from './useReconciliation'
import type { CloudReconciler } from '../../application/ports/cloud-reconciler'

const FINDING_TYPE_LABELS: Record<string, string> = {
  contradiction: 'Possible contradiction',
  gap: 'Missing evidence',
  clarification: 'Clarification to ask',
  draft_request: 'Draft message',
}

const EXCLUDED_LABELS: Record<string, string> = {
  unreviewed: 'Not reviewed yet',
  rejected: 'Rejected',
  sensitive: 'Contains possible identifiers',
  not_selected: 'Not selected',
}

/**
 * Cloud reconciliation panel — the consent-gated half of the hybrid AI.
 *
 * Three explicit steps, in order, with no shortcuts between them:
 * 1. Preview the exact payload (and what was excluded, and why).
 * 2. Approve it — approval is bound to those exact bytes.
 * 3. Run the analysis; findings arrive as proposals requiring review.
 */
export function ReconciliationPanel({
  paymentCase,
  reconciler,
}: {
  paymentCase: PaymentCase
  reconciler: CloudReconciler
}) {
  const reconciliation = useReconciliation(paymentCase, reconciler)
  const { previewState } = reconciliation

  const reviewedCount = useMemo(() => previewState.preview?.payload.facts.length ?? 0, [previewState])

  const [selectionOpen, setSelectionOpen] = useState(false)
  const [selectedFactIds, setSelectedFactIds] = useState<ReadonlySet<string> | null>(null)

  return (
    <section
      aria-labelledby="reconciliation-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reconciliation-heading" className="text-lg font-semibold text-slate-900">
            Cloud reconciliation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Optional deeper analysis in the cloud. Only reviewed facts <strong>you
            approve</strong> are sent — as pseudonymous records, never your original
            documents or quotes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            <Cloud className="h-3 w-3" aria-hidden="true" />
            {reviewedCount} facts approved for send
          </Badge>
        </div>
      </div>

      {reconciliation.actionError && (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
        >
          <p className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {reconciliation.actionError}
          </p>
          <Button variant="ghost" size="sm" onClick={reconciliation.dismissActionError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Step 1 — preview */}
      <div className="mt-5 rounded-md border border-line px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Eye className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Step 1 · Review exactly what would be sent
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={selectionOpen}
              onClick={() => setSelectionOpen((open) => !open)}
            >
              Choose facts
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void reconciliation.buildPreview()}
              disabled={previewState.status === 'building'}
            >
              {previewState.status === 'building' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Building…
                </>
              ) : (
                'Build preview'
              )}
            </Button>
          </div>
        </div>

        {selectionOpen && (
          <FactSelectionPanel
            caseId={paymentCase.id}
            currentSelection={selectedFactIds}
            onSelectionChange={(next) => {
              setSelectedFactIds(next)
              reconciliation.setIncludedFactIds(next)
            }}
          />
        )}

        {previewState.status === 'error' && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {previewState.errorMessage}
          </p>
        )}

        {/* Stale-consent surfacing: explain exactly what changed and what to do. */}
      {reconciliation.consentIssue && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            The approved disclosure is no longer valid.
          </p>
          <p className="mt-1 pl-6 text-sm text-amber-800">
            {CONSENT_ISSUE_MESSAGES[reconciliation.consentIssue]}
          </p>
          {reconciliation.consentChangedFactIds.length > 0 && (
            <p className="mt-1 pl-6 text-xs text-amber-700">
              Changed fact ids: {reconciliation.consentChangedFactIds.join(', ')}.
              Nothing was sent.
            </p>
          )}
        </div>
      )}

      {previewState.status === 'ready' && previewState.preview && previewState.payload && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-surface-muted px-3 py-2">
                <p className="text-xs text-slate-500">Included facts</p>
                <p className="text-sm font-semibold text-slate-900">
                  {previewState.payload.facts.length}
                </p>
              </div>
              <div className="rounded-md bg-surface-muted px-3 py-2">
                <p className="text-xs text-slate-500">Excluded facts</p>
                <p className="text-sm font-semibold text-slate-900">
                  {previewState.preview.excluded.length}
                </p>
              </div>
              <div className="rounded-md bg-surface-muted px-3 py-2">
                <p className="text-xs text-slate-500">Recorded balance sent</p>
                <p className="text-sm font-semibold text-slate-900">
                  {previewState.payload.recordedBalance
                    ? `${previewState.payload.recordedBalance.balance / 100} ${previewState.payload.currency}`
                    : 'None'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Exact payload
              </p>
              <pre className="mt-2 max-h-56 overflow-y-auto rounded-md border border-line bg-surface-muted p-3 text-xs leading-relaxed text-slate-800">
                {JSON.stringify(previewState.payload, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-slate-500">
                This is the complete content that would leave your device — no
                documents, quotes, filenames, or contact details are attached.
              </p>
            </div>

            {previewState.preview.excluded.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Excluded from the payload (stays on this device)
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {previewState.preview.excluded.map((excluded) => (
                    <li
                      key={excluded.fact.id}
                      className="rounded-md border border-line px-3 py-2 text-xs text-slate-700"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={excluded.reason === 'sensitive' ? 'caution' : 'neutral'}>
                          {EXCLUDED_LABELS[excluded.reason] ?? excluded.reason}
                        </Badge>
                        <span className="min-w-0 truncate text-slate-800">
                          {excluded.fact.statement}
                        </span>
                      </div>
                      {excluded.matches && excluded.matches.length > 0 && (
                        <p className="mt-1 text-slate-500">
                          Detected: {excluded.matches.map((match) => match.category).join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-slate-600">
              Pseudonymized is not anonymous: amounts, dates, and unusual details can
              still identify a client. Cloud processing uses Google's Gemini API
              under its data terms — approve only what you are comfortable sharing.
            </p>
          </div>
        )}
      </div>

      {/* Step 2 — approve */}
      {previewState.status === 'ready' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Step 2 · Approve this exact payload
          </p>
          <Button onClick={() => void reconciliation.approve()}>
            Approve and unlock analysis
          </Button>
        </div>
      )}

      {/* Step 3 — run */}
      {reconciliation.snapshot && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Sparkles className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Step 3 · Run the approved analysis
          </p>
          <Button onClick={() => void reconciliation.run()} disabled={reconciliation.running}>
            {reconciliation.running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Analyzing…
              </>
            ) : (
              <>
                <Cloud className="h-4 w-4" aria-hidden="true" />
                Run cloud analysis
              </>
            )}
          </Button>
        </div>
      )}

      {reconciliation.lastRun && (
        <p className="mt-3 text-xs text-slate-500">
          Last analysis: {reconciliation.lastRun.saved} finding(s) kept
          {reconciliation.lastRun.dropped > 0
            ? `, ${reconciliation.lastRun.dropped} unusable response(s) discarded`
            : ''}
          . Every finding is a proposal — review it before use.
        </p>
      )}

      {/* Findings */}
      {reconciliation.findingsStatus === 'loading' && (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Loading findings…
        </p>
      )}
      {reconciliation.findingsStatus === 'error' && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-800">{reconciliation.findingsErrorMessage}</p>
          <Button variant="secondary" size="sm" onClick={() => void reconciliation.refreshFindings()}>
            Try again
          </Button>
        </div>
      )}

      {reconciliation.findingsStatus === 'ready' && reconciliation.findings.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Findings — proposals from the cloud analysis
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {reconciliation.findings.map(({ finding, citedStatements }) => (
              <li
                key={finding.id}
                className="rounded-lg border border-line px-4 py-3"
                data-finding-status={finding.status}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{FINDING_TYPE_LABELS[finding.type] ?? finding.type}</Badge>
                  <Badge
                    tone={
                      finding.evidenceStatus === 'conflicting'
                        ? 'caution'
                        : finding.evidenceStatus === 'supported'
                          ? 'positive'
                          : 'neutral'
                    }
                  >
                    {finding.evidenceStatus === 'not_found'
                      ? 'Not found in supplied records'
                      : finding.evidenceStatus === 'supported'
                        ? 'Supported by supplied records'
                        : finding.evidenceStatus === 'conflicting'
                          ? 'Conflicting evidence'
                          : 'AI inference / uncertain'}
                  </Badge>
                  {finding.status === 'proposed' && <Badge tone="accent">Needs review</Badge>}
                  {finding.status === 'user_reviewed' && <Badge tone="positive">Reviewed</Badge>}
                </div>
                <p className="mt-2 text-sm text-slate-800">{finding.explanation}</p>
                {finding.unresolvedQuestion && (
                  <p className="mt-1 text-sm text-slate-600">
                    Question to ask: “{finding.unresolvedQuestion}”
                  </p>
                )}
                {finding.draftText && (
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted p-3 text-xs text-slate-800">
                    {finding.draftText}
                  </pre>
                )}
                {citedStatements.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-slate-600">
                      Cited facts ({citedStatements.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 pl-4">
                      {citedStatements.map((cited) => (
                        <li key={cited.factId} className="list-disc text-xs text-slate-600">
                          <span className="font-medium">{cited.kind}</span> — {cited.statement}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {finding.status === 'proposed' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void reconciliation.reviewFinding(finding.id, 'confirm')}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void reconciliation.reviewFinding(finding.id, 'reject')}
                      >
                        Discard
                      </Button>
                    </>
                  )}
                  {finding.status === 'rejected' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void reconciliation.reviewFinding(finding.id, 'restore')}
                    >
                      Restore
                    </Button>
                  )}
                  <span className="text-xs text-slate-400">
                    from case revision {finding.caseRevision} · model {finding.model}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reconciliation.findingsStatus === 'ready' && reconciliation.findings.length === 0 && (
        <p className="mt-6 text-sm text-slate-600">
          No findings yet. Approve a disclosure and run the analysis — findings appear
          here as reviewable proposals.
        </p>
      )}
    </section>
  )
}

export type { EvidenceFact }

/* ------------------------------------------------------------------ */
/* Per-fact selection (consent UI)                                     */
/* ------------------------------------------------------------------ */

const SENSITIVE_LABELS: Record<string, string> = {
  email: 'email address',
  phone: 'phone-like number',
  url: 'web link',
  pan_or_id: 'ID-like token',
  handle: 'social handle',
}

/**
 * Per-fact selection for the disclosure payload. Eligible facts only;
 * sensitive facts start unselected with the reason shown; including one is
 * an explicit, informed override the user makes per payload.
 */
function FactSelectionPanel({
  caseId,
  currentSelection,
  onSelectionChange,
}: {
  caseId: string
  currentSelection: ReadonlySet<string> | null
  onSelectionChange: (ids: ReadonlySet<string>) => void
}) {
  const [facts, setFacts] = useState<Array<{
    id: string
    kind: string
    statement: string
    status: string
    sensitiveCategories: string[]
  }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useMemo(
    () => async () => {
      try {
        const rows = await listCaseFacts(caseId)
        const state = buildSelectionState(rows.map((row) => row.fact))
        setFacts(
          state.selectable.map((entry) => ({
            id: entry.fact.id,
            kind: entry.fact.kind,
            statement: entry.fact.statement,
            status: entry.fact.status,
            sensitiveCategories: entry.sensitiveMatches.map((match) => match.category),
          })),
        )
        if (currentSelection === null) {
          onSelectionChange(state.defaultIncludedFactIds)
        }
      } catch {
        setError('Loading facts for selection failed. Try again.')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseId],
  )

  void useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  if (error) {
    return <p className="mt-3 text-sm text-amber-800">{error}</p>
  }
  if (facts === null) {
    return <p className="mt-3 text-sm text-slate-500">Loading eligible facts…</p>
  }
  if (facts.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-600">
        No reviewed facts are eligible yet. Review some facts first.
      </p>
    )
  }

  const selection = currentSelection ?? new Set<string>()
  const eligibleIds = new Set(facts.map((fact) => fact.id))
  const sanitized = sanitizeSelection(selection, eligibleIds)

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-muted px-4 py-4">
      <p className="text-sm font-semibold text-slate-800">
        Choose exactly which reviewed facts may be sent
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Sensitive-detected facts start unselected. Including one is your explicit,
        informed override for this payload only.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {facts.map((fact) => {
          const checked = sanitized.has(fact.id)
          const inputId = `fact-select-${fact.id}`
          return (
            <li key={fact.id} className="flex items-start gap-3 rounded-md border border-line bg-white px-3 py-2">
              <input
                id={inputId}
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = new Set(sanitized)
                  if (checked) next.delete(fact.id)
                  else next.add(fact.id)
                  onSelectionChange(next)
                }}
                className="mt-1 h-4 w-4"
              />
              <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{fact.kind}</Badge>
                  {fact.sensitiveCategories.length > 0 && (
                    <Badge tone="caution">
                      Possible: {fact.sensitiveCategories.map((c) => SENSITIVE_LABELS[c] ?? c).join(', ')}
                    </Badge>
                  )}
                </span>
                <span className="mt-1 block text-sm text-slate-800">{fact.statement}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
