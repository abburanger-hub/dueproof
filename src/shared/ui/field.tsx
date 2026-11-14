import type { ReactNode } from 'react'

/** Props handed to the control so ids and aria wiring stay correct. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export interface FieldProps {
  label: string
  /** The control's id; also used to derive hint/error ids. */
  htmlFor: string
  /** Helper text shown when there is no error. */
  hint?: string
  /** Validation error for this field, shown inline and wired to the control. */
  error?: string
  children: (control: FieldControlProps) => ReactNode
}

/**
 * Labeled form field wrapper.
 *
 * The render-prop hands the control its id, `aria-describedby`, and
 * `aria-invalid`, so label, hint, and error text are always correctly
 * associated with the input — including for screen readers.
 */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id: htmlFor,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
