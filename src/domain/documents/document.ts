/**
 * Domain: case documents and their extracted source blocks.
 *
 * Pure TypeScript — no React, Firebase, pdf.js, or IndexedDB imports — so the
 * rules are unit-testable and independent from storage and UI.
 *
 * Pipeline contracts (per the project architecture):
 * - Originals are stored locally; nothing here touches the network.
 * - Blocks are deterministic slices of extracted text with page/line/char
 *   mapping so later evidence features can cite exact sources.
 * - All user-facing failures map to safe error codes; raw driver or parser
 *   details never reach the interface.
 */

export type DocumentKind = 'pdf' | 'text'

export type ProcessingState = 'pending' | 'processing' | 'ready' | 'failed' | 'cancelled'

/** Safe, mapped error codes — the only failure vocabulary shown to users. */
export type DocumentErrorCode =
  | 'file_too_large'
  | 'unsupported_type'
  | 'not_a_pdf'
  | 'text_decode_failed'
  | 'text_too_large'
  | 'pdf_password'
  | 'pdf_invalid'
  | 'pdf_pages_exceeded'
  | 'extract_failed'
  | 'not_found'
  | 'storage_error'
  | 'not_resumable'

export interface DocumentError {
  code: DocumentErrorCode
  message: string
}

/** Approximate bounding box in PDF user-space units (origin bottom-left). */
export interface BlockBox {
  x: number
  y: number
  width: number
  height: number
}

/** Stored case document metadata. Original bytes live in the originals table. */
export interface CaseDocument {
  id: string
  caseId: string
  displayName: string
  kind: DocumentKind
  byteSize: number
  /** SHA-256 hex of the original bytes; used for duplicate detection per case. */
  checksum: string
  processingState: ProcessingState
  /** Total pages for PDFs; null for text files. */
  pageCount: number | null
  /** Checkpoint: highest fully extracted page (PDFs). */
  extractedPages: number
  /** Pages that yielded no text — likely scanned images (OCR is a later phase). */
  pagesWithNoText: number
  blockCount: number
  charCount: number
  /** Bumps if extraction ever re-runs, so citations can detect drift. */
  textVersion: number
  attempts: number
  errorCode?: DocumentErrorCode
  createdAt: number
  updatedAt: number
}

/** One extracted, source-mapped slice of a document's text. */
export interface SourceBlock {
  id: string
  documentId: string
  caseId: string
  /** Global position within the document, ascending. */
  order: number
  /** 1-based page for PDFs; null for text files. */
  pageNumber: number | null
  /** 1-based line range: within the page (PDF) or within the file (text). */
  lineStart: number
  lineEnd: number
  /** Offsets into the document's canonical extracted text (blocks joined by "\n\n"). */
  charStart: number
  charEnd: number
  text: string
  extraction: 'pdfjs' | 'text'
  box?: BlockBox
}

/* ------------------------------------------------------------------ */
/* Limits — deliberately conservative for the MVP; tune via profiling */
/* ------------------------------------------------------------------ */

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PDF_PAGES = 100
export const MAX_TEXT_CHARS = 500_000
export const BLOCK_TARGET_CHARS = 1_000
export const BLOCK_MAX_CHARS = 1_500
export const MAX_DISPLAY_NAME = 120

/* ------------------------------------------------------------------ */
/* Safe error messages                                                 */
/* ------------------------------------------------------------------ */

const ERROR_MESSAGES: Record<DocumentErrorCode, string> = {
  file_too_large: 'This file is larger than the 25 MB limit.',
  unsupported_type: 'Only PDF and plain-text files are supported in this phase.',
  not_a_pdf: 'This file is not a readable PDF.',
  text_decode_failed: 'This file is not readable UTF-8 text.',
  text_too_large: 'This text file is too long to import.',
  pdf_password: 'Password-protected PDFs are not supported yet.',
  pdf_invalid: 'This PDF appears to be damaged or unreadable.',
  pdf_pages_exceeded: 'PDFs over 100 pages are not supported yet.',
  extract_failed: 'Reading this document failed. You can retry.',
  not_found: 'This document is no longer on this device.',
  storage_error: 'Saving the document failed because of a local storage problem.',
  not_resumable: 'This document cannot be resumed.',
}

export function documentError(code: DocumentErrorCode): DocumentError {
  return { code, message: ERROR_MESSAGES[code] }
}

/* ------------------------------------------------------------------ */
/* Kind detection and signature checks                                 */
/* ------------------------------------------------------------------ */

/** Maps a filename to a supported import kind; null when unsupported. */
export function detectKindFromName(name: string): DocumentKind | null {
  const lower = name.trim().toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text'
  return null
}

/** True when the bytes start with the %PDF- header. */
export function isPdfSignature(bytes: Uint8Array): boolean {
  const header = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
  if (bytes.length < header.length) return false
  return header.every((byte, index) => bytes[index] === byte)
}

/** Trims and bounds a user-visible document name. */
export function sanitizeDisplayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return 'Untitled document'
  return trimmed.slice(0, MAX_DISPLAY_NAME)
}

/* ------------------------------------------------------------------ */
/* Record factory and state transitions                                */
/* ------------------------------------------------------------------ */

export function createDocumentRecord(input: {
  id: string
  caseId: string
  displayName: string
  kind: DocumentKind
  byteSize: number
  checksum: string
  createdAt: number
}): CaseDocument {
  return {
    id: input.id,
    caseId: input.caseId,
    displayName: input.displayName,
    kind: input.kind,
    byteSize: input.byteSize,
    checksum: input.checksum,
    processingState: 'pending',
    pageCount: null,
    extractedPages: 0,
    pagesWithNoText: 0,
    blockCount: 0,
    charCount: 0,
    textVersion: 1,
    attempts: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
}

export function beginProcessing(doc: CaseDocument, now: number): CaseDocument {
  return {
    ...doc,
    processingState: 'processing',
    attempts: doc.attempts + 1,
    errorCode: undefined,
    updatedAt: now,
  }
}

export function markReady(
  doc: CaseDocument,
  summary: { pageCount: number | null; pagesWithNoText: number },
  now: number,
): CaseDocument {
  return {
    ...doc,
    processingState: 'ready',
    pageCount: summary.pageCount,
    pagesWithNoText: summary.pagesWithNoText,
    errorCode: undefined,
    updatedAt: now,
  }
}

export function markFailed(doc: CaseDocument, code: DocumentErrorCode, now: number): CaseDocument {
  return { ...doc, processingState: 'failed', errorCode: code, updatedAt: now }
}

export function markCancelled(doc: CaseDocument, now: number): CaseDocument {
  return { ...doc, processingState: 'cancelled', updatedAt: now }
}

/** Only pending, cancelled, or failed documents can be (re)processed. */
export function isResumable(state: ProcessingState): boolean {
  return state === 'pending' || state === 'cancelled' || state === 'failed'
}
