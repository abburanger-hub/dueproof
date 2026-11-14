import { describe, it, expect } from 'vitest'
import {
  capProposals,
  createFactFromProposal,
  dedupeProposals,
  parseProposalJson,
  validateRawProposal,
} from '../../src/domain/evidence'
import type { ValidatedProposal } from '../../src/domain/evidence'
import { locateQuote, normalizeQuote } from '../../src/domain/evidence/quote-utils'
import {
  detectCurrencySymbol,
  parseAmountFromQuote,
  parseDateFromQuote,
} from '../../src/domain/evidence/parse'
import {
  applyFactEdit,
  applyFactStatus,
  createManualFact,
  nextStatusForAction,
  normalizeKind,
} from '../../src/domain/evidence/fact'
import { formatMinorUnits } from '../../src/domain/evidence/format'
import type { EvidenceFact } from '../../src/domain/evidence'

describe('raw proposal validation', () => {
  it('accepts a well-formed proposal', () => {
    const outcome = validateRawProposal({
      kind: 'payment',
      statement: 'Client paid ₹12,000 on 3 October.',
      quote: 'Paid ₹12,000 via UPI on 3 Oct',
    })
    expect(outcome.ok).toBe(true)
  })

  it('rejects unknown kinds, empty fields, and overlong text', () => {
    expect(validateRawProposal({ kind: 'nonsense', statement: 's', quote: 'q' }).ok).toBe(false)
    expect(validateRawProposal({ kind: 'payment', statement: '', quote: 'q' }).ok).toBe(false)
    expect(
      validateRawProposal({ kind: 'payment', statement: 'x'.repeat(201), quote: 'q' }).ok,
    ).toBe(false)
    expect(validateRawProposal({ kind: 'payment', statement: 's', quote: '' }).ok).toBe(false)
    expect(
      validateRawProposal({ kind: 'payment', statement: 's', quote: 'q'.repeat(401) }).ok,
    ).toBe(false)
    expect(validateRawProposal({ kind: 7, statement: 's', quote: 'q' }).ok).toBe(false)
  })

  it('dedupes identical quotes within a batch and caps the count', () => {
    const make = (): ValidatedProposal => ({
      kind: 'approval',
      statement: 'Approved',
      quote: 'Looks good, go ahead',
    })
    const unique = dedupeProposals([make(), make(), { ...make(), quote: 'Different words' }])
    expect(unique).toHaveLength(2)

    const many: ValidatedProposal[] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'other',
      statement: `Statement ${index}`,
      quote: `Quote number ${index} here`,
    }))
    expect(capProposals(many)).toHaveLength(4)
  })

  it('parses proposal JSON arrays without throwing', () => {
    expect(parseProposalJson('not json')).toBeNull()
    expect(parseProposalJson('{"facts": [{"kind":"payment"}]}')).toBeNull() // not an array shape
    const parsed = parseProposalJson('[{"kind":"payment","statement":"s","quote":"q"}]')
    expect(Array.isArray(parsed)).toBe(true)
  })
})

describe('quote location (the citation verifier)', () => {
  it('finds an exact quote and returns original-text offsets', () => {
    const block = 'Invoice total: ₹24,000.\nPayment due within 7 days.'
    const location = locateQuote(block, 'Invoice total: ₹24,000.')
    expect(location).not.toBeNull()
    expect(location?.normalizedMatch).toBe(false)
    expect(block.slice(location?.start ?? -1, location?.end ?? -1)).toBe('Invoice total: ₹24,000.')
  })

  it('finds a quote that only differs in whitespace and marks it normalized', () => {
    const block = 'We   approve\nthe   final revision'
    const location = locateQuote(block, 'We approve the final revision')
    expect(location).not.toBeNull()
    expect(location?.normalizedMatch).toBe(true)
  })

  it('returns null for a quote that is not in the block — never guesses', () => {
    const block = 'Approved the first revision only.'
    expect(locateQuote(block, 'Approved the final revision')).toBeNull()
    expect(normalizeQuote('  Hello   world  ')).toBe('Hello world')
  })
})

