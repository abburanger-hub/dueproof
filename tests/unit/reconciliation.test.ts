import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { DueProofDatabase, setDbForTests } from '../../src/infrastructure/storage/db'
import { saveNewCase, getCase } from '../../src/infrastructure/storage/case-repository'
import {
  importDocument,
  saveExtraction,
  type BlockLike,
} from '../../src/infrastructure/storage/document-repository'
import { saveProposedFacts, listCaseFacts } from '../../src/infrastructure/storage/fact-repository'
import { createManualFact } from '../../src/domain/evidence'
import {
  approveDisclosure,
  previewDisclosure,
  runReconciliation,
  validateConsent,
} from '../../src/application/reconciliation/reconciliation-service'
import type { CloudReconciler } from '../../src/application/ports/cloud-reconciler'
import { listFindings } from '../../src/infrastructure/storage/finding-repository'
import { deleteCase } from '../../src/infrastructure/storage/case-repository'

let dbCounter = 0
beforeEach(() => {
  dbCounter += 1
  setDbForTests(new DueProofDatabase(`dueproof-recon-${dbCounter}`))
})

async function makeCaseWithReviewedFacts() {
  const created = await saveNewCase({ title: 'Acme milestone', description: '', currency: 'INR' })
  if (!created.ok) throw new Error('case setup failed')
  const paymentCase = created.case

  const a = createManualFact({
    id: 'mf-1',
    caseId: paymentCase.id,
    kind: 'invoice',
    statement: 'Invoice of ₹24,000 raised for the final milestone.',
    amount: { minorUnits: 2_400_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
    date: { text: '12 March 2026', iso: '2026-03-12', precision: 'day' },
    createdAt: Date.now(),
  })
  const b = createManualFact({
    id: 'mf-2',
    caseId: paymentCase.id,
    kind: 'payment',
    statement: 'Client paid ₹10,000 towards the invoice.',
    amount: { minorUnits: 1_000_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
    date: { text: '15 March 2026', iso: '2026-03-15', precision: 'day' },
    createdAt: Date.now(),
  })
  if (!a.ok || !b.ok) throw new Error('fact setup failed')
  const saved = await saveProposedFacts([a.fact, b.fact])
  if (!saved.ok) throw new Error('fact save failed')

  return paymentCase
}

function okReconciler(): CloudReconciler {
  return {
    async reconcile(payload) {
      const first = payload.facts[0]
      return {
        ok: true,
        model: 'gemini-3.5-flash-lite',
        inferenceSource: 'in_cloud',
        rawFindings: [
          {
            type: 'gap',
            evidenceStatus: 'not_found',
            explanation:
              'The supplied records show a payment of ₹10,000 against an invoice of ₹24,000; no record shows the remaining amount being paid.',
            supportingFactIds: payload.facts.map((entry) => entry.factId),
            conflictingFactIds: [],
          },
          {
            type: 'contradiction',
            evidenceStatus: 'conflicting',
            explanation: 'Fabricated conflict for testing.',
            supportingFactIds: ['made-up-id'],
            conflictingFactIds: [],
          },
          {
            type: 'draft_request',
            evidenceStatus: 'supported',
            explanation: 'A polite follow-up could reference the remaining balance.',
            draftText: `Hello, our records show invoice total and a part payment. Could you confirm when the remaining amount will be processed? — ${first?.factId ?? ''}`,
            supportingFactIds: first ? [first.factId] : [],
          },
        ],
      }
    },
  }
}

describe('disclosure preview + approval', () => {
  it('previews a payload containing only the reviewed facts', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const result = await previewDisclosure(paymentCase.id)
    if (!result.ok) throw new Error(result.error.message)

    expect(result.payload.facts).toHaveLength(2)
    expect(result.payload.currency).toBe('INR')
    expect(result.payload.recordedBalance?.balance).toBe(1_400_000)
    // No quotes, no document ids ever leave:
    expect(result.payload.facts.every((entry) => !('quote' in entry))).toBe(true)
  })

  it('refuses to preview when no reviewed facts exist', async () => {
    const created = await saveNewCase({ title: 'Empty', description: '', currency: 'INR' })
    if (!created.ok) throw new Error('setup failed')
    const result = await previewDisclosure(created.case.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('no_eligible_facts')
  })

  it('persists an approval bound to the exact payload and fact versions', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')

    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    expect(approved.ok).toBe(true)
    if (!approved.ok) return

    expect(approved.snapshot.caseId).toBe(paymentCase.id)
    expect(approved.snapshot.includedFactIds).toHaveLength(2)
    expect(Object.keys(approved.snapshot.factVersions)).toHaveLength(2)
    expect(approved.snapshot.consumedAt).toBeNull()
  })
})

describe('consent revalidation (approve-what-you-send)', () => {
  it('accepts an untouched case and a single-use snapshot', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    const validation = await validateConsent(approved.snapshot.id)
    expect(validation.valid).toBe(true)

    const outcome = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(outcome.ok).toBe(true)

    // Single-use: the same approval cannot run twice.
    const second = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error?.code).toBe('already_analyzed')
  })

  it('blocks the send when a fact is edited after approval', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    // Edit one fact (changes updatedAt → fact version drift).
    const rows = await listCaseFacts(paymentCase.id)
    const target = rows[0]?.fact
    if (!target) throw new Error('missing fact')
    const { applyFactEdit } = await import('../../src/domain/evidence')
    const edited = applyFactEdit(
      target,
      { statement: 'Edited after approval.', amount: target.amount, date: target.date },
      Date.now(),
    )
    if (!edited.ok) throw new Error('edit failed')
    const { putFact } = await import('../../src/infrastructure/storage/fact-repository')
    const put = await putFact(edited.fact)
    if (!put.ok) throw new Error('put failed')

    const validation = await validateConsent(approved.snapshot.id)
    expect(validation.valid).toBe(false)
    expect(validation.error?.code).toBe('stale_consent')

    const outcome = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error?.code).toBe('stale_consent')
    expect(await listFindings(paymentCase.id)).toHaveLength(0)
  })

  it('blocks the send when the case revision moved (documents changed etc.)', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    // Importing a document bumps the case revision.
    const imported = await importDocument({
      caseId: paymentCase.id,
      fileName: 'extra.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('Extra record.'),
    })
    if (!imported.ok) throw new Error('import failed')

    const outcome = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error?.code).toBe('stale_consent')
  })
})

