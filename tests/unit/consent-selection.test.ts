import { describe, it, expect } from 'vitest'
import {
  buildSelectionState,
  sanitizeSelection,
  MAX_DISCLOSURE_FACTS as CAP,
} from '../../src/domain/privacy/consent-selection'
import { CONSENT_ISSUE_MESSAGES } from '../../src/application/privacy/consent-status-service'
import type { EvidenceFact } from '../../src/domain/evidence'

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

describe('buildSelectionState (per-fact consent selection)', () => {
  it('offers only eligible facts: proposed and rejected are not selectable', () => {
    const state = buildSelectionState([
      fact({ id: 'reviewed' }),
      fact({ id: 'proposed', status: 'proposed' }),
      fact({ id: 'rejected', status: 'rejected' }),
    ])
    expect(state.selectable.map((entry) => entry.fact.id)).toEqual(['reviewed'])
  })

  it('selects clean facts by default and leaves sensitive facts unselected with reasons', () => {
    const state = buildSelectionState([
      fact({ id: 'clean', statement: 'Client approved milestone two.' }),
      fact({ id: 'sensitive', statement: 'Email ceo@bigco.example about the delay.' }),
    ])
    const clean = state.selectable.find((entry) => entry.fact.id === 'clean')
    const sensitive = state.selectable.find((entry) => entry.fact.id === 'sensitive')
    expect(clean?.selected).toBe(true)
    expect(sensitive?.selected).toBe(false)
    expect(sensitive?.sensitiveMatches.length).toBeGreaterThan(0)
    expect([...state.defaultIncludedFactIds]).toEqual(['clean'])
  })

  it('caps selectable facts at the maximum and reports the overflow', () => {
    const facts = Array.from({ length: CAP + 3 }, (_, index) =>
      fact({ id: `f${index}` }),
    )
    const state = buildSelectionState(facts)
    expect(state.selectable).toHaveLength(CAP)
    expect(state.capped).toHaveLength(3)
    expect(state.defaultIncludedFactIds.size).toBe(CAP)
  })
})

describe('sanitizeSelection (stale UI state cannot smuggle facts in)', () => {
  it('drops ids that are not eligible and enforces the cap', () => {
    const eligible = new Set(['a', 'b', 'c'])
    const many = new Set(['x', 'a', 'y', 'b', 'c'])
    const sanitized = sanitizeSelection(many, eligible)
    expect([...sanitized].sort()).toEqual(['a', 'b', 'c'])
  })

  it('enforces the hard cap even if all ids are eligible', () => {
    const eligible = new Set(Array.from({ length: CAP + 5 }, (_, i) => `f${i}`))
    const selection = new Set(Array.from({ length: CAP + 5 }, (_, i) => `f${i}`))
    const sanitized = sanitizeSelection(selection, eligible)
    expect(sanitized.size).toBe(CAP)
  })
})

describe('consent issue messages', () => {
  it('explains every issue in plain language (no raw error codes shown)', () => {
    const issues = [
      'case_missing',
      'case_revision_changed',
      'fact_edited',
      'fact_missing',
      'snapshot_consumed',
    ] as const
    for (const issue of issues) {
      const message = CONSENT_ISSUE_MESSAGES[issue]
      expect(message.length).toBeGreaterThan(20)
      expect(message).not.toMatch(/error|code|exception/i)
    }
  })
})