describe('deterministic amount parsing', () => {
  it('parses plain and Indian-grouped amounts into minor units', () => {
    expect(parseAmountFromQuote('Total ₹24,000')?.minorUnits).toBe(2_400_000)
    expect(parseAmountFromQuote('Paid Rs. 1,20,000 today')?.minorUnits).toBe(12_000_000)
    expect(parseAmountFromQuote('$1,500.50')?.minorUnits).toBe(150_050)
    expect(parseAmountFromQuote('120000')?.minorUnits).toBe(12_000_000)
  })

  it('detects currency hints and flags multiple values as ambiguous', () => {
    expect(detectCurrencySymbol('₹24,000')).toBe('INR')
    expect(detectCurrencySymbol('USD 500')).toBe('USD')
    expect(detectCurrencySymbol('no money here')).toBeNull()
    expect(parseAmountFromQuote('Paid ₹10,000 of ₹24,000')?.ambiguous).toBe(true)
    expect(parseAmountFromQuote('Paid ₹10,000 of ₹24,000')?.minorUnits).toBe(1_000_000)
  })

  it('returns null when no amount exists', () => {
    expect(parseAmountFromQuote('Thanks for the update')).toBeNull()
  })
})

describe('deterministic date parsing', () => {
  it('parses ISO, written, and unambiguous numeric dates', () => {
    expect(parseDateFromQuote('Due 2026-11-30')?.iso).toBe('2026-11-30')
    expect(parseDateFromQuote('Paid on 30 November 2026')?.iso).toBe('2026-11-30')
    expect(parseDateFromQuote('November 30, 2026 confirmed')?.iso).toBe('2026-11-30')
    expect(parseDateFromQuote('Due 30/11/2026')?.iso).toBe('2026-11-30')
    expect(parseDateFromQuote('Due 11/30/2026')?.iso).toBe('2026-11-30')
  })

  it('keeps genuinely ambiguous or relative dates honest', () => {
    const ambiguous = parseDateFromQuote('Paid on 05/04/2026')
    expect(ambiguous?.precision).toBe('ambiguous')
    expect(ambiguous?.iso).toBeUndefined()

    const relative = parseDateFromQuote('Payment within 7 days')
    expect(relative?.precision).toBe('relative')

    expect(parseDateFromQuote('In November 2026')?.precision).toBe('month')
    expect(parseDateFromQuote('During 2026')?.precision).toBe('year')
    expect(parseDateFromQuote('no dates')).toBeNull()
  })

  it('marks impossible written dates as unresolved instead of inventing them', () => {
    const result = parseDateFromQuote('30 February 2026')
    expect(result?.precision).toBe('unresolved')
    expect(result?.iso).toBeUndefined()
  })
})

