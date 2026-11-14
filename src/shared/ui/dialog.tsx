import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface DialogProps {
  onClose: () => void
  title: string
  /** Optional explanatory text under the title. */
  description?: string
  children: ReactNode
  /** Action row (buttons). Rendered bottom-right. */
  footer?: ReactNode
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Minimal accessible modal dialog.
 *
 * - role="dialog" + aria-modal, labelled by its title.
 * - Escape closes; clicking the overlay closes.
 * - Focus moves into the dialog on mount and returns to the trigger on close.
 * - Tab / Shift+Tab cycle within the dialog (focus trap).
 *
 * Parents mount/unmount this component to open/close, which resets any
 * internal form state naturally. No third-party dependency is needed at this
 * scale; if component needs grow, this can be swapped for a maintained
 * dialog primitive behind the same interface.
 */
export function Dialog({ onClose, title, description, children, footer }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)

  // Keep the close handler current without re-running the mount effect.
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const panel = panelRef.current
    if (panel) {
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      const first = focusable[0]
      if (first) {
        first.focus()
      } else {
        panel.focus()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const current = panelRef.current
      if (!current) {
        return
      }
      const focusable = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        current.focus()
        return
      }
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        // Only a direct click on the overlay closes; clicks inside the panel
        // (including text selections that end outside it) must not.
        if (event.target === event.currentTarget) {
          onCloseRef.current()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="my-auto w-full max-w-lg rounded-lg border border-line bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-surface-muted hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">{children}</div>

        {footer && (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
