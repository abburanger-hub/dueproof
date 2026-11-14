import type { ReactNode } from 'react'
import { cn } from '../../shared/ui/lib/cn'

export interface AppShellProps {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/**
 * Application shell: a fixed maximum-width workspace column with a sticky
 * header. Every page renders inside this shell so spacing, chrome, and focus
 * behavior stay consistent across features.
 */
export function AppShell({ header, children, footer }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        {header}
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      {footer && <footer className={cn('border-t border-line')}>{footer}</footer>}
    </div>
  )
}
