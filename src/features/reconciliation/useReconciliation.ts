/**
 * Reconciliation feature hook: the consent-gated cloud analysis workflow.
 *
 * Owns the three-step contract in the UI:
 * 1. Preview — build the exact payload, show it and what was excluded.
 * 2. Approve — persist a payload-specific snapshot (explicit user action).
 * 3. Run — revalidate consent and send; findings arrive as proposals.
 *
 * The reconciler is injected (real cloud adapter in the app, fake in tests),
 * so this hook contains no Firebase import.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PaymentCase } from '../../domain/cases/case'
import type { DisclosurePayload } from '../../domain/privacy/disclosure'
import type {
  DisclosureBuildResult,
} from '../../domain/privacy/disclosure'
import type { FindingWithContext } from '../../infrastructure/storage/finding-repository'
import { applyFindingStatus, type FindingAction } from '../../domain/reconciliation/finding'
import type { CloudReconciler } from '../../application/ports/cloud-reconciler'
import {
  approveDisclosure,
  previewDisclosure,
  runReconciliation,
  isReconciliationRunning,
} from '../../application/reconciliation/reconciliation-service'
import { applyFindingReview, listFindings } from '../../infrastructure/storage/finding-repository'
import { getConsentStatus, type ConsentIssue } from '../../application/privacy/consent-status-service'
import type { StoredDisclosure } from '../../infrastructure/storage/db'

export interface DisclosurePreviewState {
  status: 'idle' | 'building' | 'ready' | 'error'
  preview: DisclosureBuildResult | null
  payload: DisclosurePayload | null
  errorMessage: string | null
}

export interface ReconciliationState {
  findings: FindingWithContext[]
  findingsStatus: 'loading' | 'ready' | 'error'
  findingsErrorMessage: string | null
  previewState: DisclosurePreviewState
  snapshot: StoredDisclosure | null
  running: boolean
  actionError: string | null
  lastRun: { saved: number; dropped: number } | null
  /** Whether the stored snapshot's approval is still valid, and why not. */
  consentIssue: ConsentIssue | null
  consentChangedFactIds: string[]
  buildPreview: () => Promise<void>
  setIncludedFactIds: (ids: ReadonlySet<string>) => void
  approve: () => Promise<void>
  run: () => Promise<void>
  reviewFinding: (findingId: string, action: FindingAction) => Promise<void>
  refreshFindings: () => Promise<void>
  dismissActionError: () => void
}

const FINDINGS_LOAD_ERROR =
  'Opening this case’s findings failed. Your data is not lost — try again.'

export function useReconciliation(
  paymentCase: PaymentCase,
  reconciler: CloudReconciler,
): ReconciliationState {
  const [findings, setFindings] = useState<FindingWithContext[]>([])
  const [findingsStatus, setFindingsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [findingsErrorMessage, setFindingsErrorMessage] = useState<string | null>(null)

  const [previewState, setPreviewState] = useState<DisclosurePreviewState>({
    status: 'idle',
    preview: null,
    payload: null,
    errorMessage: null,
  })
  const [includedFactIds, setIncludedFactIdsState] = useState<ReadonlySet<string> | null>(null)
  const [snapshot, setSnapshot] = useState<StoredDisclosure | null>(null)
  const [running, setRunning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ saved: number; dropped: number } | null>(null)
  const [consentIssue, setConsentIssue] = useState<ConsentIssue | null>(null)
  const [consentChangedFactIds, setConsentChangedFactIds] = useState<string[]>([])

  const refreshFindings = useCallback(async () => {
    try {
      const rows = await listFindings(paymentCase.id)
      setFindings(rows)
      setFindingsStatus('ready')
      setFindingsErrorMessage(null)
    } catch {
      setFindingsStatus('error')
      setFindingsErrorMessage(FINDINGS_LOAD_ERROR)
    }
  }, [paymentCase.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listFindings(paymentCase.id)
        if (cancelled) return
        setFindings(rows)
        setFindingsStatus('ready')
      } catch {
        if (!cancelled) {
          setFindingsStatus('error')
          setFindingsErrorMessage(FINDINGS_LOAD_ERROR)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paymentCase.id, paymentCase.revision])

  const buildPreview = useCallback(async () => {
    setPreviewState({ status: 'building', preview: null, payload: null, errorMessage: null })
    const result = await previewDisclosure(
      paymentCase.id,
      includedFactIds ?? undefined,
    )
    if (!result.ok) {
      setPreviewState({
        status: 'error',
        preview: null,
        payload: null,
        errorMessage: result.error.message,
      })
      return
    }
    setPreviewState({
      status: 'ready',
      preview: result.preview,
      payload: result.payload,
      errorMessage: null,
    })
  }, [paymentCase.id, includedFactIds])

  const setIncludedFactIds = useCallback((ids: ReadonlySet<string>) => {
    setIncludedFactIdsState(ids)
    setPreviewState({
      status: 'idle',
      preview: null,
      payload: null,
      errorMessage: null,
    })
  }, [])

  const approve = useCallback(async () => {
    if (!previewState.payload) return
    setActionError(null)
    const result = await approveDisclosure(paymentCase.id, previewState.payload)
    if (!result.ok) {
      setActionError(result.error.message)
      return
    }
    setSnapshot(result.snapshot)
    setPreviewState((state) => ({
      ...state,
      payload: null,
      status: 'idle',
    }))
  }, [paymentCase.id, previewState.payload])

  const run = useCallback(async () => {
    if (!snapshot) return
    setActionError(null)
    setRunning(true)
    try {
      const outcome = await runReconciliation(snapshot.id, reconciler)
      if (!outcome.ok) {
        setActionError(outcome.error?.message ?? 'Cloud analysis failed.')
        // The snapshot may have been consumed despite a display error;
        // requiring a fresh approval keeps the contract strict.
        setSnapshot(null)
        if (outcome.error?.code === 'stale_consent') {
          const status = await getConsentStatus(snapshot.id)
          if (status.ok) {
            setConsentIssue(status.status.issue)
            setConsentChangedFactIds(status.status.changedFactIds)
          }
        }
        return
      }
      setLastRun({ saved: outcome.savedFindings ?? 0, dropped: outcome.droppedFindings ?? 0 })
      setSnapshot(null)
      setConsentIssue(null)
      setConsentChangedFactIds([])
      await refreshFindings()
    } finally {
      setRunning(false)
    }
  }, [snapshot, reconciler, refreshFindings])

  const reviewFinding = useCallback(
    async (findingId: string, action: FindingAction) => {
      setActionError(null)
      const result = await applyFindingReview(findingId, (finding, now) =>
        applyFindingStatus(finding, action, now),
      )
      if (!result.ok) setActionError(result.error.message)
      await refreshFindings()
    },
    [refreshFindings],
  )

  const dismissActionError = useCallback(() => setActionError(null), [])

  // Surface a live "already running" state if a run is active elsewhere.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRunning((current) => current || isReconciliationRunning(paymentCase.id))
    }, 500)
    return () => window.clearInterval(timer)
  }, [paymentCase.id])

  return {
    findings,
    findingsStatus,
    findingsErrorMessage,
    previewState,
    snapshot,
    running,
    actionError,
    lastRun,
    consentIssue,
    consentChangedFactIds,
    buildPreview,
    setIncludedFactIds,
    approve,
    run,
    reviewFinding,
    refreshFindings,
    dismissActionError,
  }
}
