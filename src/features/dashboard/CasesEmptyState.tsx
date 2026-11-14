import { FolderOpen } from 'lucide-react'

/**
 * Empty state shown while the dashboard has no cases. Case creation arrives in
 * Phase 2; the action explains that instead of pretending to work.
 */
export function CasesEmptyState() {
  return (
    <section
      aria-labelledby="cases-heading"
      className="mx-auto w-full max-w-5xl"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="cases-heading" className="text-xl font-semibold text-slate-900">
          Your cases
        </h2>
      </div>

      <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-white px-6 py-12 text-center">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-slate-400"
        >
          <FolderOpen className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-4 font-medium text-slate-800">No payment cases yet</p>
        <p className="mt-1 max-w-md text-sm text-slate-600">
          A case holds the records for one client engagement — the quotation,
          approvals, invoice, and payment history you want to reconcile.
          Creating your first case arrives in the next development phase.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          Local workspace · your documents stay on this device
        </p>
      </div>
    </section>
  )
}
