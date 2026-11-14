import { useEffect, useState } from 'react'
import type { CaseDocument, SourceBlock } from '../../domain/documents/document'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'
import { Select } from '../../shared/ui/input'

export interface DocumentViewerDialogProps {
  document: CaseDocument
  /** Loads the blocks + canonical text for the document. */
  open: () => Promise<{ blocks: SourceBlock[]; text: string }>
  onClose: () => void
}

const PAGE_SIZE = 5

/**
 * Read-only extracted-text viewer with source mapping.
 *
 * Shows the document's blocks in order, grouped by page (PDFs) with exact
 * line ranges, so the user can verify what was extracted and where each
 * piece of text came from. This is the "inspectable source" foundation the
 * later evidence-review phase cites.
 */
export function DocumentViewerDialog({ document, open, onClose }: DocumentViewerDialogProps) {
  const [blocks, setBlocks] = useState<SourceBlock[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [pageFilter, setPageFilter] = useState<number | 'all'>('all')

  // Loading IndexedDB is external-system synchronization: the async work
  // happens in the microtask, and the reset is derived in the async path
  // rather than set synchronously in the effect body.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setBlocks(null)
      setLoadError(false)
      try {
        const result = await open()
        if (cancelled) return
        setBlocks(result.blocks)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, document.id])

  const pages =
    blocks && blocks.length > 0
      ? Array.from(new Set(blocks.map((block) => block.pageNumber).filter((p): p is number => p !== null))).sort((a, b) => a - b)
      : []

  const visible =
    pageFilter === 'all'
      ? blocks ?? []
      : (blocks ?? []).filter((block) => block.pageNumber === pageFilter)

  const [rangeStart, setRangeStart] = useState(0)
  const rangeEnd = Math.min(rangeStart + PAGE_SIZE, visible.length)
  const windowed = visible.slice(rangeStart, rangeEnd)

  return (
    <Dialog
      onClose={onClose}
      title={`Extracted text — ${document.displayName}`}
      description="Verify what was read from this document. Each block keeps its page and line numbers for later evidence references."
    >
      <div className="flex max-h-[60vh] flex-col gap-3">
        {blocks === null && !loadError && (
          <p className="text-sm text-slate-500" role="status">
            Loading extracted text…
          </p>
        )}

        {loadError && (
          <p className="text-sm text-red-600" role="alert">
            Opening the extracted text failed. Close and try again.
          </p>
        )}

        {blocks !== null && blocks.length === 0 && (
          <p className="text-sm text-slate-600">
            No text was extracted. If this document is a scan, OCR arrives in a later
            phase.
          </p>
        )}

        {blocks !== null && blocks.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pages.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Page
                  <Select
                    aria-label="Filter blocks by page"
                    className="w-auto"
                    value={String(pageFilter)}
                    onChange={(event) => {
                      const value = event.target.value
                      setPageFilter(value === 'all' ? 'all' : Number(value))
                      setRangeStart(0)
                    }}
                  >
                    <option value="all">All pages</option>
                    {pages.map((page) => (
                      <option key={page} value={String(page)}>
                        Page {page}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <p className="text-xs text-slate-500">
                {visible.length} block{visible.length === 1 ? '' : 's'}
              </p>
            </div>

            <ol className="flex flex-col gap-2 overflow-y-auto pr-1">
              {windowed.map((block) => (
                <li key={block.id} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {block.pageNumber !== null ? `Page ${block.pageNumber} · ` : ''}
                    Lines {block.lineStart}–{block.lineEnd}
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-slate-800">
                    {block.text}
                  </pre>
                </li>
              ))}
            </ol>

            {visible.length > PAGE_SIZE && (
              <div className="flex items-center justify-between">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={rangeStart === 0}
                  onClick={() => setRangeStart(Math.max(0, rangeStart - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <p className="text-xs text-slate-500">
                  {rangeStart + 1}–{rangeEnd} of {visible.length}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={rangeEnd >= visible.length}
                  onClick={() => setRangeStart(rangeStart + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
