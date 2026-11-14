/**
 * Document repository — the persistence boundary for case documents.
 *
 * Responsibilities:
 * - Store originals (bytes stay local; nothing here touches the network).
 * - Persist document metadata and source blocks, with page-checkpointed
 *   resumable processing for PDFs.
 * - Wrap every driver error in the single safe `storage_error` code; raw
 *   driver text never reaches the UI or logs.
 * - Cascade document deletion atomically (blocks + original + record).
 */

import { getDb, type StoredDocument, type StoredOriginal, type StoredSourceBlock } from './db'
import {
  createDocumentRecord,
  documentError,
  detectKindFromName,
  isPdfSignature,
  sanitizeDisplayName,
  MAX_FILE_BYTES,
  type CaseDocument,
  type DocumentError,
  type SourceBlock,
} from '../../domain/documents/document'
import { sha256Hex } from '../documents/checksum'
import { bumpCaseRevision } from './case-repository'
import { BLOCK_JOIN } from '../../domain/documents/blocks'

/** Block shape accepted when saving an extraction (ids assigned here). */
export interface BlockLike {
  order: number
  pageNumber: number | null
  lineStart: number
  lineEnd: number
  charStart: number
  charEnd: number
  text: string
  box?: { x: number; y: number; width: number; height: number }
}

function detectKind(fileName: string): 'pdf' | 'text' | null {
  return detectKindFromName(fileName)
}

export interface ImportInput {
  caseId: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export type DocumentResult<T> = { ok: true; value: T } | { ok: false; error: DocumentError }

function uuid(): string {
  return crypto.randomUUID()
}

function storageError(): DocumentError {
  return documentError('storage_error')
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/**
 * Validates and stores an original plus its document record. Does not
 * extract text — processing is a separate, resumable step.
 */
export async function importDocument(
  input: ImportInput,
): Promise<
  | { ok: true; document: CaseDocument; duplicateOf?: string }
  | { ok: false; error: DocumentError }
> {
  const kind = detectKind(input.fileName)
  if (!kind) return { ok: false, error: documentError('unsupported_type') }
  if (input.bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: documentError('file_too_large') }
  }
  if (kind === 'pdf' && !isPdfSignature(input.bytes)) {
    return { ok: false, error: documentError('not_a_pdf') }
  }

  const checksum = await sha256Hex(input.bytes)
  const db = getDb()

  // Duplicate detection is per case: the same file inside one case is a
  // warning; the same file in another case is not.
  const existing = await db.documents.where('caseId').equals(input.caseId).toArray()
  const duplicate = existing.find((doc) => doc.checksum === checksum)

  const now = Date.now()
  const record = createDocumentRecord({
    id: uuid(),
    caseId: input.caseId,
    displayName: sanitizeDisplayName(input.fileName),
    kind,
    byteSize: input.bytes.byteLength,
    checksum,
    createdAt: now,
  })

  try {
    await db.transaction('rw', db.documents, db.originals, db.cases, async () => {
      await db.originals.put({ documentId: record.id, bytes: input.bytes, mimeType: input.mimeType })
      await db.documents.put(record)
      await db.cases.get(input.caseId).then((caseRow) => {
        if (caseRow) {
          void db.cases.put({ ...caseRow, revision: caseRow.revision + 1, updatedAt: now })
        }
      })
    })
  } catch {
    return { ok: false, error: storageError() }
  }

  return { ok: true, document: record, duplicateOf: duplicate?.id }
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export async function listDocuments(caseId: string): Promise<CaseDocument[]> {
  const rows = await getDb().documents.where('caseId').equals(caseId).toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getDocument(id: string): Promise<CaseDocument | null> {
  return (await getDb().documents.get(id)) ?? null
}

export async function getOriginal(documentId: string): Promise<StoredOriginal | null> {
  return (await getDb().originals.get(documentId)) ?? null
}

export async function getBlocks(documentId: string): Promise<SourceBlock[]> {
  const rows = await getDb().sourceBlocks.where('documentId').equals(documentId).toArray()
  return rows.sort((a, b) => a.order - b.order)
}

/** Loads the canonical document text (blocks joined by BLOCK_JOIN). */
export async function getDocumentText(documentId: string): Promise<string> {
  const blocks = await getBlocks(documentId)
  return blocks.map((block) => block.text).join(BLOCK_JOIN)
}

/* ------------------------------------------------------------------ */
/* Processing state transitions (called by the processing service)     */
/* ------------------------------------------------------------------ */

export async function updateDocumentRecord(
  next: CaseDocument,
): Promise<{ ok: true } | { ok: false; error: DocumentError }> {
  try {
    await getDb().documents.put(next as StoredDocument)
    return { ok: true }
  } catch {
    return { ok: false, error: storageError() }
  }
}

/** Replaces a document's blocks and sets the ready state, atomically. */
export async function saveExtraction(
  documentId: string,
  blocks: BlockLike[],
  summary: { pageCount: number | null; pagesWithNoText: number; charCount: number },
): Promise<{ ok: true; document: CaseDocument } | { ok: false; error: DocumentError }> {
  const db = getDb()
  const record = await db.documents.get(documentId)
  if (!record) return { ok: false, error: documentError('not_found') }

  const next: StoredDocument = {
    ...record,
    processingState: 'ready',
    pageCount: summary.pageCount,
    extractedPages: summary.pageCount ?? blocks.length,
    pagesWithNoText: summary.pagesWithNoText,
    blockCount: blocks.length,
    charCount: summary.charCount,
    textVersion: record.textVersion + 1,
    errorCode: undefined,
    updatedAt: Date.now(),
  }

  try {
    await db.transaction('rw', db.documents, db.sourceBlocks, async () => {
      await db.sourceBlocks.where('documentId').equals(documentId).delete()
      await db.sourceBlocks.bulkPut(
        blocks.map(
          (block) =>
            ({
              ...block,
              id: `${documentId}:${block.order}`,
              documentId,
              caseId: record.caseId,
              extraction: record.kind === 'pdf' ? 'pdfjs' : 'text',
            }) as StoredSourceBlock,
        ),
      )
      await db.documents.put(next)
    })
  } catch {
    return { ok: false, error: storageError() }
  }
  return { ok: true, document: next }
}

/* ------------------------------------------------------------------ */
/* Deletion                                                           */
/* ------------------------------------------------------------------ */

/** Deletes a document with all derived data, atomically. */
export async function deleteDocument(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: DocumentError }> {
  const db = getDb()
  const record = await db.documents.get(documentId)
  if (!record) return { ok: false, error: documentError('not_found') }

  try {
    await db.transaction(
      'rw',
      db.documents,
      db.sourceBlocks,
      db.originals,
      db.cases,
      async () => {
        await db.sourceBlocks.where('documentId').equals(documentId).delete()
        await db.originals.delete(documentId)
        await db.documents.delete(documentId)
        await bumpCaseRevision(record.caseId, Date.now())
      },
    )
  } catch {
    return { ok: false, error: storageError() }
  }
  return { ok: true }
}
