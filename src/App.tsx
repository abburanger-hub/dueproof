import { AppShell } from './app/layout/AppShell'
import { Logo, LocalOnlyBadge } from './app/layout/Logo'
import { DashboardPage } from './features/dashboard/DashboardPage'

/**
 * Phase 1 application entry: shell + dashboard placeholder.
 * Routing, persistence, and AI integration are added in later phases.
 */
export default function App() {
  return (
    <AppShell
      header={
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-3">
            <LocalOnlyBadge />
          </div>
        </div>
      }
      footer={
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <p>
            DueProof organizes evidence you supply. It does not provide legal
            advice or guarantee payment.
          </p>
          <p>Early development build</p>
        </div>
      }
    >
      <DashboardPage />
    </AppShell>
  )
}
