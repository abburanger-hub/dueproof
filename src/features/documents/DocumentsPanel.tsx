import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { CaseDocument } from '../../domain/documents/document'
import type { PaymentCase } from '../../domain/cases/case'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { useDocuments } from './useDocuments'
import { DocumentViewerDialog } from './DocumentViewerDialog'
import { DeleteDocumentDialog } from './DeleteDocumentDialog'

/**
 * Case workspace: document import, processing, and review for one case.
 *
 * Everything here is local: files are read in-browser, originals are stored
 * in IndexedDB, extraction runs through pdf.js in a worker. No AI, no
 * network. The panel is shown for the currently selected case.
 */
export function DocumentsPanel({ paymentCase }: { paymentCase: PaymentCase }) {
  const {
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
  } = useDocuments(paymentCase)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [viewer, setViewer] = useState<CaseDocument | null>(null)
  const [deleting, setDeleting] = useState<CaseDocument | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setNotice(null)
    await importFiles(Array.from(files))
  }

  return (
    <section
      aria-labelledby="evidence-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="evidence-heading" className="text-lg font-semibold text-slate-900">
            Evidence documents
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Import the records for this case — PDFs and text files are read on this
            device. Nothing is uploaded.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={pending}>
          Import files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {notice && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </p>
      )}

      {status === 'loading' && (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Opening this case’s local documents…
        </p>
      )}

      {status === 'error' && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-800">{errorMessage}</p>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}

      {status === 'ready' && documents.length === 0 && (
        <div
          className={
            'mt-4 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ' +
            (dragOver ? 'border-accent bg-accent/5' : 'border-line-strong bg-surface-muted')
          }
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void handleFiles(event.dataTransfer.files)
          }}
        >
          <p className="font-medium text-slate-800">No documents in this case yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Drag PDFs or text files here, or use “Import files”. Quotation, invoice,
            approval messages, delivery notes, payment records — anything that helps
            reconstruct what happened.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            PDF up to 25 MB / 100 pages · text up to 500,000 characters · local only
          </p>
        </div>
      )}

      {status === 'ready' && documents.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {documents.map((document) => {
            const percent = progress[document.id]
            const isWorking = document.processingState === 'processing'
            return (
              <li
                key={document.id}
                className="rounded-lg border border-line px-4 py-3"
                data-document-state={document.processingState}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-slate-400">
                      {document.kind === 'pdf' ? (
                        <FileText className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <FileText className="h-5 w-5" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {document.displayName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {document.kind.toUpperCase()}
                        {' · '}
                        {(document.byteSize / 1024).toFixed(0)} KB
                        {document.pageCount ? ` · ${document.pageCount} pages` : ''}
                        {document.processingState === 'ready' && document.blockCount > 0
                          ? ` · ${document.blockCount} blocks`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {document.processingState === 'ready' && (
                      <Badge tone="positive">Extracted</Badge>
                    )}
                    {document.processingState === 'failed' && (
                      <Badge tone="caution">Failed</Badge>
                    )}
                    {document.processingState === 'cancelled' && (
                      <Badge tone="neutral">Cancelled</Badge>
                    )}

                    {isWorking ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          {typeof percent === 'number' ? `${percent}%` : 'Starting…'}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => void cancel(document.id)}>
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {document.processingState === 'ready' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewer(document)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            View text
                          </Button>
                        )}
                        {(document.processingState === 'failed' ||
                          document.processingState === 'cancelled') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void retry(document.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            Retry
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleting(document)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {(isWorking || document.processingState === 'failed') && (
                  <div className="mt-2">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
                      role="progressbar"
                      aria-valuenow={typeof percent === 'number' ? percent : undefined}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Processing ${document.displayName}`}
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${isWorking ? (percent ?? 5) : 0}%` }}
                      />
                    </div>
                    {document.processingState === 'failed' && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {document.errorCode === 'pdf_password' &&
                          'Password-protected PDFs are not supported yet.'}
                        {document.errorCode === 'pdf_pages_exceeded' &&
                          'This PDF has more than 100 pages.'}
                        {document.errorCode === 'not_a_pdf' &&
                          'This file is not a readable PDF.'}
                        {(!document.errorCode ||
                          !['pdf_password', 'pdf_pages_exceeded', 'not_a_pdf'].includes(
                            document.errorCode,
                          )) &&
                          'Processing failed. You can retry, or remove the file and import it again.'}
                      </p>
                    )}
                  </div>
                )}

                {document.processingState === 'ready' && document.pagesWithNoText > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {document.pagesWithNoText} page
                    {document.pagesWithNoText === 1 ? '' : 's'} produced no text — likely
                    scanned images. OCR arrives in a later phase; those pages are excluded
                    for now.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {viewer && (
        <DocumentViewerDialog
          document={viewer}
          open={async () => openViewer(viewer.id)}
          onClose={() => setViewer(null)}
        />
      )}

      {deleting && (
        <DeleteDocumentDialog
          document={deleting}
          confirm={async () => {
            await remove(deleting.id)
            return { ok: true as const }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
