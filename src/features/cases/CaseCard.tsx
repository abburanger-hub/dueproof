import type { PaymentCase } from '../../domain/cases/case'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { cn } from '../../shared/ui/lib/cn'

export interface CaseCardProps {
  paymentCase: PaymentCase
  /** Any operation is in flight; disables actions to prevent double-submits. */
  pending: boolean
  onRename: () => void
  onArchive: () => void
  onRestore: () => void
  onDeleteRequest: () => void
  /** Opens the case workspace (documents panel). */
  onOpen: () => void
  /** True when this case's workspace is currently shown. */
  isOpen: boolean
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/**
 * One case in the list. Shows what the record contains (title, description,
 * currency, revision) and offers the lifecycle actions. Never invents
 * progress or amounts — those arrive with later evidence phases.
 */
export function CaseCard({
  paymentCase,
  pending,
  onRename,
  onArchive,
  onRestore,
  onDeleteRequest,
  onOpen,
  isOpen,
}: CaseCardProps) {
  const archived = paymentCase.status === 'archived'

  return (
    <li
      className={cn(
        'rounded-lg border p-5 shadow-card',
        archived
          ? 'border-dashed border-line-strong bg-surface-muted'
          : isOpen
            ? 'border-accent/50 bg-white'
            : 'border-line bg-white',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            disabled={pending}
            className="text-left font-semibold text-slate-900 underline-offset-2 hover:underline disabled:opacity-60"
            aria-current={isOpen ? 'true' : undefined}
          >
            {paymentCase.title}
          </button>
          {paymentCase.description && (
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {paymentCase.description}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Updated {dateFormatter.format(paymentCase.updatedAt)} · Revision {paymentCase.revision}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {archived && <Badge tone="caution">Archived</Badge>}
          <Badge tone="neutral">{paymentCase.currency}</Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRename} disabled={pending}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Rename
        </Button>
        {archived ? (
          <Button variant="ghost" size="sm" onClick={onRestore} disabled={pending}>
            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
            Restore
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={pending}>
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            Archive
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeleteRequest}
          disabled={pending}
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </li>
  )
}
