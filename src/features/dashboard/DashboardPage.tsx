import { Button } from '../../shared/ui/button'
import { CasesEmptyState } from './CasesEmptyState'
import { HowItWorks } from './HowItWorks'

/**
 * Landing/dashboard shell. Real case listing, review progress, and model
 * readiness arrive in Phase 2+; this Phase 1 slice establishes layout,
 * navigation, and the product's privacy promise.
 */
export function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <section aria-labelledby="welcome-heading">
        <p className="text-sm font-medium text-accent">Local evidence workspace</p>
        <h1 id="welcome-heading" className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Get clear on what you&apos;re owed.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          DueProof reconciles what was <strong className="font-semibold text-slate-800">agreed</strong>,{' '}
          <strong className="font-semibold text-slate-800">approved</strong>,{' '}
          <strong className="font-semibold text-slate-800">delivered</strong>, and{' '}
          <strong className="font-semibold text-slate-800">paid</strong> — from the
          records you already have, without uploading your client history.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button disabled title="Case creation arrives in the next development phase.">
            New payment case
          </Button>
          <Button variant="secondary" disabled title="Document import arrives after case management is implemented.">
            Add evidence
          </Button>
        </div>
      </section>

      <CasesEmptyState />
      <HowItWorks />
    </div>
  )
}
