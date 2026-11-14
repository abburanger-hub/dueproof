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
 * Deletes a case permanently. Phase 2 deletes the case record; once
 * documents/facts exist, this must become a transactional cascade that also
 * removes every dependent record (a hard rule from the project context).
 */
export async function deleteCase(
  id: string,
): Promise<{ ok: true } | { ok: false; error: CaseError }> {
  try {
    await getDb().cases.delete(id)
    return { ok: true }
  } catch {
    // Driver-specific failures are converted to a safe storage error; raw
    // details never reach the UI or logs.
    return { ok: false, error: storageError() }
  }
}

/* Re-export domain helpers used by UI use cases for convenience. */
export { renameCase, setCaseStatus }
