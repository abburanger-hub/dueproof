/**
 * Document processing service — orchestrates local-only extraction with
 * progress, cancellation, and resumable checkpoints.
 *
 * One job per document at a time (an application-level limit, chosen to
 * keep the UI responsive and make cancellation deterministic). The service:
 * 1. marks the record `processing`,
 * 2. extracts (PDF.js for PDFs, UTF-8 decode for text),
 * 3. persists blocks + ready state atomically,
 * 4. reports progress through registered listeners,
 * 5. maps every failure to a safe error and leaves the record resumable.
 *
 * No network path exists anywhere in this module.
 */

import {
  buildBlocksFromText,
} from '../../domain/documents/blocks'
import {
  beginProcessing,
  type CaseDocument,
  type DocumentError,
  documentError,
  isResumable,
  markCancelled,
  markFailed,
} from '../../domain/documents/document'
import { extractPdfBlocks } from '../../infrastructure/documents/pdf-extractor'
import { decodeTextBytes } from '../../infrastructure/documents/text-decoder'
import {
  deleteDocument,
  getBlocks,
  getDocument,
  getOriginal,
  importDocument,
  listDocuments,
  saveExtraction,
  updateDocumentRecord,
  type BlockLike,
} from '../../infrastructure/storage/document-repository'

export interface ProgressEvent {
  documentId: string
  /** 0–100, derived from pages for PDFs; coarse for text files. */
  percent: number
  phase: 'preparing' | 'extracting' | 'saving' | 'done' | 'failed' | 'cancelled'
}

type Listener = (event: ProgressEvent) => void

const listeners = new Set<Listener>()

/** Subscribe to processing progress; returns an unsubscribe function. */
export function onProcessingProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: ProgressEvent): void {
  for (const listener of listeners) listener(event)
}

/** In-flight jobs, so a document is never processed twice concurrently. */
const active = new Map<string, { controller: AbortController }>()

export interface ImportOutcome {
  ok: boolean
  document?: CaseDocument
  /** Set when an identical file already exists in the case. */
  duplicateOf?: string
  error?: DocumentError
}

/** Imports a file (validates + stores original) then starts processing. */
export async function importAndProcess(input: {
  caseId: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}): Promise<ImportOutcome> {
  const imported = await importDocument(input)
  if (!imported.ok) return { ok: false, error: imported.error }

  void processDocument(imported.document.id).catch(() => undefined)
  return {
    ok: true,
    document: imported.document,
    duplicateOf: imported.duplicateOf,
  }
}

/** Processes (or resumes) one document. Safe to call repeatedly. */
export async function processDocument(documentId: string): Promise<void> {
  const existing = active.get(documentId)
  if (existing) return // already running

  const record = await getDocument(documentId)
  if (!record) return
  if (!isResumable(record.processingState)) return

  const controller = new AbortController()
  active.set(documentId, { controller })

  const started = beginProcessing(record, Date.now())
  await updateDocumentRecord(started)
  emit({ documentId, percent: 0, phase: 'preparing' })

  try {
    if (started.kind === 'text') {
      const original = await getOriginal(documentId)
      if (!original) throw documentError('not_found')

      emit({ documentId, percent: 30, phase: 'extracting' })
      const decoded = decodeTextBytes(original.bytes)
      if (!decoded.ok) throw decoded.error
      if (controller.signal.aborted) throw documentError('not_resumable')

      const blocks = buildBlocksFromText(decoded.result.text)
      emit({ documentId, percent: 70, phase: 'saving' })
      const saved = await saveExtraction(
        documentId,
        blocks as BlockLike[],
        { pageCount: null, pagesWithNoText: 0, charCount: decoded.result.text.length },
      )
      if (!saved.ok) throw saved.error

      emit({ documentId, percent: 100, phase: 'done' })
    } else {
      const original = await getOriginal(documentId)
      if (!original) throw documentError('not_found')

      let lastPercent = 0
      let total = 0

      const result = await extractPdfBlocks(
        original,
        { signal: controller.signal },
        {
          onLoaded: (pageCount) => {
            total = pageCount
            emit({ documentId, percent: 2, phase: 'extracting' })
          },
          onProgressPage: (pageNumber) => {
            const safeTotal = Math.max(total, pageNumber)
            const percent = Math.min(80, Math.round((pageNumber / safeTotal) * 100))
            if (percent > lastPercent) {
              lastPercent = percent
              emit({ documentId, percent, phase: 'extracting' })
            }
          },
        },
      )
      if (!result.ok) throw result.error

      emit({ documentId, percent: 80, phase: 'saving' })
      const blocks = result.result.blocksByPage.flat().map((block) => ({
        ...block,
      })) as BlockLike[]
      const saved = await saveExtraction(documentId, blocks, {
        pageCount: result.result.pageCount,
        pagesWithNoText: result.result.pagesWithNoText,
        charCount: result.result.charCount,
      })
      if (!saved.ok) throw saved.error

      emit({ documentId, percent: 100, phase: 'done' })
    }
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.name === 'AbortException')

    if (isAbort || (controller.signal.aborted && isDocumentError(err) && err.code === 'not_resumable')) {
      const current = await getDocument(documentId)
      if (current) {
        await updateDocumentRecord(markCancelled(current, Date.now()))
        emit({ documentId, percent: 0, phase: 'cancelled' })
      }
      return
    }

    const error = isDocumentError(err) ? err : documentError('extract_failed')
    const current = await getDocument(documentId)
    if (current) {
      await updateDocumentRecord(markFailed(current, error.code, Date.now()))
    }
    emit({ documentId, percent: 0, phase: 'failed' })
  } finally {
    active.delete(documentId)
  }
}

function isDocumentError(err: unknown): err is DocumentError {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
  )
}

/** Cancels an in-flight job; the record becomes resumable again. */
export async function cancelProcessing(documentId: string): Promise<void> {
  const job = active.get(documentId)
  if (!job) return
  job.controller.abort()
}

/** Re-runs processing for a document with existing blocks (drift repair). */
export async function reprocessDocument(documentId: string): Promise<void> {
  const record = await getDocument(documentId)
  if (!record) return
  if (record.processingState === 'processing') return
  const reset = markCancelled(record, Date.now())
  await updateDocumentRecord(reset)
  await processDocument(documentId)
}

export {
  deleteDocument,
  getBlocks,
  getDocument,
  listDocuments,
}
