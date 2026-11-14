import { useCallback, useEffect, useState } from 'react'
import type { CaseDocument } from '../../domain/documents/document'
import type { PaymentCase } from '../../domain/cases/case'
import {
  cancelProcessing,
  deleteDocument,
  getBlocks,
  importAndProcess,
  listDocuments,
  onProcessingProgress,
  reprocessDocument,
} from '../../application/documents/processing-service'
import { BLOCK_JOIN } from '../../domain/documents/blocks'
import type { SourceBlock } from '../../domain/documents/document'

export interface DocumentsState {
  documents: CaseDocument[]
  status: 'loading' | 'ready' | 'error'
  errorMessage: string | null
  /** documentId -> percent while a job is in flight. */
  progress: Record<string, number>
  pending: boolean
}

const LOAD_ERROR_MESSAGE =
  'Opening this case’s local documents failed. Your data is not lost — try again.'

/**
 * Loads and mutates a case's documents.
 *
 * The hook is the only UI-side owner of processing progress: it subscribes
 * once to the service's event stream and maps events for the current case's
 * documents. Imports read the picked File locally (ArrayBuffer) — the bytes
 * never leave the device.
 */
export function useDocuments(paymentCase: PaymentCase) {
  const [documents, setDocuments] = useState<CaseDocument[]>([])
  const [status, setStatus] = useState<DocumentsState['status']>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await listDocuments(paymentCase.id)
      setDocuments(rows)
      setStatus('ready')
      setErrorMessage(null)
    } catch {
      setStatus('error')
      setErrorMessage(LOAD_ERROR_MESSAGE)
    }
  }, [paymentCase.id])

  // Load documents for the selected case (external-system sync, guarded
  // against unmount/stale-case updates).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listDocuments(paymentCase.id)
        if (cancelled) return
        setDocuments(rows)
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
  }, [paymentCase.id])

  // Subscribe to processing progress while the case workspace is mounted.
  useEffect(() => {
    const unsubscribe = onProcessingProgress((event) => {
      setProgress((previous) => {
        // Re-fetch the list when a job finishes so state badges update.
        if (event.phase === 'done' || event.phase === 'failed' || event.phase === 'cancelled') {
          void refresh()
          const next = { ...previous }
          delete next[event.documentId]
          return next
        }
        return { ...previous, [event.documentId]: event.percent }
      })
    })
    return unsubscribe
  }, [refresh])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setPending(true)
      try {
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          await importAndProcess({
            caseId: paymentCase.id,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            bytes,
          })
        }
        await refresh()
      } finally {
        setPending(false)
      }
    },
    [paymentCase.id, refresh],
  )

  const retry = useCallback(
    async (documentId: string) => {
      await reprocessDocument(documentId)
    },
    [],
  )

  const cancel = useCallback(async (documentId: string) => {
    await cancelProcessing(documentId)
  }, [])

  const remove = useCallback(
    async (documentId: string) => {
      setPending(true)
      try {
        await deleteDocument(documentId)
        await refresh()
      } finally {
        setPending(false)
      }
    },
    [refresh],
  )

  const openViewer = useCallback(async (documentId: string) => {
    const blocks = (await getBlocks(documentId)) as SourceBlock[]
    const text = blocks.map((block) => block.text).join(BLOCK_JOIN)
    return { blocks, text }
  }, [])

  return {
    documents,
    status,
    errorMessage,
    progress,
    pending,
    refresh,
    importFiles,
    retry,
    cancel,
    remove,
    openViewer,
  }
}
