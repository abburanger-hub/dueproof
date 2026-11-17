/**
 * Finding repository — the persistence boundary for reconciliation findings.
 *
 * Findings are cloud PROPOSALS: they are stored as `proposed` and only
 * explicit user review moves them to `user_reviewed` / `rejected`.
 * Deletion cascades keep findings tied to their case and (for cleanup) to
 * their disclosure snapshot.
 */

import { getDb, type StoredFinding } from './db'
import {
  reconciliationError,
  type Finding,
  type ReconciliationError,
} from '../../domain/reconciliation/finding'

export type FindingResult<T> = { ok: true; value: T } | { ok: false; error: ReconciliationError }

function uuid(): string {
  return crypto.randomUUID()
}

function storageError(): ReconciliationError {
  return reconciliationError('storage_error')
}

/** Saves validated findings from one analysis run; returns persisted records. */
export async function saveFindings(
  records: Array<Omit<Finding, 'id'>>,
): Promise<FindingResult<Finding[]>> {
  if (records.length === 0) return { ok: true, value: [] }
  const rows: StoredFinding[] = records.map((record) => ({ ...record, id: uuid() }))
  try {
    await getDb().findings.bulkPut(rows)
    return { ok: true, value: rows }
  } catch {
    return { ok: false, error: storageError() }
  }

}

export interface FindingWithContext {
  finding: Finding
  /** Statements of cited facts, for source display in the UI. */
  citedStatements: Array<{ factId: string; statement: string; kind: string }>
}

/** Lists a case's findings (newest first), joining cited fact statements. */
export async function listFindings(caseId: string): Promise<FindingWithContext[]> {
  const db = getDb()
  const rows = await db.findings.where('caseId').equals(caseId).toArray()
  const visible = rows
    .filter((finding) => finding.status !== 'rejected')
    .sort((a, b) => b.createdAt - a.createdAt)

  const citedIds = new Set<string>()
  for (const finding of visible) {
    for (const id of finding.supportingFactIds) citedIds.add(id)
    for (const id of finding.conflictingFactIds) citedIds.add(id)
  }
  const facts = citedIds.size > 0 ? await db.facts.bulkGet([...citedIds]) : []

  const statementById = new Map<string, { statement: string; kind: string }>()
  for (const fact of facts) {
    if (fact) statementById.set(fact.id, { statement: fact.statement, kind: fact.kind })
  }

  const result: FindingWithContext[] = []
  for (const finding of visible) {
    const citedStatements: FindingWithContext['citedStatements'] = []
    for (const id of [...finding.supportingFactIds, ...finding.conflictingFactIds]) {
      const info = statementById.get(id)
      if (info) citedStatements.push({ factId: id, statement: info.statement, kind: info.kind })
    }
    result.push({ finding, citedStatements })
  }
  return result
}

/** Applies a review transition to one finding. */
export async function applyFindingReview(
  findingId: string,
  transition: (finding: Finding, now: number) => Finding,
): Promise<FindingResult<Finding>> {
  const db = getDb()
  const record = await db.findings.get(findingId)
  if (!record) return { ok: false, error: reconciliationError('not_found') }
  const next = transition(record, Date.now())
  try {
    await db.findings.put(next as StoredFinding)
    return { ok: true, value: next }
  } catch {
    return { ok: false, error: storageError() }
  }
}

/** Whether any findings exist for a snapshot (consumed-check support). */
export async function countFindingsForSnapshot(snapshotId: string): Promise<number> {
  return (await getDb().findings.where('snapshotId').equals(snapshotId).count()) as number
}

/** Deletes all findings for a case (case deletion cascade). */
export async function deleteFindingsForCase(caseId: string): Promise<void> {
  await getDb().findings.where('caseId').equals(caseId).delete()
}

/** Deletes all findings tied to a disclosure snapshot. */
export async function deleteFindingsForSnapshot(snapshotId: string): Promise<void> {
  await getDb().findings.where('snapshotId').equals(snapshotId).delete()
}
