import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { DueProofDatabase, setDbForTests } from '../../src/infrastructure/storage/db'
import {
  buildBlocksFromLines,
  buildBlocksFromText,
  documentTextFromBlocks,
  groupItemsIntoLines,
  BLOCK_JOIN,
  type NormalizedTextItem,
} from '../../src/domain/documents/blocks'
import {
  detectKindFromName,
  documentError,
  isPdfSignature,
  sanitizeDisplayName,
  MAX_PDF_PAGES,
} from '../../src/domain/documents/document'
import { decodeTextBytes } from '../../src/infrastructure/documents/text-decoder'
import {
  importDocument,
  getDocument,
  listDocuments,
  getBlocks,
  saveExtraction,
  deleteDocument,
  type BlockLike,
} from '../../src/infrastructure/storage/document-repository'
import { getCase, saveNewCase } from '../../src/infrastructure/storage/case-repository'
import type { StoredDocument } from '../../src/infrastructure/storage/db'

/* Fresh database per test (fake-indexeddb keeps named databases alive). */
let dbCounter = 0
beforeEach(() => {
  dbCounter += 1
  setDbForTests(new DueProofDatabase(`dueproof-test-${dbCounter}`))
})

function item(str: string, y = 100, x = 10, height = 10, width?: number, hasEOL = false): NormalizedTextItem {
  return { str, hasEOL, x, y, width: width ?? str.length * 5, height }
}

describe('document kind + signature detection', () => {
  it('detects pdf and text kinds from filenames', () => {
    expect(detectKindFromName('invoice.pdf')).toBe('pdf')
    expect(detectKindFromName('QUOTE.PDF')).toBe('pdf')
    expect(detectKindFromName('notes.txt')).toBe('text')
    expect(detectKindFromName('chat.md')).toBe('text')
    expect(detectKindFromName('photo.png')).toBeNull()
    expect(detectKindFromName('file.docx')).toBeNull()
  })

  it('checks the %PDF- signature on bytes', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    expect(isPdfSignature(pdf)).toBe(true)
    const notPdf = new Uint8Array([0x74, 0x68, 0x69, 0x73, 0x20, 0x69, 0x73])
    expect(isPdfSignature(notPdf)).toBe(false)
    expect(isPdfSignature(new Uint8Array(2))).toBe(false)
  })

  it('sanitizes display names safely', () => {
    expect(sanitizeDisplayName('  My   Invoice.pdf ')).toBe('My Invoice.pdf')
    expect(sanitizeDisplayName('   ')).toBe('Untitled document')
    expect(sanitizeDisplayName('x'.repeat(200)).length).toBe(120)
  })
})

describe('line grouping and block building', () => {
  it('groups items into lines using baselines and EOL markers', () => {
    const lines = groupItemsIntoLines([
      item('Hello '),
      item('world', 100, 40),
      item('next line', 80),
      item('after eol', 80, 10, 10, 50, true),
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]?.text).toBe('Hello world')
    expect(lines[0]?.lineNo).toBe(1)
    expect(lines[1]?.text).toBe('next lineafter eol')
  })

  it('skips leading noise items; a lone EOL flushes the current line', () => {
    const lines = groupItemsIntoLines([
      item(''),
      item('A'),
      item('', 100, 10, 10, 0, true),
      item('B', 100, 10),
    ])
    // The EOL marker after 'A' flushes the 'A' line; 'B' starts a new line on
    // the same baseline (pdf.js marks new visual lines with hasEOL or a
    // baseline move — here the marker already closed the previous line).
    expect(lines).toHaveLength(2)
    expect(lines[0]?.text).toBe('A')
    expect(lines[1]?.text).toBe('B')
  })

  it('builds bounded blocks and reconstructs the canonical text exactly', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      text: `Line ${i + 1} with some content`,
      lineNo: i + 1,
    }))
    const blocks = buildBlocksFromLines(lines, 3)
    expect(blocks.length).toBeGreaterThan(1)
    for (const block of blocks) {
      expect(block.text.length).toBeLessThanOrEqual(1500)
      expect(block.pageNumber).toBe(3)
    }

    // The join invariant: every block slice equals its text at its offsets.
    const canonical = documentTextFromBlocks(blocks)
    for (const block of blocks) {
      expect(canonical.slice(block.charStart, block.charEnd)).toBe(block.text)
    }
    // And blocks are in ascending, contiguous order.
    for (let i = 1; i < blocks.length; i += 1) {
      const prev = blocks[i - 1]
      const current = blocks[i]
      if (prev && current) {
        expect(current.charStart).toBe(prev.charEnd + BLOCK_JOIN.length)
        expect(current.order).toBe(prev.order + 1)
        expect(current.lineStart).toBeGreaterThan(prev.lineEnd)
      }
    }
  })

  it('keeps a single over-long line intact as its own block', () => {
    const long = 'w'.repeat(2000)
    const blocks = buildBlocksFromText(long)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe(long)
    expect(blocks[0]?.lineStart).toBe(1)
    expect(blocks[0]?.lineEnd).toBe(1)
  })

  it('builds text-file blocks with file-level line numbers', () => {
    const blocks = buildBlocksFromText('First\n\nSecond line\nThird line')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.lineStart).toBe(1)
    expect(blocks[0]?.lineEnd).toBe(4)
    expect(blocks[0]?.text).toBe('First\nSecond line\nThird line')
    expect(blocks[0]?.pageNumber).toBeNull()
  })
})

