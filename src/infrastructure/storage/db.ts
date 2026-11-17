import Dexie, { type Table } from 'dexie'
import type { PaymentCase } from '../../domain/cases/case'
import type { CaseDocument, SourceBlock } from '../../domain/documents/document'
import type { EvidenceFact } from '../../domain/evidence'
import type { Finding } from '../../domain/reconciliation/finding'

/**
 * Local case + document storage.
 *
 * This is the ONLY module that knows DueProof uses IndexedDB. Repositories
 * own persistence; domain rules stay pure. Records are plain structured-
 * cloneable values. Original file bytes are stored as Uint8Array (not Blob)
 * so the same code path works in browsers and in Node-based tests.
 */

export interface StoredCase extends PaymentCase {}
export interface StoredDocument extends CaseDocument {}
export interface StoredSourceBlock extends SourceBlock {}
export interface StoredEvidenceFact extends EvidenceFact {}

/** The original file bytes for one document, keyed by document id. */
export interface StoredOriginal {
  documentId: string
  bytes: Uint8Array
  mimeType: string
}

/**
 * An approved disclosure snapshot — the consent record. Stores the exact
 * canonical payload and its digest, the included fact ids with their
 * `updatedAt` versions, and the case revision at approval time. The
 * reconciliation service revalidates all of it byte-for-byte before any
 * cloud send; any drift blocks the send with `stale_consent`.
 */
export interface StoredDisclosure {
  id: string
  caseId: string
  caseRevision: number
  canonicalPayload: string
  digest: string
  includedFactIds: string[]
  factVersions: Record<string, number>
  promptVersion: string
  approvedAt: number
  consumedAt: number | null
}

/** A reconciliation finding produced from one approved disclosure. */
export interface StoredFinding extends Finding {}

/**
 * DueProof's IndexedDB database.
 *
 * Schema versioning rule: NEVER edit an existing version block. Add a new
 * `version(n)` block for schema changes so existing user databases migrate
 * forward. `++id` is avoided on purpose — IDs are generated in code and
 * stored as primary keys so records stay portable across browsers.
 */
export class DueProofDatabase extends Dexie {
  cases!: Table<StoredCase, string>
  documents!: Table<StoredDocument, string>
  sourceBlocks!: Table<StoredSourceBlock, string>
  originals!: Table<StoredOriginal, string>
  facts!: Table<StoredEvidenceFact, string>
  disclosures!: Table<StoredDisclosure, string>
  findings!: Table<StoredFinding, string>

  constructor(name = 'dueproof') {
    super(name)
    this.version(1).stores({
      cases: 'id, status, updatedAt',
    })
    this.version(2).stores({
      cases: 'id, status, updatedAt',
      documents: 'id, caseId, updatedAt',
      sourceBlocks: 'id, documentId, caseId, order',
      originals: 'documentId',
    })
    // Version 3 adds evidence facts. Versions 1–2 are NEVER edited so existing
    // user databases migrate forward safely.
    this.version(3).stores({
      cases: 'id, status, updatedAt',
      documents: 'id, caseId, updatedAt',
      sourceBlocks: 'id, documentId, caseId, order',
      originals: 'documentId',
      facts: 'id, caseId, documentId, blockId, status, updatedAt',
    })
    // Version 4 adds approved disclosure snapshots and reconciliation
    // findings. Versions 1–3 are never edited; databases migrate forward.
    this.version(4).stores({
      cases: 'id, status, updatedAt',
      documents: 'id, caseId, updatedAt',
      sourceBlocks: 'id, documentId, caseId, order',
      originals: 'documentId',
      facts: 'id, caseId, documentId, blockId, status, updatedAt',
      disclosures: 'id, caseId, approvedAt',
      findings: 'id, caseId, snapshotId, status, caseRevision',
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
