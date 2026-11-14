import type { StoredOriginal } from '../storage/db'

/**
 * PDF text extraction — a thin, local-only wrapper over pdf.js.
 *
 * Hard boundaries (per the project's privacy architecture):
 * - The PDF bytes are read from local storage and processed locally by
 *   pdf.js running in a worker. Nothing is uploaded; there is no network
 *   path in this module at all.
 * - All failures map to the domain's safe error codes. Raw pdf.js error
 *   text/stacks never cross this boundary.
 * - Extraction is checkpointed page-by-page: onProgressPage reports each
 *   fully extracted page so the caller can persist a resumable checkpoint.
 * - Cancellation is cooperative: pass an AbortSignal and every stage checks
 *   it before doing more work.
 *
 * API verified against pdfjs-dist 6.5.438 type declarations: getDocument,
 * GlobalWorkerOptions.workerSrc, PDFDocumentProxy.numPages, page.getTextContent,
 * TextItem { str, hasEOL, transform, width, height }, PasswordException,
 * InvalidPDFException, and task.destroy().
 */

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  groupItemsIntoLines,
  buildBlocksFromLines,
  type BlockDraft,
  type NormalizedTextItem,
} from '../../domain/documents/blocks'
import { documentError, type DocumentError, MAX_PDF_PAGES } from '../../domain/documents/document'

let workerConfigured = false

/** Sets the worker source once; safe to call repeatedly. */
function configureWorker(): void {
  if (workerConfigured) return
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  workerConfigured = true
}

/** Narrow an unknown thrown value to a mapped document error. */
function toDocumentError(err: unknown): DocumentError {
  if (err instanceof Error && err.name === 'PasswordException') {
    return documentError('pdf_password')
  }
  if (err instanceof Error && err.name === 'InvalidPDFException') {
    return documentError('not_a_pdf')
  }
  if (err instanceof Error && err.name === 'MissingPDFException') {
    return documentError('not_a_pdf')
  }
  return documentError('extract_failed')
}

/** Minimal structural shape of a pdf.js TextItem we rely on. */
interface PdfTextItem {
  str: string
  hasEOL: boolean
  transform: Array<unknown>
  width: number
  height: number
}

/** Maps a pdf.js transform matrix + size to item position fields we use. */
function toNormalized(item: PdfTextItem): NormalizedTextItem {
  // transform = [a, b, c, d, e, f]; e/f are the x/y origin, d is the height
  // scale. See TextItem in pdfjs-dist types.
  const transform = item.transform
  const x = typeof transform[4] === 'number' ? transform[4] : 0
  const y = typeof transform[5] === 'number' ? transform[5] : 0
  const height = item.height > 0 ? item.height : typeof transform[3] === 'number' ? Math.abs(transform[3]) : 10
  const width = item.width > 0 ? item.width : 0
  return { str: item.str, hasEOL: item.hasEOL, x, y, width, height }
}

export interface PdfExtractResult {
  /** Number of pages in the document. */
  pageCount: number
  /** Pages that produced no text (likely scanned; OCR is a later phase). */
  pagesWithNoText: number
  /** Page-indexed block drafts. */
  blocksByPage: BlockDraft[][]
  /** Total characters of extracted text. */
  charCount: number
}

export interface PdfExtractCallbacks {
  /** Called once the page count is known, before page processing begins. */
  onLoaded?: (pageCount: number) => void
  /** Called after each page is fully extracted (checkpoint boundary). */
  onProgressPage?: (pageNumber: number) => void
}

/**
 * Extracts text and source blocks from a stored PDF original, page by page.
 * Cancellation and page-limit checks happen before each page.
 */
export async function extractPdfBlocks(
  original: StoredOriginal,
  options?: { signal?: AbortSignal },
  callbacks?: PdfExtractCallbacks,
): Promise<{ ok: true; result: PdfExtractResult } | { ok: false; error: DocumentError }> {
  configureWorker()

  const signal = options?.signal
  const bytes = original.bytes
  const task = pdfjs.getDocument({ data: bytes })

  let pdf: Awaited<typeof task.promise> | null = null
  try {
    pdf = await task.promise
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

    const pageCount = pdf.numPages
    if (pageCount > MAX_PDF_PAGES) {
      return { ok: false, error: documentError('pdf_pages_exceeded') }
    }
    callbacks?.onLoaded?.(pageCount)

    const blocksByPage: BlockDraft[][] = []
    let pagesWithNoText = 0
    let charCount = 0

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      // includeMarkedContent defaults to false, so every item here is a
      // TextItem; narrow defensively anyway — marked-content items have no
      // text and must be skipped, not trusted.
      const items = content.items.flatMap((item) => {
        if (typeof (item as { str?: unknown }).str !== 'string') return []
        const textItem = item as unknown as PdfTextItem
        return [toNormalized(textItem)]
      })

      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

      const lines = groupItemsIntoLines(items)
      const visibleLines = lines.filter((line) => line.text.trim().length > 0)
      if (visibleLines.length === 0) {
        pagesWithNoText += 1
      }
      const pageBlocks = buildBlocksFromLines(visibleLines, pageNumber)
      for (const block of pageBlocks) {
        charCount += block.text.length
      }
      blocksByPage.push(pageBlocks)
      callbacks?.onProgressPage?.(pageNumber)
    }

    return { ok: true, result: { pageCount, pagesWithNoText, blocksByPage, charCount } }
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'AbortException')) {
      return { ok: false, error: documentError('not_resumable') }
    }
    // Work around a pdf.js quirk: abandoning a loading task can surface as a
    // generic Error wrapping AbortException; treat transport-teardown noise
    // as cancellation rather than a hard failure.
    if (err instanceof Error && /abort/i.test(err.message)) {
      return { ok: false, error: documentError('not_resumable') }
    }
    return { ok: false, error: toDocumentError(err) }
  } finally {
    // Always release the loading task (which tears down the worker-side
    // document). The installed 6.x types expose destroy() on the loading
    // task, not on the proxy.
    await task.destroy().catch(() => undefined)
  }
}