describe('finding validation + persistence', () => {
  it('keeps only findings that cite real fact ids, and stores them as proposals', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    const outcome = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The fabricated-id finding was dropped; two remain, both proposals.
    expect(outcome.savedFindings).toBe(2)
    expect(outcome.droppedFindings).toBe(1)

    const findings = await listFindings(paymentCase.id)
    expect(findings).toHaveLength(2)
    expect(findings.every((entry) => entry.finding.status === 'proposed')).toBe(true)
    expect(findings.every((entry) => entry.finding.inferenceSource === 'in_cloud')).toBe(true)
    // Cited statements resolve to real facts:
    expect(findings.every((entry) => entry.citedStatements.length > 0)).toBe(true)
  })

  it('rejects cloud output that did not run in the cloud', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    const badSource: CloudReconciler = {
      async reconcile() {
        return {
          ok: true,
          model: 'gemini-3.5-flash-lite',
          inferenceSource: 'on_device',
          rawFindings: [],
        }
      },
    }
    const outcome = await runReconciliation(approved.snapshot.id, badSource)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error?.code).toBe('unexpected_source')
    expect(await listFindings(paymentCase.id)).toHaveLength(0)
  })

  it('does not consume the approval when the send fails, so an explicit retry is possible', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')

    const failing: CloudReconciler = {
      async reconcile() {
        return {
          ok: false,
          error: { code: 'offline', message: 'offline' },
        }
      },
    }
    const outcome = await runReconciliation(approved.snapshot.id, failing)
    expect(outcome.ok).toBe(false)

    // Same approval can now be retried explicitly:
    const retry = await runReconciliation(approved.snapshot.id, okReconciler())
    expect(retry.ok).toBe(true)
  })
})

describe('case deletion cascade includes disclosures and findings', () => {
  it('removes snapshots and findings with the case', async () => {
    const paymentCase = await makeCaseWithReviewedFacts()
    const preview = await previewDisclosure(paymentCase.id)
    if (!preview.ok) throw new Error('preview failed')
    const approved = await approveDisclosure(paymentCase.id, preview.payload)
    if (!approved.ok) throw new Error('approve failed')
    const run = await runReconciliation(approved.snapshot.id, okReconciler())
    if (!run.ok) throw new Error('run failed')
    expect(await listFindings(paymentCase.id)).toHaveLength(2)

    const removed = await deleteCase(paymentCase.id)
    expect(removed.ok).toBe(true)
    expect(await listFindings(paymentCase.id)).toHaveLength(0)
    expect(await getCase(paymentCase.id)).toBeNull()
  })
})

/** Compile-time fixture: a text document path also works end to end. */
export async function unusedDocumentFixture(caseId: string): Promise<void> {
  const imported = await importDocument({
    caseId,
    fileName: 'chat.txt',
    mimeType: 'text/plain',
    bytes: new TextEncoder().encode('Approved ₹24,000 on 12 March 2026.'),
  })
  if (!imported.ok) return
  const blocks: BlockLike[] = [
    {
      order: 0,
      pageNumber: null,
      lineStart: 1,
      lineEnd: 1,
      charStart: 0,
      charEnd: 33,
      text: 'Approved ₹24,000 on 12 March 2026.',
    },
  ]
  await saveExtraction(imported.document.id, blocks, {
    pageCount: null,
    pagesWithNoText: 0,
    charCount: 33,
  })
}
