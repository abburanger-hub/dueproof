import { describe, it, expect } from 'vitest'
import { buildTimeline } from '../../src/domain/timeline/timeline'
import { buildLedger } from '../../src/domain/ledger/ledger'
import type { EvidenceFact } from '../../src/domain/evidence'
import type { FactKind, FactStatus } from '../../src/domain/evidence'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let idCounter = 0
const nextId = (): string => `fact-${(idCounter += 1)}`

function makeFact(overrides: Partial<EvidenceFact> & { kind?: FactKind }): EvidenceFact {
  const createdAt = overrides.createdAt ?? 1_700_000_000_000
  return {
    id: overrides.id ?? nextId(),
    caseId: 'case-1',
    documentId: null,
    blockId: null,
    kind: overrides.kind ?? 'other',
    statement: overrides.statement ?? 'A statement',
    quote: null,
    charStart: null,
    charEnd: null,
    normalizedMatch: false,
    amount: overrides.amount ?? null,
    date: overrides.date ?? null,
    status: overrides.status ?? 'user_reviewed',
    sourceVersion: null,
    manual: true,
    createdAt,
    updatedAt: createdAt,
  }
}

function inr(minorUnits: number, ambiguous = false, currency = 'INR') {
  return { minorUnits, currency, ambiguous, currencyMismatch: currency !== 'INR' }
}

function day(iso: string, text = iso) {
  return { text, iso, precision: 'day' as const }
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

describe('evidence timeline', () => {
  it('groups dated facts chronologically and labels day/month/year groups', () => {
    const facts = [
      makeFact({ id: 'b', kind: 'payment', date: day('2026-10-03', '3 Oct') }),
      makeFact({ id: 'a', kind: 'agreement', date: day('2026-09-15', '15 September 2026') }),
      makeFact({
        id: 'c',
        kind: 'commitment',
        date: { text: 'November 2026', iso: '2026-11', precision: 'month' },
      }),
    ]
    const result = buildTimeline(facts)
    expect(result.groups.map((group) => group.key)).toEqual([
      '2026-09-15',
      '2026-10-03',
      '2026-11',
    ])
    expect(result.groups[0]?.label).toBe('15 September 2026')
    expect(result.groups[1]?.label).toBe('3 October 2026')
    expect(result.groups[2]?.label).toBe('November 2026')
    expect(result.uncertainCount).toBe(0)
  })

  it('never places ambiguous, relative, unresolved, or undated facts on the timeline', () => {
    const facts = [
      makeFact({ date: { text: 'sometime last week', precision: 'relative' } }),
      makeFact({ date: { text: 'unclear', precision: 'unresolved' } }),
      makeFact({ date: { text: 'either March or April', precision: 'ambiguous' } }),
      makeFact({}), // no date at all
    ]
    const result = buildTimeline(facts)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.key).toBe('uncertain')
    expect(result.groups[0]?.precision).toBe('uncertain')
    expect(result.uncertainCount).toBe(4)
  })

  it('never includes rejected facts and keeps stable order inside groups', () => {
    const late = makeFact({ id: 'late', createdAt: 2_000, statement: 'Second in source' })
    const early = makeFact({ id: 'early', createdAt: 1_000, statement: 'First in source' })
    const rejected = makeFact({ status: 'rejected' as FactStatus, date: day('2026-01-01') })
    const result = buildTimeline([late, early, rejected])
    expect(result.includedCount).toBe(2)
    const group = result.groups[0]
    expect(group?.key).toBe('uncertain')
    expect(group?.entries.map((fact) => fact.id)).toEqual(['early', 'late'])
  })

  it('ignores day precision when the ISO form does not match the precision', () => {
    const fact = makeFact({
      date: { text: 'November 2026', iso: '2026-11', precision: 'day' },
    })
    const result = buildTimeline([fact])
    expect(result.groups[0]?.key).toBe('uncertain')
  })
})

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

