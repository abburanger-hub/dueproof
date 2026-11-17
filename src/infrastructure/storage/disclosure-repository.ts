/**
 * Disclosure snapshot repository — the persistence boundary for consent.
 *
 * An approval is payload-specific: the snapshot stores the exact canonical
 * payload string and its digest, so the reconciliation service can prove
 * the bytes that leave the device are the bytes the user approved.
 *
 * The digest detects accidental drift (a fact edited after approval). It is
 * NOT a security boundary against malicious application code — that threat
 * model is out of scope for a client-only app and documented as such.
 */

import { getDb, type StoredDisclosure } from './db'
import type { DisclosurePayload } from '../../domain/privacy/disclosure'
import { canonicalizeDisclosure } from '../../domain/privacy/disclosure'
import { reconciliationError, type ReconciliationError } from '../../domain/reconciliation/finding'

export type DisclosureResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ReconciliationError }

function uuid(): string {
  return crypto.randomUUID()
}

/** SHA-256 hex digest of the canonical payload — the approve-what-you-send proof. */
export async function digestCanonicalPayload(payload: DisclosurePayload): Promise<string> {
  const canonical = canonicalizeDisclosure(payload)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical) as unknown as ArrayBuffer,
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Persists an approval. `factVersions` records each included fact's
 * `updatedAt` so later edits (which change `updatedAt`) invalidate consent
 * even when a rebuilt payload happens to digest the same.
 */
export async function saveDisclosureSnapshot(input: {
  caseId: string
  payload: DisclosurePayload
  factVersions: Record<string, number>
}): Promise<DisclosureResult<StoredDisclosure>> {
  const canonical = canonicalizeDisclosure(input.payload)
  const digest = await digestCanonicalPayload(input.payload)
  const record: StoredDisclosure = {
    id: uuid(),
    caseId: input.caseId,
    caseRevision: input.payload.caseRevision,
    canonicalPayload: canonical,
    digest,
    includedFactIds: input.payload.facts.map((entry) => entry.factId),
    factVersions: input.factVersions,
    promptVersion: input.payload.promptVersion,
    approvedAt: Date.now(),
    consumedAt: null,
  }
  try {
    await getDb().disclosures.put(record)
    return { ok: true, value: record }
  } catch {
    return { ok: false, error: reconciliationError('storage_error') }
  }
}

/** Loads a snapshot by id. */
export async function getDisclosure(id: string): Promise<StoredDisclosure | null> {
  return (await getDb().disclosures.get(id)) ?? null
}

/** Lists a case's snapshots, most recent first. */
export async function listDisclosures(caseId: string): Promise<StoredDisclosure[]> {
  const rows = await getDb().disclosures.where('caseId').equals(caseId).toArray()
  return rows.sort((a, b) => b.approvedAt - a.approvedAt)
}

/** The stored snapshot shape, re-exported for the application service. */
export type StoredDisclosureLike = StoredDisclosure

/** Marks a snapshot consumed so the same approval cannot run twice. */
export async function markDisclosureConsumed(id: string): Promise<void> {
  const db = getDb()
  const record = await db.disclosures.get(id)
  if (record) {
    await db.disclosures.put({ ...record, consumedAt: Date.now() })
  }
}

/** Deletes all snapshots for a case (case deletion cascade). */
export async function deleteDisclosuresForCase(caseId: string): Promise<void> {
  await getDb().disclosures.where('caseId').equals(caseId).delete()
}
