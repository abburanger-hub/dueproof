/**
 * Report feature hook — the Phase 8 workflow.
 *
 * 1. Loads the case's reviewed record and seeds the editable request letter
 *    from the deterministic recorded balance.
 * 2. Compose: snapshots the current reviewed record + the user's letter.
 * 3. Export: renders the snapshot to PDF entirely on this device.
 *
 * No AI runs here. The letter is the user's own text — the template is only
 * a starting point, and composing never silently promotes proposed facts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PaymentCase } from '../../domain/cases/case'
import type { PaymentRequestReport } from '../../domain/reports/report'
import {
  composeAndSaveReport,
  loadReport,
  seedLetter,
} from '../../application/reports/report-service'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'

export interface ReportState {
  status: 'loading' | 'ready' | 'error'
  errorMessage: string | null
  letter: string
  setLetter: (letter: string) => void
  seedTemplate: () => void
  composed: PaymentRequestReport | null
  composing: boolean
  compose: () => Promise<void>
  exportPdf: () => Promise<void>
  exporting: boolean
  exportError: string | null
}

const LOAD_ERROR = 'Opening this case’s records failed. Your data is not lost — try again.'
const EXPORT_ERROR =
  'Generating the PDF failed. Your report snapshot is still saved — try again.'

export function useReport(paymentCase: PaymentCase): ReportState {
  const [status, setStatus] = useState<ReportState['status']>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [letter, setLetter] = useState('')
  const [composed, setComposed] = useState<PaymentRequestReport | null>(null)
  const [composing, setComposing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await listCaseFacts(paymentCase.id)
        if (cancelled) return
        setComposed(loadReport(paymentCase.id))
        setStatus('ready')
      } catch {
        if (!cancelled) {
          setStatus('error')
          setErrorMessage(LOAD_ERROR)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paymentCase.id, paymentCase.revision])

  const factsLoader = useMemo(
    () => async () => listCaseFacts(paymentCase.id),
    [paymentCase.id],
  )

  const seedTemplate = useCallback(() => {
    void (async () => {
      try {
        const rows = await factsLoader()
        setLetter(seedLetter(paymentCase, rows.map((row) => row.fact)))
      } catch {
        setLetter('')
      }
    })()
  }, [paymentCase, factsLoader])

  const compose = useCallback(async () => {
    setComposing(true)
    setExportError(null)
    try {
      const result = await composeAndSaveReport({ paymentCase, letter })
      if (!result.ok) {
        setExportError(result.error.message)
        return
      }
      setComposed(result.value)
    } finally {
      setComposing(false)
    }
  }, [paymentCase, letter])

  const exportPdf = useCallback(async () => {
    if (!composed) return
    setExporting(true)
    setExportError(null)
    try {
      const { renderReportPdf } = await import('../../infrastructure/export/report-pdf')
      const bytes = await renderReportPdf(composed)
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dueproof-report-${composed.caseId.slice(0, 8)}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(EXPORT_ERROR)
    } finally {
      setExporting(false)
    }
  }, [composed])

  return {
    status,
    errorMessage,
    letter,
    setLetter,
    seedTemplate,
    composed,
    composing,
    compose,
    exportPdf,
    exporting,
    exportError,
  }
}
