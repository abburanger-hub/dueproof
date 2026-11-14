import { useState } from 'react'
import type { PaymentCase } from '../../domain/cases/case'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'
import type { CaseOperationResult } from './useCases'

export interface DeleteCaseDialogProps {
  paymentCase: PaymentCase
  /** Performs the delete; resolves with the operation result. */
  confirm: () => Promise<CaseOperationResult>
  onClose: () => void
}

/**
 * Destructive-action confirmation for case deletion.
 *
 * Deletion removes the case record from this device. The copy is explicit
 * that this is permanent and local — no scare tactics, no dark patterns,
 * and the destructive button is clearly labeled as such.
 */
export function DeleteCaseDialog({ paymentCase, confirm, onClose }: DeleteCaseDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await confirm()
      if (result.ok) {
        onClose()
        return
      }
      setFormError(result.error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title="Delete case?"
      description={`This permanently removes "${paymentCase.title}" and its record from this device. This cannot be undone.`}
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {formError}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-red-600 text-white hover:bg-red-700 active:bg-red-700 disabled:hover:bg-red-600"
          >
            {submitting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
