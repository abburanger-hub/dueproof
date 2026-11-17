import { describe, it, expect } from 'vitest'
import {
  buildDisclosure,
  canonicalizeDisclosure,
  DISCLOSURE_SCHEMA,
  MAX_DISCLOSURE_FACTS,
  RECON_PROMPT_VERSION,
  scanSensitive,
  eligibleForDisclosure,
} from '../../src/domain/privacy/disclosure'
import type { EvidenceFact, FactStatus } from '../../src/domain/evidence'

function fact(overrides: Partial<EvidenceFact> & { id: string }): EvidenceFact {
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
    amount: null,
    date: null,
    status: 'user_reviewed',
    sourceVersion: 1,
    manual: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('scanSensitive (deterministic identifier detection)', () => {
  it('detects emails, urls, phones, handles, and pan-like tokens', () => {
    const matches = scanSensitive('Contact me at jane.doe@client.com or +91 98765 43210')
    const categories = matches.map((match) => match.category)
    expect(categories).toContain('email')
    expect(categories).toContain('phone')
  })

  it('detects urls and social handles', () => {
    const matches = scanSensitive('See https://acme.example/x and @acme_support on X')
    const categories = matches.map((match) => match.category)
    expect(categories).toContain('url')
    expect(categories).toContain('handle')
  })

  it('does not treat ISO dates as identifiers', () => {
    const matches = scanSensitive('Payment due 2026-03-14 as agreed on 2026-01-02')
    expect(matches).toHaveLength(0)
  })

  it('returns no matches for clean plain statements', () => {
    const matches = scanSensitive('Client approved the final milestone of the website redesign.')
    expect(matches).toHaveLength(0)
  })
})

describe('buildDisclosure', () => {
  const currency = 'INR'
  const base = { caseCurrency: currency, caseRevision: 3 }

  it('includes reviewed facts and excludes proposed and rejected ones', () => {
    const reviewed = fact({ id: 'f1', status: 'user_reviewed' })
    const proposed = fact({ id: 'f2', status: 'proposed' })
    const rejected = fact({ id: 'f3', status: 'rejected' })

    const result = buildDisclosure([reviewed, proposed, rejected], base)

    expect(result.payload.facts.map((entry) => entry.factId)).toEqual(['f1'])
    expect(result.excluded.map((entry) => entry.reason)).toEqual(['unreviewed', 'rejected'])
  })

  it('excludes sensitive facts by default with the detected reason', () => {
    const clean = fact({ id: 'f1' })
    const sensitive = fact({
      id: 'f2',
      statement: 'He wrote from bigclient@corp.example about the discount.',
    })

    const result = buildDisclosure([clean, sensitive], base)

    expect(result.payload.facts.map((entry) => entry.factId)).toEqual(['f1'])
    const excluded = result.excluded.find((entry) => entry.fact.id === 'f2')
    expect(excluded?.reason).toBe('sensitive')
    expect(excluded?.matches?.length).toBeGreaterThan(0)
  })

  it('sends only fact ids, kinds, statements, amounts, and dates — never quotes or source text', () => {
    const withAmount = fact({
      id: 'f1',
      kind: 'payment',
      statement: 'Client paid ₹5,000 towards the invoice.',
      quote: 'paid Rs.5000 on the 12th',
      amount: { minorUnits: 500_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
      date: { text: 'on 12 March 2026', iso: '2026-03-12', precision: 'day' },
    })

    const result = buildDisclosure([withAmount], base)
    const entry = result.payload.facts[0]
    if (!entry) throw new Error('missing entry')

    expect(Object.keys(entry).sort()).toEqual(['amount', 'date', 'factId', 'kind', 'statement'])
    expect(entry.amount).toEqual({ minorUnits: 500_000, currency: 'INR' })
    expect(entry.date).toEqual({ iso: '2026-03-12', precision: 'day' })
    // The verbatim quote and block ids never leave the device:
    expect(JSON.stringify(result.payload)).not.toContain('paid Rs.5000 on the 12th')
    expect(JSON.stringify(result.payload)).not.toContain('doc-1')
    expect(JSON.stringify(result.payload)).not.toContain('b1')
  })

  it('embeds the app-computed recorded balance instead of asking the model to do arithmetic', () => {
    const charge = fact({
      id: 'f1',
      kind: 'invoice',
      amount: { minorUnits: 2_400_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
    })
    const payment = fact({
      id: 'f2',
      kind: 'payment',
      amount: { minorUnits: 1_000_000, currency: 'INR', ambiguous: false, currencyMismatch: false },
    })

    const result = buildDisclosure([charge, payment], base)

    expect(result.payload.recordedBalance).toEqual({
      charges: 2_400_000,
      payments: 1_000_000,
      credits: 0,
      balance: 1_400_000,
    })
  })

  it('honors an explicit fact selection (consent UI choice, including overrides)', () => {
    const clean = fact({ id: 'f1' })
    const sensitive = fact({ id: 'f2', statement: 'Email him at ceo@bigco.example now.' })

    // The user explicitly includes the sensitive fact after seeing the warning.
    const result = buildDisclosure([clean, sensitive], {
      ...base,
      includedFactIds: new Set(['f2']),
    })

    expect(result.payload.facts.map((entry) => entry.factId)).toEqual(['f2'])
    expect(result.excluded.find((entry) => entry.fact.id === 'f1')?.reason).toBe('not_selected')
  })

  it('caps the payload at the documented maximum and reports capped facts', () => {
    const facts = Array.from({ length: MAX_DISCLOSURE_FACTS + 5 }, (_, index) =>
      fact({ id: `f${index}`, status: 'user_reviewed' }),
    )
    const result = buildDisclosure(facts, base)
    expect(result.payload.facts).toHaveLength(MAX_DISCLOSURE_FACTS)
    expect(result.capped).toHaveLength(5)
  })

  it('returns no_eligible_facts semantics via an empty facts array when nothing qualifies', () => {
    const result = buildDisclosure([fact({ id: 'f1', status: 'proposed' })], base)
    expect(result.payload.facts).toHaveLength(0)
  })
})

describe('canonicalizeDisclosure (approve-what-you-send)', () => {
  it('is stable regardless of object key insertion order', () => {
    const a = {
      schema: DISCLOSURE_SCHEMA,
      currency: 'INR',
      caseRevision: 1,
      promptVersion: RECON_PROMPT_VERSION,
      recordedBalance: null,
      facts: [
        {
          factId: 'f1',
          kind: 'invoice',
          statement: 'Invoice total.',
          amount: { minorUnits: 100, currency: 'INR' },
          date: null,
        },
      ],
    }
    const b = {
      facts: [
        {
          date: null,
          amount: { currency: 'INR', minorUnits: 100 },
          statement: 'Invoice total.',
          kind: 'invoice',
          factId: 'f1',
        },
      ],
      recordedBalance: null,
      promptVersion: RECON_PROMPT_VERSION,
      caseRevision: 1,
      currency: 'INR',
      schema: DISCLOSURE_SCHEMA,
    }
    expect(canonicalizeDisclosure(a)).toBe(canonicalizeDisclosure(b))
  })

  it('changes when any included fact statement changes', () => {
    const payload1 = buildDisclosure([fact({ id: 'f1', statement: 'Approved milestone one.' })], {
      caseCurrency: 'INR',
      caseRevision: 1,
    }).payload
    const payload2 = buildDisclosure([fact({ id: 'f1', statement: 'Approved milestone two.' })], {
      caseCurrency: 'INR',
      caseRevision: 1,
    }).payload
    expect(canonicalizeDisclosure(payload1)).not.toBe(canonicalizeDisclosure(payload2))
  })
})

describe('eligibleForDisclosure', () => {
  it('accepts reviewed, unresolved, and disputed facts only', () => {
    const statuses: FactStatus[] = [
      'proposed',
      'user_reviewed',
      'rejected',
      'disputed',
      'unresolved',
    ]
    const eligible = statuses.filter((status) =>
      eligibleForDisclosure(fact({ id: 'x', status })),
    )
    expect(eligible).toEqual(['user_reviewed', 'disputed', 'unresolved'])
  })
})