describe('fact creation from proposals', () => {
  const input = {
    caseId: 'case-1',
    documentId: 'doc-1',
    blockId: 'block-1',
    blockText: 'Invoice total: ₹24,000. Payment due within 7 days.',
    sourceVersion: 2,
    now: 1_000,
    caseCurrency: 'INR',
  }

  it('creates a proposed fact with the parsed amount from the quote', () => {
    const proposal: ValidatedProposal = {
      kind: 'invoice',
      statement: 'Invoice total is ₹24,000.',
      quote: 'Invoice total: ₹24,000',
    }
    const result = createFactFromProposal(proposal, input, 'fact-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fact.status).toBe('proposed')
    expect(result.fact.amount?.minorUnits).toBe(2_400_000)
    expect(result.fact.amount?.currency).toBe('INR')
    expect(result.fact.amount?.ambiguous).toBe(false)
    expect(result.fact.charStart).not.toBeNull()
  })

  it('captures a relative deadline phrase from the quote', () => {
    const proposal: ValidatedProposal = {
      kind: 'deadline',
      statement: 'Payment due within 7 days.',
      quote: 'Payment due within 7 days',
    }
    const result = createFactFromProposal(proposal, input, 'fact-1b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fact.date?.precision).toBe('relative')
  })

  it('refuses a proposal whose quote is not in the block', () => {
    const proposal: ValidatedProposal = {
      kind: 'payment',
      statement: 'Client paid in full.',
      quote: 'Client paid everything in full',
    }
    const result = createFactFromProposal(proposal, input, 'fact-2')
    expect(result.ok).toBe(false)
  })

  it('flags a currency mismatch against the case currency', () => {
    const proposal: ValidatedProposal = {
      kind: 'agreement',
      statement: 'Agreed fee is $500.',
      quote: 'Fee: $500',
    }
    const result = createFactFromProposal(proposal, { ...input, blockText: 'Fee: $500' }, 'f')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fact.amount?.currency).toBe('USD')
    expect(result.fact.amount?.currencyMismatch).toBe(true)
  })
})

describe('fact review transitions', () => {
  const base: EvidenceFact = {
    id: 'f1',
    caseId: 'c1',
    documentId: null,
    blockId: null,
    kind: 'payment',
    statement: 'Paid ₹1,000',
    quote: null,
    charStart: null,
    charEnd: null,
    normalizedMatch: false,
    amount: null,
    date: null,
    status: 'proposed',
    sourceVersion: null,
    manual: false,
    createdAt: 1,
    updatedAt: 1,
  }

  it('confirms, rejects, disputes, and restores explicitly', () => {
    expect(nextStatusForAction('proposed', 'confirm')).toBe('user_reviewed')
    expect(nextStatusForAction('proposed', 'reject')).toBe('rejected')
    expect(nextStatusForAction('user_reviewed', 'dispute')).toBe('disputed')
    expect(nextStatusForAction('rejected', 'restore')).toBe('proposed')
    expect(nextStatusForAction('user_reviewed', 'restore')).toBe('user_reviewed')

    const confirmed = applyFactStatus(base, 'confirm', 5)
    expect(confirmed.status).toBe('user_reviewed')
    expect(confirmed.updatedAt).toBe(5)
    // A no-op transition does not bump timestamps.
    const again = applyFactStatus(confirmed, 'confirm', 9)
    expect(again.updatedAt).toBe(5)
  })

  it('marks edits as user-reviewed and validates the statement', () => {
    const edited = applyFactEdit(base, { statement: 'Paid ₹1,000 on Monday', amount: null, date: null }, 10)
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.fact.status).toBe('user_reviewed')
    expect(edited.fact.statement).toBe('Paid ₹1,000 on Monday')

    const bad = applyFactEdit(base, { statement: '', amount: null, date: null }, 10)
    expect(bad.ok).toBe(false)
  })

  it('creates manual facts as user-reviewed with a valid kind', () => {
    const manual = createManualFact({
      id: 'm1',
      caseId: 'c1',
      kind: 'commitment',
      statement: 'Client promised payment after delivery',
      amount: null,
      date: null,
      createdAt: 3,
    })
    expect(manual.ok).toBe(true)
    if (!manual.ok) return
    expect(manual.fact.status).toBe('user_reviewed')
    expect(manual.fact.manual).toBe(true)

    const invalid = createManualFact({
      id: 'm2',
      caseId: 'c1',
      kind: 'banana',
      statement: 'x',
      amount: null,
      date: null,
      createdAt: 3,
    })
    expect(invalid.ok).toBe(false)
    expect(normalizeKind('PAYMENT')).toBe('payment')
  })
})

describe('money formatting', () => {
  it('formats minor units for display without changing stored values', () => {
    expect(formatMinorUnits(2_400_000, 'INR')).toContain('24')
    expect(formatMinorUnits(150_050, 'USD')).toContain('1,500.50')
    expect(formatMinorUnits(500, 'ZZZ')).toContain('ZZZ')
  })
})

