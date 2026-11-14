/**
 * Evidence fact repository — the persistence boundary for facts.
 *
 * Responsibilities:
 * - Save candidate facts from on-device extraction (batch, per block).
 * - Load facts for a case/document with their source blocks joined.
 * - Apply review transitions (confirm/reject/dispute/restore/edit).
 * - Delete facts tied to a document when the document is deleted.
 * - Mark derived facts stale when a document's text is re-extracted.
 * - Wrap every driver error in the single safe `storage_error` code.
 */

import { getDb, type StoredEvidenceFact } from './db'
import type { EvidenceError } from '../../domain/evidence'
import { evidenceError } from '../../domain/evidence'
import type { EvidenceFact, FactStatus } from '../../domain/evidence'
import { getCase } from './case-repository'

function storageError(): EvidenceError {
  return evidenceError('storage_error')
}

function uuid(): string {
  return crypto.randomUUID()
}

export type FactResult<T> = { ok: true; value: T } | { ok: false; error: EvidenceError }

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Saves verified candidate facts for one block. Called by the extraction
 * service AFTER domain validation; facts arrive as `proposed`.
 */
export async function saveProposedFacts(
  facts: Array<Omit<EvidenceFact, 'id'>>,
): Promise<FactResult<EvidenceFact[]>> {
  if (facts.length === 0) return { ok: true, value: [] }
  const records: StoredEvidenceFact[] = facts.map((fact) => ({ ...fact, id: uuid() }))
  try {
    const db = getDb()
    await db.facts.bulkPut(records)
    return { ok: true, value: records }
  } catch {
    return { ok: false, error: storageError() }
  }
}

/** Persists an already-validated fact (manual creation or edited fact). */
export async function putFact(fact: EvidenceFact): Promise<FactResult<EvidenceFact>> {
  try {
    await getDb().facts.put(fact as StoredEvidenceFact)
    return { ok: true, value: fact }
  } catch {
    return { ok: false, error: storageError() }
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export interface FactWithSource {
  fact: EvidenceFact
  /** Present when the fact cites a block that still exists. */
  block: { id: string; text: string; pageNumber: number | null; lineStart: number; lineEnd: number } | null
  documentName: string | null
}

/** Lists a case's non-rejected facts with their citation context. */
export async function listCaseFacts(caseId: string): Promise<FactWithSource[]> {
  const db = getDb()
  const facts = await db.facts.where('caseId').equals(caseId).toArray()
  const visible = facts.filter((fact) => fact.status !== 'rejected')

  const blockIds = new Set(
    visible.map((fact) => fact.blockId).filter((id): id is string => id !== null),
  )
  const documentIds = new Set(
    visible.map((fact) => fact.documentId).filter((id): id is string => id !== null),
  )

  const blocks = blockIds.size > 0 ? await db.sourceBlocks.bulkGet([...blockIds]) : []
  const documents = documentIds.size > 0 ? await db.documents.bulkGet([...documentIds]) : []

  const blockById = new Map(blocks.map((block) => (block ? [block.id, block] : null)).filter(Boolean) as Array<[string, NonNullable<(typeof blocks)[number]>]>)
  const documentById = new Map(
    documents.map((doc) => (doc ? [doc.id, doc] : null)).filter(Boolean) as Array<[string, NonNullable<(typeof documents)[number]>]>,
  )

  return visible
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((fact) => {
      const block = fact.blockId ? blockById.get(fact.blockId) : undefined
      const document = fact.documentId ? documentById.get(fact.documentId) : undefined
      return {
        fact,
        block: block
          ? {
              id: block.id,
              text: block.text,
              pageNumber: block.pageNumber,
              lineStart: block.lineStart,
              lineEnd: block.lineEnd,
            }
          : null,
        documentName: document?.displayName ?? null,
      }
    })
}

/** Counts proposed facts pending review for a case. */
export async function countProposedFacts(caseId: string): Promise<number> {
  const rows = await getDb().facts.where('caseId').equals(caseId).toArray()
  return rows.filter((fact) => fact.status === 'proposed').length
}

/* ------------------------------------------------------------------ */
/* Review transitions                                                 */
/* ------------------------------------------------------------------ */

/** Applies a review action; a no-op returns the fact unchanged. */
export async function applyReview(
  factId: string,
  transition: (fact: EvidenceFact, now: number) => EvidenceFact,
): Promise<FactResult<EvidenceFact>> {
  const db = getDb()
  const record = await db.facts.get(factId)
  if (!record) return { ok: false, error: evidenceError('not_found') }

  const next = transition(record, Date.now())
  try {
    await db.facts.put(next as StoredEvidenceFact)
    return { ok: true, value: next }
  } catch {
    return { ok: false, error: storageError() }
  }
}

/* ------------------------------------------------------------------ */
/* Cascade + staleness                                                */
/* ------------------------------------------------------------------ */

/** Deletes every fact tied to a document (document deletion cascade). */
export async function deleteFactsForDocument(documentId: string): Promise<void> {
  await getDb().facts.where('documentId').equals(documentId).delete()
}

/**
 * Marks a document's facts stale after re-extraction changed the text.
 * The citation offsets may no longer resolve, so facts lose their quotes and
 * keep only the user-confirmed statement. Users see a "source changed" note.
 */
export async function staleFactsForDocument(
  documentId: string,
  newVersion: number,
): Promise<void> {
  const db = getDb()
  const rows = await db.facts.where('documentId').equals(documentId).toArray()
  const updates: StoredEvidenceFact[] = rows.map((fact) => ({
    ...fact,
    sourceVersion: newVersion,
    quote: null,
    charStart: null,
    charEnd: null,
    normalizedMatch: false,
  }))
  if (updates.length > 0) await db.facts.bulkPut(updates)
}

/** Deletes all facts for a case (case deletion cascade). */
export async function deleteFactsForCase(caseId: string): Promise<void> {
  await getDb().facts.where('caseId').equals(caseId).delete()
}

/** Loads the case currency for amount context. */
export async function getCaseCurrency(caseId: string): Promise<string | null> {
  const record = await getCase(caseId)
  return record?.currency ?? null
}

export type { FactStatus }

