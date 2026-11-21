/**
 * Privacy & data controls panel — the Phase 7 consent/data surface.
 *
 * Three honest, user-owned controls:
 * 1. Case export (local backup, with a sensitive-data warning).
 * 2. Full local wipe (typed confirmation; permanent; local; does not recall
 *    payloads already sent to the cloud provider).
 * 3. Storage persistence status (best-effort browser request, never promised).
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Download, HardDriveDownload, Loader2, Trash2 } from 'lucide-react'
import type { PaymentCase } from '../../domain/cases/case'
import {
  buildCaseExport,
  exportFileName,
  serializeExport,
} from '../../application/privacy/export-service'
import {
  countLocalData,
  wipeAllLocalData,
  WIPE_CONFIRM_PHRASE,
} from '../../application/privacy/wipe-service'
import { Button } from '../../shared/ui/button'
import { Dialog } from '../../shared/ui/dialog'
import { Field } from '../../shared/ui/field'
import { TextInput } from '../../shared/ui/input'

export function PrivacyPanel({ paymentCase }: { paymentCase: PaymentCase }) {
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)

  const [counts, setCounts] = useState<{ cases: number; documents: number; facts: number; findings: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await countLocalData()
        if (!cancelled) setCounts(data)
      } catch {
        /* counts are informational; failure is non-fatal */
      }
      try {
        if (navigator.storage?.persisted) {
          const value = await navigator.storage.persisted()
          if (!cancelled) setPersisted(value)
        }
      } catch {
        /* persistence is best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const downloadExport = async () => {
    setExportState('working')
    setExportError(null)
    const result = await buildCaseExport(paymentCase.id)
    if (!result.ok) {
      setExportState('error')
      setExportError(result.error.message)
      return
    }
    const json = serializeExport(result.export)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exportFileName(paymentCase.title, result.export.exportedAt)
    anchor.click()
    URL.revokeObjectURL(url)
    setExportState('idle')
  }

  return (
    <section
      aria-labelledby="privacy-heading"
      className="rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <h2 id="privacy-heading" className="text-lg font-semibold text-slate-900">
        Privacy and local data
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        All records live in this browser only. These controls stay on this device.
      </p>

      {persisted !== null && (
        <p className="mt-2 text-xs text-slate-500">
          Browser persistent storage: {persisted ? 'granted (data is less likely to be evicted)' : 'not granted (the browser may evict data under storage pressure — export important cases)'}.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Export */}
        <div className="rounded-md border border-line px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Download className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Export this case
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Downloads a single JSON backup: case, documents (with their original bytes),
            extracted text, facts, and findings. Works offline.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The export contains sensitive client information. Store and share it carefully.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void downloadExport()}
            disabled={exportState === 'working'}
          >
            {exportState === 'working' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                <HardDriveDownload className="h-3.5 w-3.5" aria-hidden="true" />
                Download JSON backup
              </>
            )}
          </Button>
          {exportError && <p className="mt-2 text-xs text-red-600">{exportError}</p>}
        </div>

        {/* Wipe */}
        <div className="rounded-md border border-line px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Trash2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Erase all local data
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Permanently deletes every case on this device, including documents and
            originals. {counts ? `Currently: ${counts.cases} case(s), ${counts.documents} document(s), ${counts.facts} fact(s), ${counts.findings} finding(s).` : ''}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            This cannot erase payloads already sent to the cloud provider, or exported files
            you downloaded.
          </p>
          <Button variant="ghost" size="sm" className="mt-3 text-red-600" onClick={() => setWipeOpen(true)}>
            Erase everything…
          </Button>
        </div>
      </div>

      {wipeOpen && <WipeDialog onClose={() => setWipeOpen(false)} />}
    </section>
  )
}

function WipeDialog({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setWorking(true)
    setError(null)
    const result = await wipeAllLocalData(phrase)
    setWorking(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onClose()
    window.location.reload()
  }

  return (
    <Dialog
      onClose={onClose}
      title="Erase all DueProof data on this device?"
      description="This permanently deletes every case, document, extracted text, fact, approval record, and finding stored in this browser. It cannot be undone, and it cannot recall anything already sent to the cloud provider or files you exported."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            onClick={() => void submit()}
            disabled={working || phrase.trim().toLowerCase() !== WIPE_CONFIRM_PHRASE}
          >
            {working ? 'Erasing…' : 'Erase permanently'}
          </Button>
        </>
      }
    >
      <Field
        label={`Type “${WIPE_CONFIRM_PHRASE}” to confirm`}
        htmlFor="wipe-confirm"
        hint="The confirmation protects against accidental erasure."
      >
        {(control) => (
          <TextInput
            {...control}
            value={phrase}
            autoComplete="off"
            onChange={(event) => setPhrase(event.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </Dialog>
  )
}