describe('recorded-balance ledger', () => {
  it('computes charges, payments, credits and the recorded balance in minor units', () => {
    const facts = [
      makeFact({ kind: 'invoice', amount: inr(2_400_000), date: day('2026-10-01') }),
      makeFact({ kind: 'payment', amount: inr(1_000_000), date: day('2026-10-05') }),
      makeFact({ kind: 'credit', amount: inr(200_000), date: day('2026-10-06') }),
    ]
    const ledger = buildLedger(facts, 'INR')
    expect(ledger.entries).toHaveLength(3)
    expect(ledger.totals?.charges).toBe(2_400_000)
    expect(ledger.totals?.payments).toBe(1_000_000)
    expect(ledger.totals?.credits).toBe(200_000)
    expect(ledger.totals?.recordedBalance).toBe(1_200_000)
  })

  it('never aggregates a foreign currency into the case totals', () => {
    const facts = [
      makeFact({ kind: 'invoice', amount: inr(2_400_000) }),
      makeFact({ kind: 'payment', amount: inr(150_000, false, 'USD') }),
    ]
    const ledger = buildLedger(facts, 'INR')
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.totals?.payments).toBe(0)
    expect(ledger.mismatches.some((m) => m.kind === 'currency_mismatch')).toBe(true)
  })

  it('flags ambiguous amounts instead of guessing, and surfaces proposed facts as uncounted', () => {
    const facts = [
      makeFact({ kind: 'invoice', amount: inr(2_400_000, true) }),
      makeFact({ kind: 'payment', amount: inr(1_000_000), status: 'proposed' }),
    ]
    const ledger = buildLedger(facts, 'INR')
    expect(ledger.entries).toHaveLength(0)
    expect(ledger.totals).toBeNull()
    expect(ledger.mismatches.some((m) => m.kind === 'ambiguous_amount')).toBe(true)
    expect(ledger.proposedWithAmounts).toHaveLength(1)
    expect(ledger.mismatches.some((m) => m.kind === 'proposed_not_counted')).toBe(true)
  })

  it('excludes rejected and disputed facts from totals', () => {
    const facts = [
      makeFact({ kind: 'invoice', amount: inr(2_400_000) }),
      makeFact({ kind: 'payment', amount: inr(2_400_000), status: 'rejected' }),
      makeFact({ kind: 'payment', amount: inr(500_000), status: 'disputed' }),
    ]
    const ledger = buildLedger(facts, 'INR')
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.totals?.payments).toBe(0)
    expect(ledger.totals?.recordedBalance).toBe(2_400_000)
  })

  it('emits missing-evidence signals citing real fact ids, never invented sources', () => {
    const charge = makeFact({ id: 'charge-1', kind: 'invoice', amount: inr(2_400_000) })
    const ledger = buildLedger([charge], 'INR')
    const noPayment = ledger.signals.find((signal) => signal.id === 'no-payment-records')
    const noDelivery = ledger.signals.find((signal) => signal.id === 'charge-without-agreement')
    expect(noPayment).toBeDefined()
    expect(noPayment?.evidenceStatus).toBe('not_found')
    expect(noPayment?.relatedFactIds).toContain('charge-1')
    expect(noDelivery).toBeDefined()
  })

  it('reports partial payment as a supported observation', () => {
    const facts = [
      makeFact({ kind: 'invoice', amount: inr(2_400_000) }),
      makeFact({ kind: 'payment', amount: inr(1_000_000) }),
    ]
    const ledger = buildLedger(facts, 'INR')
    const partial = ledger.signals.find((signal) => signal.id === 'partial-payment-evidence')
    expect(partial?.evidenceStatus).toBe('supported')
  })

  it('emits approval/delivery gap signals in both directions', () => {
    const approvalOnly = buildLedger(
      [makeFact({ kind: 'approval' }), makeFact({ kind: 'invoice', amount: inr(1) })],
      'INR',
    )
    expect(
      approvalOnly.signals.find((signal) => signal.id === 'approval-without-delivery'),
    ).toBeDefined()

    const deliveryOnly = buildLedger(
      [makeFact({ kind: 'delivery' }), makeFact({ kind: 'invoice', amount: inr(1) })],
      'INR',
    )
    expect(
      deliveryOnly.signals.find((signal) => signal.id === 'delivery-without-approval'),
    ).toBeDefined()
  })

  it('produces no totals when nothing reviewable exists', () => {
    const ledger = buildLedger([makeFact({ kind: 'other' })], 'INR')
    expect(ledger.entries).toHaveLength(0)
    expect(ledger.totals).toBeNull()
    expect(ledger.signals).toHaveLength(0)
  })
})
