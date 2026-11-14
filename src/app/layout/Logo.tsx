import { cn } from '../../shared/ui/lib/cn'
import { Badge } from '../../shared/ui/badge'

/**
 * Wordmark. Rendered as a span, not a heading, so the page heading hierarchy
 * stays with actual content headings.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white"
      >
        DP
      </span>
      <span className="text-lg font-semibold tracking-tight text-slate-900">
        DueProof
      </span>
    </span>
  )
}

/** Status chip describing AI runtime readiness. Placeholder until Phase 4. */
export function LocalOnlyBadge() {
  return (
    <Badge tone="neutral" title="Originals never leave your device by default.">
      Local-first
    </Badge>
  )
}
