import { useState, type FormEvent } from 'react'
import {
  DESCRIPTION_MAX,
  SUPPORTED_CURRENCIES,
  TITLE_MAX,
} from '../../domain/cases/case'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'
import { Field } from '../../shared/ui/field'
import { Select, TextArea, TextInput } from '../../shared/ui/input'
import type { CaseOperationResult } from './useCases'

export interface CaseFormDialogProps {
  mode: 'create' | 'rename'
  /** Prefilled values; rename mode passes the existing case's content. */
  initial?: { title: string; description: string; currency: string }
  submit: (
    input: { title: string; description: string; currency: string },
  ) => Promise<CaseOperationResult>
  onClose: () => void
}

type FieldErrors = Partial<Record<'title' | 'description' | 'currency', string>>

const CURRENCY_LABELS: Record<string, string> = {
  INR: 'INR — Indian Rupee',
  USD: 'USD — US Dollar',
  EUR: 'EUR — Euro',
  GBP: 'GBP — British Pound',
}

/**
 * Create/rename case form.
 *
 * Validation is owned by the domain layer: this dialog submits, maps the
 * returned field errors to the correct inputs, and shows storage failures
 * inline. It closes only on success.
 */
export function CaseFormDialog({ mode, initial, submit, onClose }: CaseFormDialogProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'INR')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isCreate = mode === 'create'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const result = await submit({ title, description, currency })
      if (result.ok) {
        onClose()
        return
      }

      const { error } = result
      const nextErrors: FieldErrors = {}
      if (error.field === 'title') nextErrors.title = error.message
      else if (error.field === 'description') nextErrors.description = error.message
      else if (error.field === 'currency') nextErrors.currency = error.message

      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors)
      } else {
        setFormError(error.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title={isCreate ? 'New payment case' : 'Rename case'}
      description={
        isCreate
          ? 'A case holds the records for one client engagement — quotation, approvals, invoice, and payments.'
          : 'Update the title and description. Everything else stays unchanged.'
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label="Case title"
          htmlFor="case-form-title"
          hint={`A short name you recognize. Up to ${TITLE_MAX} characters.`}
          error={fieldErrors.title}
        >
          {(control) => (
            <TextInput
              {...control}
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              autoComplete="off"
              placeholder="e.g. Acme website — final milestone"
              disabled={submitting}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Description (optional)"
          htmlFor="case-form-description"
          hint={`Up to ${DESCRIPTION_MAX} characters.`}
          error={fieldErrors.description}
        >
          {(control) => (
            <TextArea
              {...control}
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX}
              placeholder="What this engagement is about, e.g. final payment for the website redesign."
              disabled={submitting}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        {isCreate && (
          <Field
            label="Case currency"
            htmlFor="case-form-currency"
            hint="One currency per case. Used when amounts are reviewed in later steps."
            error={fieldErrors.currency}
          >
            {(control) => (
              <Select
                {...control}
                value={currency}
                disabled={submitting}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {CURRENCY_LABELS[code] ?? code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {formError && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {formError}
          </p>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isCreate ? 'Create case' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
