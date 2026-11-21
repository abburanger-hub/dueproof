import { useState } from 'react'
import { AlertTriangle, Archive } from 'lucide-react'
import type { PaymentCase } from '../../domain/cases/case'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { CaseCard } from '../cases/CaseCard'
import { CaseFormDialog } from '../cases/CaseFormDialog'
import { DeleteCaseDialog } from '../cases/DeleteCaseDialog'
import { useCases } from '../cases/useCases'
import { DocumentsPanel } from '../documents/DocumentsPanel'
import { EvidencePanelWithDocuments } from '../evidence/EvidencePanelWithDocuments'
import { TimelineLedgerPanel } from '../timeline/TimelineLedgerPanel'
import { ReconciliationPanel } from '../reconciliation/ReconciliationPanel'
import { PrivacyPanel } from '../privacy/PrivacyPanel'
import { ReportPanel } from '../reports/ReportPanel'
import { CloudGeminiReconciler } from '../../infrastructure/ai/cloud/reconciler'
import { CasesEmptyState } from './CasesEmptyState'
import { HowItWorks } from './HowItWorks'

type DialogState =
  | { kind: 'create' }
  | { kind: 'rename'; paymentCase: PaymentCase }
  | { kind: 'delete'; paymentCase: PaymentCase }
  | null

/** Single shared cloud reconciler instance for the workspace. */
const cloudReconciler = new CloudGeminiReconciler()

/** A case selected for the workspace view (documents etc.). */
type SelectedCase = { paymentCase: PaymentCase } | null

/**
 * Dashboard: case management workspace.
 *
 * This slice is fully local — cases live in IndexedDB on this device and no
 * cloud service is involved. Document import, evidence extraction, and
 * analysis arrive in later phases; nothing here pretends otherwise.
 */
export function DashboardPage() {
  const {
    cases,
    status,
    errorMessage,
    actionError,
    pending,
    refresh,
    create,
    rename,
    archive,
    restore,
    remove,
    dismissActionError,
  } = useCases()

  const [dialog, setDialog] = useState<DialogState>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<SelectedCase>(null)

  const activeCases = cases.filter((c) => c.status === 'active')
  const archivedCases = cases.filter((c) => c.status === 'archived')

  /** Keep the workspace pointed at the current version of its case. */
  const selectedCase = selected
    ? cases.find((c) => c.id === selected.paymentCase.id) ?? null
    : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <section aria-labelledby="welcome-heading">
        <p className="text-sm font-medium text-accent">Local evidence workspace</p>
        <h1
          id="welcome-heading"
          className="mt-1 text-3xl font-bold tracking-tight text-slate-900"
        >
          Get clear on what you&apos;re owed.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          DueProof reconciles what was{' '}
          <strong className="font-semibold text-slate-800">agreed</strong>,{' '}
          <strong className="font-semibold text-slate-800">approved</strong>,{' '}
          <strong className="font-semibold text-slate-800">delivered</strong>, and{' '}
          <strong className="font-semibold text-slate-800">paid</strong> — from the records you
          already have, without uploading your client history.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={pending}>
            New payment case
          </Button>
          <Button
            variant="secondary"
            disabled
            title="Document import arrives in the next development phase."
          >
            Add evidence
          </Button>
        </div>
      </section>

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {actionError}
          </p>
          <Button variant="ghost" size="sm" onClick={dismissActionError}>
            Dismiss
          </Button>
        </div>
      )}

      {status === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {errorMessage}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}

      {status === 'loading' && (
        <div
          className="flex flex-col items-center gap-3 py-16 text-slate-500"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent"
          />
          <p className="text-sm">Opening your local case storage…</p>
        </div>
      )}

      {status === 'ready' && (
        <>
          <section aria-labelledby="cases-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="cases-heading" className="text-xl font-semibold text-slate-900">
                Your cases
              </h2>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{activeCases.length} active</Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDialog({ kind: 'create' })}
                  disabled={pending}
                >
                  New case
                </Button>
              </div>
            </div>

            {selectedCase && (
              <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
                <p className="text-sm font-medium text-slate-800">
                  Working in case: {selectedCase.title}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelected(null)}
                  >
                    Close case
                  </Button>
                </div>
              </div>
            )}

            {activeCases.length === 0 ? (
              <CasesEmptyState />
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {activeCases.map((paymentCase) => (
                  <CaseCard
                    key={paymentCase.id}
                    paymentCase={paymentCase}
                    pending={pending}
                    onRename={() => setDialog({ kind: 'rename', paymentCase })}
                    onArchive={() => void archive(paymentCase.id)}
                    onRestore={() => void restore(paymentCase.id)}
                    onDeleteRequest={() => setDialog({ kind: 'delete', paymentCase })}
                    onOpen={() => setSelected({ paymentCase })}
                    isOpen={selectedCase?.id === paymentCase.id}
                  />
                ))}
              </ul>
            )}
          </section>

          {selectedCase && (
            <div className="flex flex-col gap-6">
              <DocumentsPanel key={selectedCase.id} paymentCase={selectedCase} />
              <EvidencePanelWithDocuments paymentCase={selectedCase} />
              <TimelineLedgerPanel key={selectedCase.id} paymentCase={selectedCase} />
              <ReconciliationPanel key={selectedCase.id} paymentCase={selectedCase} reconciler={cloudReconciler} />
              <ReportPanel key={selectedCase.id} paymentCase={selectedCase} />
              <PrivacyPanel key={selectedCase.id} paymentCase={selectedCase} />
            </div>
          )}

          {archivedCases.length > 0 && (
            <section aria-labelledby="archived-cases-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="archived-cases-heading"
                  className="flex items-center gap-2 text-lg font-semibold text-slate-700"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Archived
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived ? 'Hide' : 'Show'} ({archivedCases.length})
                </Button>
              </div>
              {showArchived && (
                <ul className="mt-4 flex flex-col gap-3">
                  {archivedCases.map((paymentCase) => (
                  <CaseCard
                    key={paymentCase.id}
                    paymentCase={paymentCase}
                    pending={pending}
                    onRename={() => setDialog({ kind: 'rename', paymentCase })}
                    onArchive={() => void archive(paymentCase.id)}
                    onRestore={() => void restore(paymentCase.id)}
                    onDeleteRequest={() => setDialog({ kind: 'delete', paymentCase })}
                    onOpen={() => setSelected({ paymentCase })}
                    isOpen={selectedCase?.id === paymentCase.id}
                  />
                ))}
              </ul>
            )}
          </section>
          )}

          {activeCases.length === 0 && archivedCases.length === 0 && <HowItWorks />}
        </>
      )}

      {dialog?.kind === 'create' && (
        <CaseFormDialog mode="create" submit={create} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'rename' && (
        <CaseFormDialog
          mode="rename"
          initial={{
            title: dialog.paymentCase.title,
            description: dialog.paymentCase.description,
            currency: dialog.paymentCase.currency,
          }}
          submit={async (input) => rename(dialog.paymentCase.id, input)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteCaseDialog
          paymentCase={dialog.paymentCase}
          confirm={() => remove(dialog.paymentCase.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
