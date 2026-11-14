import { useCallback, useEffect, useState } from 'react'
import {
  renameCase,
  setCaseStatus,
  type CaseError,
  type PaymentCase,
} from '../../domain/cases/case'
import {
  deleteCase,
  getCase,
  listCases,
  saveNewCase,
  updateCase,
} from '../../infrastructure/storage/case-repository'

export type CasesStatus = 'loading' | 'ready' | 'error'

/** Result of a mutating case operation, mapped from the domain error shape. */
export type CaseOperationResult =
  | { ok: true; case?: PaymentCase }
  | { ok: false; error: CaseError }

const NOT_FOUND_MESSAGE = 'This case is no longer on this device.'
const LOAD_ERROR_MESSAGE =
  'Opening your local case storage failed. Your saved data is not lost — try again.'

function notFound(): CaseOperationResult {
  return { ok: false, error: { code: 'not_found', message: NOT_FOUND_MESSAGE } }
}

/**
 * Loads and mutates payment cases from local IndexedDB storage.
 *
 * Rules this hook enforces:
 * - Every operation goes through the domain layer (validation, revision
 *   bumps) before persistence — the UI never writes records directly.
 * - Driver errors surface as safe, human-readable messages; raw error text
 *   never reaches the UI or logs.
 * - Operations performed from a dialog (create/rename/delete) are "silent":
 *   the dialog owns error display. List-level actions (archive/restore)
 *   surface failures through `actionError`, shown as a banner.
 * - The list refreshes after every successful mutation.
 */
export function useCases() {
  const [cases, setCases] = useState<PaymentCase[]>([])
  const [status, setStatus] = useState<CasesStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await listCases()
      setCases(rows)
      setStatus('ready')
      setErrorMessage(null)
    } catch {
      setStatus('error')
      setErrorMessage(LOAD_ERROR_MESSAGE)
    }
  }, [])

  // Initial load synchronizes React with IndexedDB (an external system).
  // The cancellation guard prevents state updates after unmount.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const rows = await listCases()
        if (cancelled) return
        setCases(rows)
        setStatus('ready')
      } catch {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(LOAD_ERROR_MESSAGE)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (
      operation: () => Promise<CaseOperationResult>,
      options?: { silent?: boolean },
    ): Promise<CaseOperationResult> => {
      setPending(true)
      try {
        const result = await operation()
        if (result.ok) {
          setActionError(null)
          await refresh()
        } else if (!options?.silent) {
          setActionError(result.error.message)
        }
        return result
      } finally {
        setPending(false)
      }
    },
    [refresh],
  )

  const create = useCallback(
    (input: { title: string; description: string; currency: string }) =>
      run(() => saveNewCase(input), { silent: true }),
    [run],
  )

  const rename = useCallback(
    (id: string, input: { title: string; description: string }) =>
      run(
        async () => {
          const existing = await getCase(id)
          if (!existing) return notFound()
          const renamed = renameCase(existing, input, Date.now())
          if (!renamed.ok) return renamed
          return updateCase(renamed.case)
        },
        { silent: true },
      ),
    [run],
  )

  const setStatusById = useCallback(
    (id: string, next: 'active' | 'archived') =>
      run(async () => {
        const existing = await getCase(id)
        if (!existing) return notFound()
        const updated = setCaseStatus(existing, next, Date.now())
        if (!updated.ok) return updated
        return updateCase(updated.case)
      }),
    [run],
  )

  const remove = useCallback(
    (id: string) =>
      run(
        async () => {
          const result = await deleteCase(id)
          return result.ok ? { ok: true as const } : result
        },
        { silent: true },
      ),
    [run],
  )

  const archive = useCallback(
    (id: string) => setStatusById(id, 'archived'),
    [setStatusById],
  )

  const restore = useCallback(
    (id: string) => setStatusById(id, 'active'),
    [setStatusById],
  )

  const dismissActionError = useCallback(() => setActionError(null), [])

  return {
    cases,
    status,
    errorMessage,
    actionError,
    pending,
    refresh,
    create,
    rename,
    archive,
    restore,
    remove,
    dismissActionError,
  }
}
