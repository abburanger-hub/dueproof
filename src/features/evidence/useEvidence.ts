import { useCallback, useEffect, useState } from 'react'
import type { CaseDocument } from '../../domain/documents/document'
import type { PaymentCase } from '../../domain/cases/case'
import type { EvidenceFact } from '../../domain/evidence'
import { FACT_KINDS } from '../../domain/evidence'
import type { FactWithSource } from '../../application/evidence/extraction-service'
import {
  cancelExtraction,
  editFact,
  listCaseFacts,
  onExtractionProgress,
  reviewFact,
} from '../../application/evidence/extraction-service'
import type { LocalFactExtractor } from '../../application/ports/local-fact-extractor'
import type { EvidenceError } from '../../domain/evidence'
import { prepareDeviceModel } from '../../infrastructure/firebase/ai'

export interface FactWithSourceState {
  fact: EvidenceFact
  source: { pageNumber: number | null; lineStart: number; lineEnd: number; text: string } | null
  documentName: string | null
}

export type ModelReadiness = 'unknown' | 'ready' | 'unavailable'

export interface ExtractionRunState {
  documentId: string
  processedBlocks: number
  totalBlocks: number
  savedFacts: number
  skippedBlocks: number
  phase: 'running' | 'done' | 'failed' | 'cancelled'
}

/**
 * The single hook owning the evidence review workflow for one case.
 *
 * The extractor instance is injected once (the on-device adapter in the app;
 * a fake in tests) — this hook itself has no Firebase import, keeping the
 * privacy boundary in infrastructure only.
 */
export function useEvidence(
  paymentCase: PaymentCase,
  extractor: LocalFactExtractor,
  importAndExtract: (documentId: string, extractor: LocalFactExtractor) => Promise<{ ok: boolean; savedFacts?: number; skippedBlocks?: number; error?: EvidenceError }>,
) {
  const [facts, setFacts] = useState<FactWithSourceState[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [run, setRun] = useState<ExtractionRunState | null>(null)
  const [modelReadiness, setModelReadiness] = useState<ModelReadiness>('unknown')
  const [preparing, setPreparing] = useState(false)
  const [prepareProgress, setPrepareProgress] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const rows: FactWithSource[] = await listCaseFacts(paymentCase.id)
      setFacts(
        rows.map((row) => ({
          fact: row.fact,
          source: row.block
            ? {
                pageNumber: row.block.pageNumber,
                lineStart: row.block.lineStart,
                lineEnd: row.block.lineEnd,
                text: row.block.text,
              }
            : null,
          documentName: row.documentName,
        })),
      )
      setStatus('ready')
      setErrorMessage(null)
    } catch {
      setStatus('error')
      setErrorMessage('Opening this case’s facts failed. Your data is not lost — try again.')
    }
  }, [paymentCase.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listCaseFacts(paymentCase.id)
        if (cancelled) return
        setFacts(
          rows.map((row) => ({
            fact: row.fact,
            source: row.block
              ? {
                  pageNumber: row.block.pageNumber,
                  lineStart: row.block.lineStart,
                  lineEnd: row.block.lineEnd,
                  text: row.block.text,
                }
              : null,
            documentName: row.documentName,
          })),
        )
        setStatus('ready')
      } catch {
        if (!cancelled) {
          setStatus('error')
          setErrorMessage('Opening this case’s facts failed. Your data is not lost — try again.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paymentCase.id])

  useEffect(() => {
    const unsubscribe = onExtractionProgress((event) => {
      setRun({
        documentId: event.documentId,
        processedBlocks: event.processedBlocks,
        totalBlocks: event.totalBlocks,
        savedFacts: event.savedFacts,
        skippedBlocks: event.skippedBlocks,
        phase: event.phase,
      })
      if (event.phase === 'done' || event.phase === 'failed' || event.phase === 'cancelled') {
        void refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  const prepareModel = useCallback(async () => {
    if (preparing) return
    setPreparing(true)
    setActionError(null)
    try {
      await prepareDeviceModel((progressValue: number) => setPrepareProgress(progressValue))
      setModelReadiness('ready')
    } catch {
      setModelReadiness('unavailable')
      setActionError(
        'The on-device model could not be prepared on this device. You can still add facts manually.',
      )
    } finally {
      setPreparing(false)
      setPrepareProgress(null)
    }
  }, [preparing])

  const extract = useCallback(
    async (document: CaseDocument) => {
      setActionError(null)
      const outcome = await importAndExtract(document.id, extractor)
      if (!outcome.ok) {
        setActionError(outcome.error?.message ?? 'On-device extraction failed.')
        if (outcome.error?.code === 'model_unavailable') setModelReadiness('unavailable')
        return
      }
      if ((outcome.savedFacts ?? 0) === 0 && (outcome.skippedBlocks ?? 0) > 0) {
        setActionError(
          'Extraction finished, but the model could not produce verifiable suggestions for this document. You can retry or add facts manually.',
        )
      }
    },
    [extractor, importAndExtract],
  )

  const cancel = useCallback((documentId: string) => {
    cancelExtraction(documentId)
  }, [])

  const review = useCallback(
    async (factId: string, action: 'confirm' | 'reject' | 'dispute' | 'restore') => {
      setActionError(null)
      const result = await reviewFact(factId, action)
      if (!result.ok) setActionError(result.error.message)
      await refresh()
    },
    [refresh],
  )

  const edit = useCallback(
    async (
      factId: string,
      input: { statement: string; amount: EvidenceFact['amount']; date: EvidenceFact['date'] },
    ) => {
      setActionError(null)
      const result = await editFact(factId, input)
      if (!result.ok) return result
      await refresh()
      return result
    },
    [refresh],
  )

  return {
    facts,
    status,
    errorMessage,
    run,
    modelReadiness,
    preparing,
    prepareProgress,
    actionError,
    factKinds: FACT_KINDS,
    refresh,
    prepareModel,
    extract,
    cancel,
    review,
    edit,
    dismissActionError: () => setActionError(null),
  }
}

