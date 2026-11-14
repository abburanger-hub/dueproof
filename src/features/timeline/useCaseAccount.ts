/**
 * Feature hook: timeline + ledger for one case.
 *
 * Both views are pure computations over the case's facts — no new storage
 * tables, no AI, no network. The hook loads facts once and derives both
 * views via useMemo so the UI always reflects the current review state.
 */

import { useEffect, useMemo, useState } from 'react'
import type { PaymentCase } from '../../domain/cases/case'
import { buildLedger, type LedgerResult } from '../../domain/ledger/ledger'
import { buildTimeline, type TimelineResult } from '../../domain/timeline/timeline'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'

export interface CaseAccountState {
  status: 'loading' | 'ready' | 'error'
  errorMessage: string | null
  timeline: TimelineResult | null
  ledger: LedgerResult | null
  factCount: number
  refresh: () => Promise<void>
}

const LOAD_ERROR = 'Opening this case’s account failed. Your data is not lost — try again.'

/** Whether the account view should recompute (fact or case changes). */
export function useCaseAccount(paymentCase: PaymentCase): CaseAccountState {
  const [facts, setFacts] = useState<Parameters<typeof buildTimeline>[0]>([])
  const [status, setStatus] = useState<CaseAccountState['status']>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refresh = useMemo(
    () => async () => {
      try {
        const rows = await listCaseFacts(paymentCase.id)
        setFacts(rows.map((row) => row.fact))
        setStatus('ready')
        setErrorMessage(null)
      } catch {
        setStatus('error')
        setErrorMessage(LOAD_ERROR)
      }
    },
    [paymentCase.id],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await listCaseFacts(paymentCase.id)
        if (cancelled) return
        setFacts(rows.map((row) => row.fact))
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

  const timeline = useMemo(() => buildTimeline(facts), [facts])
  const ledger = useMemo(
    () => buildLedger(facts, paymentCase.currency),
    [facts, paymentCase.currency],
  )

  return {
    status,
    errorMessage,
    timeline,
    ledger,
    factCount: facts.length,
    refresh,
  }
}
