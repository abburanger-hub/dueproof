/**
 * Application: full local wipe.
 *
 * A destructive, explicit, user-confirmed action that erases EVERY DueProof
 * record from this device's IndexedDB: cases, documents, extracted blocks,
 * original file bytes, facts, disclosure snapshots, and findings.
 *
 * Honesty rules:
 * - The confirmation copy states plainly that deletion is permanent, local,
 *   and does not recall payloads already sent to the cloud provider.
 * - The UI must require a typed confirmation phrase before calling this.
 * - Errors surface as a safe code; raw driver details never reach the UI.
 */

import { getDb } from '../../infrastructure/storage/db'

export type WipeErrorCode = 'storage_error' | 'cancelled'

export interface WipeError {
  code: WipeErrorCode
  message: string
}

export type WipeResult = { ok: true } | { ok: false; error: WipeError }

/** Counts every local record, for display before confirmation. */
export async function countLocalData(): Promise<{
  cases: number
  documents: number
  facts: number
  findings: number
}> {
  const db = getDb()
  return {
    cases: await db.cases.count(),
    documents: await db.documents.count(),
    facts: await db.facts.count(),
    findings: await db.findings.count(),
  }
}

/** The phrase the user must type to confirm the wipe. */
export const WIPE_CONFIRM_PHRASE = 'erase'

/**
 * Erases all DueProof data from this device. Destructive and irreversible.
 * `confirmPhrase` must equal {@link WIPE_CONFIRM_PHRASE}; anything else is
 * rejected as `cancelled` so a stray double-click can never wipe data.
 */
export async function wipeAllLocalData(confirmPhrase: string): Promise<WipeResult> {
  if (confirmPhrase.trim().toLowerCase() !== WIPE_CONFIRM_PHRASE) {
    return { ok: false, error: { code: 'cancelled', message: 'Confirmation phrase did not match.' } }
  }
  const db = getDb()
  try {
    await db.transaction(
      'rw',
      [db.cases, db.documents, db.sourceBlocks, db.originals, db.facts, db.disclosures, db.findings],
      async () => {
        await db.cases.clear()
        await db.documents.clear()
        await db.sourceBlocks.clear()
        await db.originals.clear()
        await db.facts.clear()
        await db.disclosures.clear()
        await db.findings.clear()
      },
    )
    return { ok: true }
  } catch {
    return { ok: false, error: { code: 'storage_error', message: 'Erasing local data failed.' } }
  }
}
