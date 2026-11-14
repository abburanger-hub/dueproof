import type { LucideIcon } from 'lucide-react'
import { ClipboardList, FileSearch, Lock, MessagesSquare } from 'lucide-react'
import { Badge } from '../../shared/ui/badge'

interface Step {
  icon: LucideIcon
  title: string
  description: string
}

const steps: readonly Step[] = [
  {
    icon: ClipboardList,
    title: 'Bring your records together',
    description:
      'Add the quotation, approval messages, invoice, and payment records for one client engagement.',
  },
  {
    icon: FileSearch,
    title: 'Review extracted facts',
    description:
      'DueProof proposes amounts, dates, and commitments — each linked to its exact source — and you confirm or correct them.',
  },
  {
    icon: MessagesSquare,
    title: 'See what the records support',
    description:
      'Reconcile what was agreed, approved, delivered, and paid. Conflicts and missing evidence are surfaced, not hidden.',
  },
  {
    icon: Lock,
    title: 'Decide what leaves your device',
    description:
      'Documents are processed locally. Any cloud analysis shows you the exact approved payload first.',
  },
] as const

/** Explains the four-step workflow on the empty dashboard state. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading" className="mx-auto w-full max-w-5xl">
      <h2 id="how-it-works-heading" className="text-xl font-semibold text-slate-900">
        How DueProof works
      </h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-4 rounded-lg border border-line bg-white p-5 shadow-card"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-inset text-accent"
            >
              <step.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Badge tone="accent">Evidence-linked findings</Badge>
        <Badge tone="neutral">No document uploads by default</Badge>
        <Badge tone="caution">Not legal advice</Badge>
      </div>
    </section>
  )
}
