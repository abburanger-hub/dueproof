import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { DueProofDatabase, setDbForTests } from '../../src/infrastructure/storage/db'
import { saveNewCase, getCase } from '../../src/infrastructure/storage/case-repository'
import {
  importDocument,
  saveExtraction,
  deleteDocument,
  getDocument,
  type BlockLike,
} from '../../src/infrastructure/storage/document-repository'
import {
  saveProposedFacts,
  listCaseFacts,
  applyReview,
  staleFactsForDocument,
  deleteFactsForDocument,
} from '../../src/infrastructure/storage/fact-repository'
import { extractDocumentFacts } from '../../src/application/evidence/extraction-service'
import type { LocalFactExtractor } from '../../src/application/ports/local-fact-extractor'
import type { EvidenceFact } from '../../src/domain/evidence'
import { createFactFromProposal } from '../../src/domain/evidence'

/* Fresh database per test (fake-indexeddb keeps named databases alive). */
let dbCounter = 0
beforeEach(() => {
  dbCounter += 1
  setDbForTests(new DueProofDatabase(`dueproof-evidence-${dbCounter}`))
})

async function makeCase() {
  const result = await saveNewCase({
    title: 'Acme final milestone',
    description: '',
    currency: 'INR',
  })
  if (!result.ok) throw new Error('case setup failed')
  return result.case
}

async function makeReadyDocument(caseId: string, text: string) {
  const imported = await importDocument({
    caseId,
    fileName: 'chat.txt',
    mimeType: 'text/plain',
    bytes: new TextEncoder().encode(text),
  })
  if (!imported.ok) throw new Error('import failed')
  const blocks: BlockLike[] = [
    { order: 0, pageNumber: null, lineStart: 1, lineEnd: 2, charStart: 0, charEnd: text.length, text },
  ]
  const saved = await saveExtraction(imported.document.id, blocks, {
    pageCount: null,
    pagesWithNoText: 0,
    charCount: text.length,
  })
  if (!saved.ok) throw new Error('extraction save failed')
  return saved.document
}

/** Deterministic fake extractor: matches the real port contract exactly. */
function fakeExtractor(
  proposalsPerBlock: (blockText: string) => Array<{ kind: unknown; statement: unknown; quote: unknown }>,
): LocalFactExtractor {
  return {
    async extract(input) {
      return { ok: true, rawProposals: proposalsPerBlock(input.block.text) }
    },
  }
}

