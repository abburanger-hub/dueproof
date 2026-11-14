import { useState } from 'react'
import type { CaseDocument } from '../../domain/documents/document'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'

export interface DeleteDocumentDialogProps {
  document: CaseDocument
  confirm: () => Promise<{ ok: true } | { ok: false; error?: unknown }>
  onClose: () => void
}

/**
 * Destructive confirmation for removing a document from a case.
 * Removal deletes the original and all extracted blocks for it.
 */
export function DeleteDocumentDialog({ document, confirm, onClose }: DeleteDocumentDialogProps) {
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
      setFormError('Removing the document failed because of a local storage problem.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title="Remove document?"
      description={`This permanently removes "${document.displayName}", its original file, and its extracted text from this device. This cannot be undone.`}
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
            {submitting ? 'Removing…' : 'Remove permanently'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