describe('text decoding', () => {
  it('decodes valid UTF-8 text within limits', () => {
    const bytes = new TextEncoder().encode('Payment of ₹24,000 was agreed.')
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.text).toContain('₹24,000')
  })

  it('rejects undecodable binary content', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe])
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('text_decode_failed')
  })
})

describe('document repository (fake IndexedDB)', () => {
  async function makeCase() {
    const result = await saveNewCase({ title: 'Acme milestone', description: '', currency: 'INR' })
    if (!result.ok) throw new Error('case setup failed')
    return result.case
  }

  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])

  it('imports a pdf, bumps the case revision, and lists it', async () => {
    const testCase = await makeCase()
    const before = testCase.revision

    const imported = await importDocument({
      caseId: testCase.id,
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.document.kind).toBe('pdf')
    expect(imported.document.processingState).toBe('pending')
    expect(imported.duplicateOf).toBeUndefined()

    const rows = await listDocuments(testCase.id)
    expect(rows).toHaveLength(1)

    const updatedCase = await getCase(testCase.id)
    expect(updatedCase?.revision).toBe(before + 1)
  })

  it('rejects unsupported and non-pdf files with safe errors', async () => {
    const testCase = await makeCase()
    const png = await importDocument({
      caseId: testCase.id,
      fileName: 'photo.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(png.ok).toBe(false)
    if (png.ok) return
    expect(png.error.code).toBe('unsupported_type')

    const fake = await importDocument({
      caseId: testCase.id,
      fileName: 'not-really.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([0x74, 0x68, 0x69, 0x73]),
    })
    expect(fake.ok).toBe(false)
    if (fake.ok) return
    expect(fake.error.code).toBe('not_a_pdf')
  })

  it('flags a duplicate file within the same case', async () => {
    const testCase = await makeCase()
    const first = await importDocument({
      caseId: testCase.id,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    })
    const second = await importDocument({
      caseId: testCase.id,
      fileName: 'same-bytes.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    })
    expect(first.ok && second.ok).toBe(true)
    expect(second.ok ? second.duplicateOf : undefined).toBeDefined()
  })

  it('saves extraction blocks atomically and reads them back in order', async () => {
    const testCase = await makeCase()
    const imported = await importDocument({
      caseId: testCase.id,
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    })
    if (!imported.ok) throw new Error('import failed')

    const blocks: BlockLike[] = [
      {
        order: 0,
        pageNumber: 1,
        lineStart: 1,
        lineEnd: 2,
        charStart: 0,
        charEnd: 23,
        text: 'Invoice #104\nTotal: ₹24,000',
      },
      {
        order: 1,
        pageNumber: 2,
        lineStart: 1,
        lineEnd: 1,
        charStart: 25,
        charEnd: 42,
        text: 'Payment due in 7 days',
      },
    ]
    const saved = await saveExtraction(imported.document.id, blocks, {
      pageCount: 2,
      pagesWithNoText: 0,
      charCount: 45,
    })
    expect(saved.ok).toBe(true)

    const stored = await getBlocks(imported.document.id)
    expect(stored).toHaveLength(2)
    expect(stored[0]?.id).toBe(`${imported.document.id}:0`)
    expect(stored[0]?.caseId).toBe(testCase.id)
    expect(stored[0]?.extraction).toBe('pdfjs')

    const record = await getDocument(imported.document.id) as StoredDocument | null
    expect(record?.processingState).toBe('ready')
    expect(record?.blockCount).toBe(2)
    expect(record?.textVersion).toBe(2)
  })

  it('deletes a document and its blocks atomically', async () => {
    const testCase = await makeCase()
    const imported = await importDocument({
      caseId: testCase.id,
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
    })
    if (!imported.ok) throw new Error('import failed')
    await saveExtraction(imported.document.id, [], { pageCount: 1, pagesWithNoText: 1, charCount: 0 })

    const removed = await deleteDocument(imported.document.id)
    expect(removed.ok).toBe(true)
    expect(await getDocument(imported.document.id)).toBeNull()
    expect(await getBlocks(imported.document.id)).toHaveLength(0)
  })

  it('maps safe error codes to human messages', () => {
    expect(documentError('pdf_password').message).toContain('Password-protected')
    expect(documentError(MAX_PDF_PAGES > 0 ? 'pdf_pages_exceeded' : 'extract_failed').message).toContain('100 pages')
  })
})
