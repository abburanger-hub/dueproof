/**
 * Evidence extraction service — orchestrates local-only fact extraction.
 *
 * One job per document at a time. The flow per block:
 *   port.extract (on-device) → domain validation → quote verification →
 *   dedupe → cap → save as `proposed`.
 *
 * Privacy guarantees enforced here:
 * - The only extractor implementation is the on-device adapter. There is no
 *   cloud branch anywhere in this service.
 * - A block that fails validation is SKIPPED (counted), never guessed.
 * - Cancellation stops between blocks; already-saved facts persist.
 * - Every failure maps to a safe error code; raw driver text never surfaces.
 */

import type { EvidenceError, EvidenceFact } from '../../domain/evidence'
import { evidenceError } from '../../domain/evidence'
import { applyFactStatus, applyFactEdit } from '../../domain/evidence'
import {
  capProposals,
  createFactFromProposal,
  dedupeProposals,
  toCandidateProposal,
} from '../../domain/evidence'
import type { LocalFactExtractor } from '../ports/local-fact-extractor'
import {
  applyReview,
  getCaseCurrency,
  listCaseFacts,
  putFact,
  saveProposedFacts,
  type FactWithSource,
} from '../../infrastructure/storage/fact-repository'
import { getDocument, getBlocks } from '../../infrastructure/storage/document-repository'

export interface ExtractionProgress {
  documentId: string
  processedBlocks: number
  totalBlocks: number
  /** Facts saved so far in this run. */
  savedFacts: number
  /** Blocks whose output failed validation and were skipped. */
  skippedBlocks: number
  phase: 'running' | 'done' | 'failed' | 'cancelled'
}

type Listener = (event: ExtractionProgress) => void

const listeners = new Set<Listener>()

export function onExtractionProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: ExtractionProgress): void {
  for (const listener of listeners) listener(event)
}

const active = new Map<string, { controller: AbortController }>()

export interface ExtractionOutcome {
  ok: boolean
  savedFacts?: number
  skippedBlocks?: number
  error?: EvidenceError
}

/** Whether extraction is currently running for a document. */
export function isExtractionRunning(documentId: string): boolean {
  return active.has(documentId)
}

/**
 * Runs on-device extraction for every block of a document.
 * The document must be in `ready` state with extracted blocks.
 */
export async function extractDocumentFacts(
  documentId: string,
  extractor: LocalFactExtractor,
): Promise<ExtractionOutcome> {
  if (active.has(documentId)) return { ok: false, error: evidenceError('already_running') }

  const document = await getDocument(documentId)
  if (!document) return { ok: false, error: evidenceError('not_found') }
  if (document.processingState !== 'ready') return { ok: false, error: evidenceError('not_ready') }

  const caseCurrency = (await getCaseCurrency(document.caseId)) ?? 'INR'

  const blocks = await getBlocks(documentId)
  const totalBlocks = blocks.length
  if (totalBlocks === 0) {
    return { ok: true, savedFacts: 0, skippedBlocks: 0 }
  }

  const controller = new AbortController()
  active.set(documentId, { controller })

  let processed = 0
  let savedFacts = 0
  let skipped = 0

  const emitRunning = () =>
    emit({ documentId, processedBlocks: processed, totalBlocks, savedFacts, skippedBlocks: skipped, phase: 'running' })

  try {
    for (const block of blocks) {
      if (controller.signal.aborted) break

      const extraction = await extractor.extract(
        { block: { id: block.id, text: block.text }, caseCurrency },
        controller.signal,
      )

      if (!extraction.ok) {
        if (extraction.error.code === 'cancelled') break
        // A failed block is skipped, not fatal: partial extraction is still
        // useful, and the user can retry or add facts manually.
        skipped += 1
        processed += 1
        emitRunning()
        continue
      }

      const validated = extraction.rawProposals
        .map((raw) => toCandidateProposal(raw))
        .filter((outcome) => outcome.ok)

      const proposals = dedupeProposals(
        validated.flatMap((outcome) => (outcome.ok ? [outcome.proposal] : [])),
      )
      const capped = capProposals(proposals)

      const created: Array<Omit<EvidenceFact, 'id'>> = []
      for (const proposal of capped) {
        const fact = createFactFromProposal(proposal, {
          caseId: document.caseId,
          documentId,
          blockId: block.id,
          blockText: block.text,
          sourceVersion: document.textVersion,
          now: Date.now(),
          caseCurrency,
        }, 'pending')
        if (fact.ok) created.push(fact.fact)
      }

      if (created.length > 0) {
        const saved = await saveProposedFacts(created)
        if (saved.ok) savedFacts += saved.value.length
        else skipped += 1
      }

      processed += 1
      emitRunning()
    }

    const cancelled = controller.signal.aborted
    emit({
      documentId,
      processedBlocks: processed,
      totalBlocks,
      savedFacts,
      skippedBlocks: skipped,
      phase: cancelled ? 'cancelled' : 'done',
    })
    return cancelled
      ? { ok: false, error: evidenceError('cancelled'), savedFacts, skippedBlocks: skipped }
      : { ok: true, savedFacts, skippedBlocks: skipped }
  } catch {
    emit({
      documentId,
      processedBlocks: processed,
      totalBlocks,
      savedFacts,
      skippedBlocks: skipped,
      phase: 'failed',
    })
    return { ok: false, error: evidenceError('extraction_failed') }
  } finally {
    active.delete(documentId)
  }
}

/** Cancels a running extraction; completed facts remain saved. */
export function cancelExtraction(documentId: string): void {
  active.get(documentId)?.controller.abort()
}

/* ------------------------------------------------------------------ */
/* Review operations (called by the UI)                               */
/* ------------------------------------------------------------------ */

export type ReviewAction = 'confirm' | 'reject' | 'dispute' | 'restore'

export async function reviewFact(
  factId: string,
  action: ReviewAction,
): Promise<{ ok: true; fact: EvidenceFact } | { ok: false; error: EvidenceError }> {
  const result = await applyReview(factId, (fact, now) => applyFactStatus(fact, action, now))
  if (!result.ok) return result
  return { ok: true, fact: result.value }
}

export async function editFact(
  factId: string,
  input: { statement: string; amount: EvidenceFact['amount']; date: EvidenceFact['date'] },
): Promise<{ ok: true; fact: EvidenceFact } | { ok: false; error: EvidenceError }> {
  const result = await applyReview(factId, (fact) => fact)
  if (!result.ok) return result
  const next = applyFactEdit(result.value, input, Date.now())
  if (!next.ok) return next
  const saved = await putFact(next.fact)
  if (!saved.ok) return saved
  return { ok: true, fact: saved.value }
}

export { listCaseFacts }
export type { FactWithSource }

