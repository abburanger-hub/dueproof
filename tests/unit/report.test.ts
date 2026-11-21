import { describe, it, expect } from 'vitest'
import {
  composeReport,
  draftLetterTemplate,
  reportError,
  LETTER_MAX,
  type SourceMeta,
} from '../../src/domain/reports/report'
import type { EvidenceFact } from '../../src/domain/evidence'
import type { Finding } from '../../src/domain/reconciliation/finding'
import type { PaymentCase } from '../../src/domain/cases/case'

function fact(overrides: Partial<EvidenceFact> & { id: string }): EvidenceFact {
  const createdAt = 1_700_000_000_000
  return {
    caseId: 'case-1',
    documentId: 'doc-1',
    blockId: 'b1',
    kind: 'invoice',
    statement: 'Invoice total ₹24,000.',
    quote: 'Invoice total ₹24,000',
    charStart: 0,
    charEnd: 20,
    normalizedMatch: false,
    amount: { minorUnits: 2_400_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
    date: { text: '1 October 2026', iso: '2026-10-01', precision: 'day' },
    status: 'user_reviewed',
    sourceVersion: 1,
    manual: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

function finding(overrides: Partial<Finding> & { id: string }): Finding {
  const now = 1_700_000_000_000
  return {
    caseId: 'case-1',
    caseRevision: 1,
    type: 'clarification',
    evidenceStatus: 'supported',
    explanation: 'The invoice amount matches the quotation.',
    unresolvedQuestion: null,
    draftText: null,
    supportingFactIds: ['f1'],
    conflictingFactIds: [],
    status: 'user_reviewed',
    snapshotId: 'snap-1',
    model: 'gemini-3.5-flash-lite',
    promptVersion: 'recon-v1',
    inferenceSource: 'in_cloud',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function paymentCase(): PaymentCase {
  const now = 1_700_000_000_000
  return {
    id: 'case-1',
    title: 'Acme website — final milestone',
    description: '',
    currency: 'INR',
    status: 'active',
    revision: 4,
    createdAt: now,
    updatedAt: now,
  }
}

function meta(overrides: Partial<SourceMeta> & { factId: string }): SourceMeta {
  return {
    documentName: 'invoice.pdf',
    pageNumber: 1,
    lineStart: 10,
    lineEnd: 12,
    sourceMissing: false,
    ...overrides,
  }
}

describe('composeReport', () => {
  const base = {
    paymentCase: paymentCase(),
    sourceMetaById: new Map<string, SourceMeta>([['f1', meta({ factId: 'f1' })]]),
    letter: 'Please confirm the balance.',
    now: 1_700_000_000_123,
  }

  it('includes only reviewed/unresolved facts and non-rejected findings', () => {
    const result = composeReport({
      ...base,
      facts: [
        fact({ id: 'f1' }),
        fact({ id: 'proposed', status: 'proposed' }),
        fact({ id: 'rejected', status: 'rejected' }),
      ],
      findings: [finding({ id: 'kept' }), finding({ id: 'discarded', status: 'rejected' })],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.report.facts.map((f) => f.id)).toEqual(['f1'])
    expect(result.report.findings.map((f) => f.id)).toEqual(['kept'])
  })

  it('keeps source references and flags facts whose source no longer resolves', () => {
    const result = composeReport({
      ...base,
      sourceMetaById: new Map<string, SourceMeta>([
        ['f1', meta({ factId: 'f1', sourceMissing: true })],
      ]),
      facts: [fact({ id: 'f1' })],
      findings: [],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.report.facts[0]?.source?.sourceMissing).toBe(true)
    expect(result.report.facts[0]?.source?.documentName).toBe('invoice.pdf')
  })

  it('embeds the deterministic ledger and timeline from the same facts', () => {
    const result = composeReport({
      ...base,
      facts: [
        fact({ id: 'f1' }),
        fact({
          id: 'pay',
          kind: 'payment',
          statement: 'Partial payment received.',
          amount: { minorUnits: 1_000_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
        }),
      ],
      findings: [],
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.report.ledger.totals?.recordedBalance).toBe(1_400_000)
    expect(result.report.timeline.groups.length).toBeGreaterThan(0)
    expect(result.report.caseRevision).toBe(4)
  })

  it('refuses an empty letter and an overlong letter', () => {
    const empty = composeReport({ ...base, letter: '   ', facts: [], findings: [] })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error.code).toBe('letter_empty')

    const overlong = composeReport({
      ...base,
      letter: 'x'.repeat(LETTER_MAX + 1),
      facts: [],
      findings: [],
    })
    expect(overlong.ok).toBe(false)
    if (!overlong.ok) expect(overlong.error.code).toBe('letter_too_long')
  })
})

describe('draftLetterTemplate', () => {
  it('seeds a neutral letter that states the recorded balance honestly', () => {
    const withBalance = draftLetterTemplate({
      title: 'Acme website',
      currency: 'INR',
      recordedBalanceMinorUnits: 1_400_000,
    })
    expect(withBalance).toContain('14,000') // 1_400_000 minor / 100 with en-IN grouping
    expect(withBalance).toContain('Acme website')

    const noBalance = draftLetterTemplate({
      title: 'Acme website',
      currency: 'INR',
      recordedBalanceMinorUnits: null,
    })
    expect(noBalance).toContain('not yet determined')
  })
})

describe('report error vocabulary', () => {
  it('maps every code to a safe human message', () => {
    for (const code of ['not_found', 'letter_empty', 'letter_too_long', 'storage_error'] as const) {
      expect(reportError(code).message.length).toBeGreaterThan(10)
    }
  })
})