describe('fact repository (fake IndexedDB)', () => {
  it('saves proposed facts and lists them with source context', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Total ₹24,000 approved.')

    const fact = createFactFromProposal(
      { kind: 'invoice', statement: 'Invoice total ₹24,000.', quote: 'Total ₹24,000' },
      {
        caseId: testCase.id,
        documentId: document.id,
        blockId: `${document.id}:0`,
        blockText: 'Total ₹24,000 approved.',
        sourceVersion: document.textVersion,
        now: Date.now(),
        caseCurrency: 'INR',
      },
      'ignored-id',
    )
    if (!fact.ok) throw new Error('fact creation failed')

    const saved = await saveProposedFacts([fact.fact])
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const rows = await listCaseFacts(testCase.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.fact.status).toBe('proposed')
    expect(rows[0]?.fact.amount?.minorUnits).toBe(2_400_000)
    expect(rows[0]?.block?.text).toBe('Total ₹24,000 approved.')
    expect(rows[0]?.documentName).toBe('chat.txt')
  })

  it('applies review transitions and hides rejected facts from the list', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Paid ₹10,000 on Monday.')

    const fact = createFactFromProposal(
      { kind: 'payment', statement: 'Partial payment received.', quote: 'Paid ₹10,000' },
      {
        caseId: testCase.id,
        documentId: document.id,
        blockId: `${document.id}:0`,
        blockText: 'Paid ₹10,000 on Monday.',
        sourceVersion: document.textVersion,
        now: Date.now(),
        caseCurrency: 'INR',
      },
      'x',
    )
    if (!fact.ok) throw new Error('setup failed')
    const saved = await saveProposedFacts([fact.fact])
    if (!saved.ok) throw new Error('save failed')
    const factId = saved.value[0]?.id
    if (!factId) throw new Error('no id')

    const confirmed = await applyReview(factId, (existing, now) => ({
      ...existing,
      status: 'user_reviewed',
      updatedAt: now,
    }))
    expect(confirmed.ok).toBe(true)

    await applyReview(factId, (existing, now) => ({
      ...existing,
      status: 'rejected',
      updatedAt: now,
    }))
    const afterReject = await listCaseFacts(testCase.id)
    expect(afterReject).toHaveLength(0)

    await applyReview(factId, (existing, now) => ({
      ...existing,
      status: 'proposed',
      updatedAt: now,
    }))
    expect((await listCaseFacts(testCase.id)).length).toBe(1)
  })

  it('stales facts when a document is re-extracted (quotes dropped, statements kept)', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Old text here.')

    const fact = createFactFromProposal(
      { kind: 'approval', statement: 'Approval received.', quote: 'Old text here' },
      {
        caseId: testCase.id,
        documentId: document.id,
        blockId: `${document.id}:0`,
        blockText: 'Old text here.',
        sourceVersion: document.textVersion,
        now: Date.now(),
        caseCurrency: 'INR',
      },
      'x',
    )
    if (!fact.ok) throw new Error('setup failed')
    const saved = await saveProposedFacts([fact.fact])
    if (!saved.ok) throw new Error('save failed')

    // Simulate a re-extraction that changed the text.
    const record = await getDocument(document.id)
    if (!record) throw new Error('missing document')
    await saveExtraction(
      document.id,
      [{ order: 0, pageNumber: null, lineStart: 1, lineEnd: 1, charStart: 0, charEnd: 12, text: 'New text.' } as BlockLike],
      { pageCount: null, pagesWithNoText: 0, charCount: 9 },
    )
    await staleFactsForDocument(document.id, (record.textVersion ?? 1) + 1)

    const rows = await listCaseFacts(testCase.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.fact.quote).toBeNull()
    expect(rows[0]?.fact.charStart).toBeNull()
    expect(rows[0]?.fact.statement).toBe('Approval received.')
  })

  it('deletes a document and cascades its facts away', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Invoice ₹5,000 due.')

    const fact = createFactFromProposal(
      { kind: 'invoice', statement: 'Invoice for ₹5,000.', quote: 'Invoice ₹5,000' },
      {
        caseId: testCase.id,
        documentId: document.id,
        blockId: `${document.id}:0`,
        blockText: 'Invoice ₹5,000 due.',
        sourceVersion: document.textVersion,
        now: Date.now(),
        caseCurrency: 'INR',
      },
      'x',
    )
    if (!fact.ok) throw new Error('setup failed')
    await saveProposedFacts([fact.fact])

    const removed = await deleteDocument(document.id)
    expect(removed.ok).toBe(true)
    expect(await listCaseFacts(testCase.id)).toHaveLength(0)
    expect(await getDocument(document.id)).toBeNull()
  })

  it('deletes all case facts in the case-deletion cascade', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Any text.')
    const fact = createFactFromProposal(
      { kind: 'other', statement: 'Something.', quote: 'Any text.' },
      {
        caseId: testCase.id,
        documentId: document.id,
        blockId: `${document.id}:0`,
        blockText: 'Any text.',
        sourceVersion: document.textVersion,
        now: Date.now(),
        caseCurrency: 'INR',
      },
      'x',
    )
    if (!fact.ok) throw new Error('setup failed')
    await saveProposedFacts([fact.fact])
    await deleteFactsForDocument(document.id)
    expect(await listCaseFacts(testCase.id)).toHaveLength(0)
    expect(await getCase(testCase.id)).not.toBeNull() // case itself untouched
  })
})

describe('extraction service (fake extractor, no network)', () => {
  it('runs on-device extraction through the port, validates, and saves proposed facts', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(
      testCase.id,
      'We approve the final invoice of ₹24,000. Payment due within 7 days.',
    )

    const extractor = fakeExtractor(() => [
      { kind: 'approval', statement: 'Client approved the invoice.', quote: 'We approve the final invoice' },
      { kind: 'deadline', statement: 'Payment due within a week.', quote: 'Payment due within 7 days' },
      { kind: 'payment', statement: 'Hallucinated quote.', quote: 'This exact sentence is not in the text' },
    ])

    const outcome = await extractDocumentFacts(document.id, extractor)
    expect(outcome.ok).toBe(true)
    expect(outcome.savedFacts).toBe(2) // the hallucinated quote is dropped

    const rows = await listCaseFacts(testCase.id)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.fact.status === 'proposed')).toBe(true)
    expect(rows.every((row) => row.fact.charStart !== null)).toBe(true)
  })

  it('skips blocks whose output is invalid and still reports the run as done', async () => {
    const testCase = await makeCase()
    const document = await makeReadyDocument(testCase.id, 'Some text with no valid facts inside.')

    const extractor = fakeExtractor(() => [
      { kind: 'not-a-kind', statement: 'Bad kind.', quote: 'Some text' },
    ])
    const outcome = await extractDocumentFacts(document.id, extractor)
    expect(outcome.ok).toBe(true)
    // The block itself processed fine; its invalid proposal was dropped by
    // validation. Skips count extraction failures, not rejected candidates.
    expect(outcome.savedFacts).toBe(0)
    expect(outcome.skippedBlocks).toBe(0)
    expect(await listCaseFacts(testCase.id)).toHaveLength(0)
  })

  it('refuses to run for documents that are not ready', async () => {
    const testCase = await makeCase()
    const imported = await importDocument({
      caseId: testCase.id,
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('Pending document.'),
    })
    if (!imported.ok) throw new Error('import failed')

    const outcome = await extractDocumentFacts(imported.document.id, fakeExtractor(() => []))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('not_ready')
  })
})

/** Compile-time reminder of the persisted shape. */
export type { EvidenceFact }

