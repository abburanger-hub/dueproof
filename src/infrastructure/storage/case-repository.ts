import { getDb, type StoredCase } from './db'
import type { CaseError, PaymentCase } from '../../domain/cases/case'
import {
  createCase,
  renameCase,
  setCaseStatus,
} from '../../domain/cases/case'

/**
 * Case repository — the persistence boundary for payment cases.
 *
 * Use cases live in the application layer; this file only maps between the
 * database and the domain, wraps Dexie errors, and keeps transactions safe.
 * IDs are UUIDs generated with the platform crypto API (available in all
 * modern browsers and Node 18+ for tests).
 */

function uuid(): string {
  return crypto.randomUUID()
}

/** Wraps unexpected storage failures in the domain error shape. */
function storageError(_err?: unknown): CaseError {
  return {
    code: 'storage_error',
    message: 'Saving the case failed because of a local storage problem.',
  }
}

/** Lists cases ordered by most recently updated. */
export async function listCases(
  filter?: { status?: 'active' | 'archived' },
): Promise<PaymentCase[]> {
  const db = getDb()
  const rows = filter?.status
    ? await db.cases.where('status').equals(filter.status).toArray()
    : await db.cases.toArray()
  return rows.sort((a: StoredCase, b: StoredCase) => b.updatedAt - a.updatedAt)
}

/** Creates a case after domain validation; fails on storage errors. */
export async function saveNewCase(input: {
  title: string
  description: string
  currency: string
}): Promise<{ ok: true; case: PaymentCase } | { ok: false; error: CaseError }> {
  const created = createCase({
    id: uuid(),
    title: input.title,
    description: input.description,
    currency: input.currency,
    createdAt: Date.now(),
  })
  if (!created.ok) return created

  try {
    await getDb().cases.put(created.case as StoredCase)
    return { ok: true, case: created.case }
  } catch {
    // Driver-specific failures are converted to a safe storage error; raw
    // details never reach the UI or logs.
    return { ok: false, error: storageError() }
  }
}

/** Loads a single case by ID. */
export async function getCase(id: string): Promise<PaymentCase | null> {
  return (await getDb().cases.get(id)) ?? null
}

/** Persists an already-validated domain case (used after rename/archive). */
export async function updateCase(
  next: PaymentCase,
): Promise<{ ok: true; case: PaymentCase } | { ok: false; error: CaseError }> {
  try {
    await getDb().cases.put(next as StoredCase)
    return { ok: true, case: next }
  } catch {
    // Driver-specific failures are converted to a safe storage error; raw
    // details never reach the UI or logs.
    return { ok: false, error: storageError() }
  }
}

/**
 * Deletes a case permanently — a transactional cascade that removes the
 * case record, every document, every extracted source block, and every
 * stored original in one atomic transaction. Partial deletion must never
 * leave orphaned evidence behind (a hard rule from the project context).
 */
export async function deleteCase(
  id: string,
): Promise<{ ok: true } | { ok: false; error: CaseError }> {
  try {
    const db = getDb()
    await db.transaction('rw', db.cases, db.documents, db.sourceBlocks, db.originals, async () => {
      const documentIds = (await db.documents
        .where('caseId')
        .equals(id)
        .primaryKeys()) as string[]
      await db.sourceBlocks.where('caseId').equals(id).delete()
      await db.originals.bulkDelete(documentIds)
      await db.documents.where('caseId').equals(id).delete()
      await db.cases.delete(id)
    })
    return { ok: true }
  } catch {
    // Driver-specific failures are converted to a safe storage error; raw
    // details never reach the UI or logs.
    return { ok: false, error: storageError() }
  }
}

/**
 * Bumps a case's revision (evidence changed). Returns the updated case, or
 * null when the case no longer exists.
 */
export async function bumpCaseRevision(
  id: string,
  now: number,
): Promise<PaymentCase | null> {
  const db = getDb()
  const record = await db.cases.get(id)
  if (!record) return null
  const next: StoredCase = {
    ...record,
    revision: record.revision + 1,
    updatedAt: now,
  }
  await db.cases.put(next)
  return next
}

/* Re-export domain helpers used by UI use cases for convenience. */
export { renameCase, setCaseStatus }
