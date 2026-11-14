import Dexie, { type Table } from 'dexie'
import type { PaymentCase } from '../../domain/cases/case'

/**
 * Local case storage.
 *
 * This is the ONLY module that knows DueProof uses IndexedDB for case data.
 * Repositories own persistence; domain rules stay pure. Cases are stored as
 * plain structured-cloneable records (no blobs yet — documents arrive in a
 * later phase).
 */

export interface StoredCase extends PaymentCase {}

/**
 * DueProof's IndexedDB database.
 *
 * Schema versioning rule: NEVER edit an existing version block. Add a new
 * `version(n)` block for schema changes so existing user databases migrate
 * forward. `++id` is avoided on purpose — case IDs are generated in code and
 * stored as the primary key so records stay portable across browsers.
 */
export class DueProofDatabase extends Dexie {
  cases!: Table<StoredCase, string>

  constructor(name = 'dueproof') {
    super(name)
    this.version(1).stores({
      cases: 'id, status, updatedAt',
      // Future tables (documents, facts, findings…) get new version blocks.
    })
  }
}

let dbInstance: DueProofDatabase | null = null

/** Returns the shared database instance (lazily created). */
export function getDb(): DueProofDatabase {
  if (!dbInstance) {
    dbInstance = new DueProofDatabase()
  }
  return dbInstance
}

/** Test seam: inject a separate database (e.g. fake-indexeddb). */
export function setDbForTests(db: DueProofDatabase | null): void {
  dbInstance = db
}
