import { FolderOpen } from 'lucide-react'

/**
 * Empty state for the active-cases list. Case creation works in this slice,
 * so the copy invites the first case instead of explaining a missing feature.
 */
export function CasesEmptyState() {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-white px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-slate-400"
      >
        <FolderOpen className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-4 font-medium text-slate-800">No payment cases yet</p>
      <p className="mt-1 max-w-md text-sm text-slate-600">
        A case holds the records for one client engagement — the quotation, approvals, invoice,
        and payment history you want to reconcile. Create your first case to get started.
      </p>
      <p className="mt-4 text-xs text-slate-500">
        Local workspace · your documents stay on this device
      </p>
    </div>
  )
}
