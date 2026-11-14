/**
 * Domain: candidate fact proposals and their deterministic validation.
 *
 * This is the heart of DueProof's trust model:
 * - The on-device model returns JSON proposals (kind, statement, quote).
 * - Application code verifies EVERY quote against the actual block text.
 * - Amounts and dates are parsed from the verified quote by code, never
 *   taken from the model on trust.
 * - Anything unverifiable is discarded, not guessed into a citation.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import { MAX_FACTS_PER_BLOCK, normalizeKind, type EvidenceFact, type FactKind } from './fact'
import { locateQuote, normalizeQuote } from './quote-utils'
import { parseAmountFromQuote, parseDateFromQuote } from './parse'

/** Raw shape the model is asked to return (JSON candidate). */
export interface RawProposal {
  kind?: unknown
  statement?: unknown
  quote?: unknown
}

/** A proposal after schema validation, before source verification. */
export interface ValidatedProposal {
  kind: FactKind
  statement: string
  quote: string
}

/** A proposal that failed validation, with a safe reason. */
export interface RejectedProposal {
  reason: 'missing_field' | 'bad_kind' | 'bad_statement' | 'bad_quote' | 'duplicate'
}

export type ProposalOutcome =
  | { ok: true; proposal: ValidatedProposal }
  | { ok: false; reason: RejectedProposal['reason'] }

/**
 * Validates the raw JSON from the model against the contract. Never throws —
 * malformed model output is data, not an exception.
 */
export function validateRawProposal(raw: RawProposal): ProposalOutcome {
  const kindRaw = typeof raw.kind === 'string' ? raw.kind : ''
  const kind = normalizeKind(kindRaw)
  if (!kind) return { ok: false, reason: 'bad_kind' }

  const statementRaw = typeof raw.statement === 'string' ? raw.statement.trim() : ''
  if (statementRaw.length === 0 || statementRaw.length > 200) {
    return { ok: false, reason: 'bad_statement' }
  }

  const quoteRaw = typeof raw.quote === 'string' ? raw.quote.trim() : ''
  if (quoteRaw.length === 0 || quoteRaw.length > 400) {
    return { ok: false, reason: 'bad_quote' }
  }

  return {
    ok: true,
    proposal: {
      kind,
      statement: statementRaw.replace(/\s+/g, ' '),
      quote: quoteRaw,
    },
  }
}

/** Removes exact duplicates (same normalized quote + kind) within a batch. */
export function dedupeProposals(proposals: ValidatedProposal[]): ValidatedProposal[] {
  const seen = new Set<string>()
  const unique: ValidatedProposal[] = []
  for (const proposal of proposals) {
    const key = `${proposal.kind}::${normalizeQuote(proposal.quote).toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(proposal)
  }
  return unique
}

/** Enforces the per-block fact cap. */
export function capProposals(proposals: ValidatedProposal[]): ValidatedProposal[] {
  return proposals.slice(0, MAX_FACTS_PER_BLOCK)
}

export interface FactFromProposalInput {
  caseId: string
  documentId: string
  blockId: string
  blockText: string
  sourceVersion: number
  now: number
  caseCurrency: string
}

/**
 * Converts verified proposals into candidate facts.
 * A proposal whose quote cannot be located in the block text is dropped —
 * DueProof never presents an unverifiable citation as evidence.
 */
export function createFactFromProposal(
  proposal: ValidatedProposal,
  input: FactFromProposalInput,
  id: string,
): { ok: true; fact: EvidenceFact } | { ok: false; reason: 'quote_not_found' } {
  const quote = normalizeQuote(proposal.quote)
  const location = locateQuote(input.blockText, quote)
  if (!location) return { ok: false, reason: 'quote_not_found' }

  const parsedAmount = parseAmountFromQuote(quote)
  const parsedDate = parseDateFromQuote(quote)

  const amount =
    parsedAmount && parsedAmount.minorUnits > 0
      ? {
          minorUnits: parsedAmount.minorUnits,
          currency: parsedAmount.currency ?? input.caseCurrency,
          ambiguous: parsedAmount.ambiguous,
          currencyMismatch:
            parsedAmount.currency !== null &&
            parsedAmount.currency.toUpperCase() !== input.caseCurrency.toUpperCase(),
        }
      : null

  const date = parsedDate
    ? { text: parsedDate.text, iso: parsedDate.iso, precision: parsedDate.precision }
    : null

  return {
    ok: true,
    fact: {
      id,
      caseId: input.caseId,
      documentId: input.documentId,
      blockId: input.blockId,
      kind: proposal.kind,
      statement: proposal.statement,
      quote,
      charStart: location.start,
      charEnd: location.end,
      normalizedMatch: location.normalizedMatch,
      amount,
      date,
      status: 'proposed',
      sourceVersion: input.sourceVersion,
      manual: false,
      createdAt: input.now,
      updatedAt: input.now,
    },
  }
}

/** Parses the model's JSON text into raw proposals; never throws. */
export function parseProposalJson(text: string): RawProposal[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return null
    // The contract allows {"facts": [...]} or a bare array.
    const items = parsed.every((item) => typeof item === 'object' && item !== null)
      ? (parsed as RawProposal[])
      : null
    return items
  } catch {
    return null
  }
}

/** Convenience re-export used by the adapter and tests. */
export function toCandidateProposal(raw: RawProposal): ProposalOutcome {
  return validateRawProposal(raw)
}

