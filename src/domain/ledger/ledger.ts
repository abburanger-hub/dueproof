/**
 * Domain: recorded-balance ledger.
 *
 * A deterministic financial view over a case's REVIEWED facts. The model
 * never performs arithmetic; this module does.
 *
 * Mandatory honesty rules:
 * - Only `user_reviewed` and `unresolved` facts with amounts are entries.
 *   `proposed` and `rejected` facts are excluded (proposed facts are listed
 *   separately so the user knows what is not yet counted).
 * - One currency per case. Amounts in a different currency are reported as
 *   mismatches and NEVER aggregated into the totals.
 * - Totals are labelled "based on reviewed supplied records" — a recorded
 *   balance, never a claim about what is legally owed.
 * - Invoice-kind facts whose amount is ambiguous are flagged for user review
 *   instead of guessed.
 * - Missing-evidence signals are observations about what supplied records do
 *   not contain; absence of a record never proves an event did not happen.
 */

import type { EvidenceFact } from '../evidence'

/** Fact kinds that increase or decrease the recorded balance. */
export type LedgerEntryKind = 'charge' | 'payment' | 'credit'

export interface LedgerEntry {
  id: string
  kind: LedgerEntryKind
  /** Integer minor units. */
  minorUnits: number
  currency: string
  fact: EvidenceFact
}

export type MismatchKind =
  | 'currency_mismatch'
  | 'ambiguous_amount'
  | 'proposed_not_counted'

export interface LedgerMismatch {
  kind: MismatchKind
  fact: EvidenceFact
  message: string
}

export interface LedgerTotals {
  /** Sum of charge entries in the case currency (minor units). */
  charges: number
  /** Sum of payment entries (minor units). */
  payments: number
  /** Sum of credit entries (minor units). */
  credits: number
  /** charges - payments - credits, floored at 0 for display honesty. */
  recordedBalance: number
  currency: string
}

export type EvidenceStatus =
  | 'supported'
  | 'not_found'
  | 'conflicting'
  | 'uncertain'

export interface MissingEvidenceSignal {
  id: string
  /** The deterministic rule that produced the signal. */
  rule: string
  evidenceStatus: EvidenceStatus
  message: string
  /** Fact ids that motivated the signal (never invented sources). */
  relatedFactIds: string[]
}

export interface LedgerResult {
  caseCurrency: string
  entries: LedgerEntry[]
  totals: LedgerTotals | null
  mismatches: LedgerMismatch[]
  /** Proposed facts with amounts, shown but not counted. */
  proposedWithAmounts: EvidenceFact[]
  signals: MissingEvidenceSignal[]
}

/* ------------------------------------------------------------------ */
/* Fact-kind → entry-kind mapping                                      */
/* ------------------------------------------------------------------ */

const KIND_TO_ENTRY: Partial<Record<EvidenceFact['kind'], LedgerEntryKind>> = {
  invoice: 'charge',
  payment: 'payment',
  credit: 'credit',
}

/**
 * Builds the recorded-balance ledger for one case.
 *
 * @param caseCurrency The case's ISO-4217 currency; entries in other
 * currencies are excluded from totals and reported as mismatches.
 */
export function buildLedger(
  facts: EvidenceFact[],
  caseCurrency: string,
): LedgerResult {
  const currency = caseCurrency.toUpperCase()
  const entries: LedgerEntry[] = []
  const mismatches: LedgerMismatch[] = []
  const proposedWithAmounts: EvidenceFact[] = []

  for (const fact of facts) {
    if (fact.status === 'rejected') continue

    if (fact.status === 'proposed') {
      if (fact.amount) proposedWithAmounts.push(fact)
      continue
    }

    // 'disputed' facts are kept visible but not counted either — counting a
    // fact the user explicitly marked disputed would misstate the record.
    if (fact.status === 'disputed') {
      continue
    }

    const entryKind = KIND_TO_ENTRY[fact.kind]
    if (!entryKind || !fact.amount) continue

    if (fact.amount.currencyMismatch || fact.amount.currency.toUpperCase() !== currency) {
      mismatches.push({
        kind: 'currency_mismatch',
        fact,
        message: `Excluded from totals: ${fact.kind} recorded in ${fact.amount.currency} while the case currency is ${currency}.`,
      })
      continue
    }

    if (fact.amount.ambiguous) {
      mismatches.push({
        kind: 'ambiguous_amount',
        fact,
        message: `Needs review: ${fact.kind} fact has more than one money value in its quote. Edit the fact to pick the correct figure.`,
      })
      continue
    }

    entries.push({
      id: fact.id,
      kind: entryKind,
      minorUnits: fact.amount.minorUnits,
      currency: fact.amount.currency.toUpperCase(),
      fact,
    })
  }

  const totals: LedgerTotals | null =
    entries.length === 0
      ? null
      : (() => {
          const charges = entries
            .filter((entry) => entry.kind === 'charge')
            .reduce((sum, entry) => sum + entry.minorUnits, 0)
          const payments = entries
            .filter((entry) => entry.kind === 'payment')
            .reduce((sum, entry) => sum + entry.minorUnits, 0)
          const credits = entries
            .filter((entry) => entry.kind === 'credit')
            .reduce((sum, entry) => sum + entry.minorUnits, 0)
          const recordedBalance = Math.max(0, charges - payments - credits)
          return { charges, payments, credits, recordedBalance, currency }
        })()

  if (proposedWithAmounts.length > 0) {
    mismatches.push({
      kind: 'proposed_not_counted',
      fact: proposedWithAmounts[0] as EvidenceFact,
      message: `${proposedWithAmounts.length} fact(s) with amounts are still awaiting review and are not counted. Review them to include their values.`,
    })
  }

  return {
    caseCurrency: currency,
    entries,
    totals,
    mismatches,
    proposedWithAmounts,
    signals: buildSignals(facts, entries, currency),
  }
}

/* ------------------------------------------------------------------ */
/* Rule-based missing-evidence signals                                 */
/* ------------------------------------------------------------------ */

/**
 * Deterministic observations over the reviewed record. Every signal cites the
 * fact ids that motivated it; none claims an event did not happen.
 */
function buildSignals(
  facts: EvidenceFact[],
  entries: LedgerEntry[],
  _currency: string,
): MissingEvidenceSignal[] {
  const signals: MissingEvidenceSignal[] = []
  const visible = facts.filter(
    (fact) => fact.status === 'user_reviewed' || fact.status === 'unresolved',
  )

  const chargeFacts = visible.filter((fact) => fact.kind === 'invoice')
  const paymentFacts = visible.filter((fact) => fact.kind === 'payment')
  const approvalFacts = visible.filter((fact) => fact.kind === 'approval')
  const deliveryFacts = visible.filter((fact) => fact.kind === 'delivery')
  const agreementFacts = visible.filter((fact) => fact.kind === 'agreement')

  const reviewedChargeIds = new Set(
    entries.filter((entry) => entry.kind === 'charge').map((entry) => entry.id),
  )

  // 1. An invoice/charge exists with no payment facts supplied at all.
  if (chargeFacts.length > 0 && paymentFacts.length === 0) {
    signals.push({
      id: 'no-payment-records',
      rule: 'charge_without_payment_evidence',
      evidenceStatus: 'not_found',
      message:
        'Records mention an amount due, but no payment record has been supplied for this case. This is an observation about your supplied records — not proof that no payment happened.',
      relatedFactIds: chargeFacts.map((fact) => fact.id),
    })
  }

  // 2. Payments exist that do not cover the recorded charges.
  if (chargeFacts.length > 0 && paymentFacts.length > 0) {
    const charges = entries
      .filter((entry) => entry.kind === 'charge')
      .reduce((sum, entry) => sum + entry.minorUnits, 0)
    const payments = entries
      .filter((entry) => entry.kind === 'payment')
      .reduce((sum, entry) => sum + entry.minorUnits, 0)
    if (payments < charges) {
      signals.push({
        id: 'partial-payment-evidence',
        rule: 'payments_below_charges',
        evidenceStatus: 'supported',
        message:
          'Reviewed payment records add up to less than the reviewed amounts due. A later payment may exist but is not among the supplied records.',
        relatedFactIds: [
          ...chargeFacts.map((fact) => fact.id),
          ...paymentFacts.map((fact) => fact.id),
        ],
      })
    }
  }

  // 3. Approval without delivery evidence.
  if (approvalFacts.length > 0 && deliveryFacts.length === 0) {
    signals.push({
      id: 'approval-without-delivery',
      rule: 'approval_without_delivery_evidence',
      evidenceStatus: 'not_found',
      message:
        'Records show client approval, but no delivery record has been supplied. Supply a delivery confirmation to strengthen the case.',
      relatedFactIds: approvalFacts.map((fact) => fact.id),
    })
  }

  // 4. Delivery without recorded approval.
  if (deliveryFacts.length > 0 && approvalFacts.length === 0) {
    signals.push({
      id: 'delivery-without-approval',
      rule: 'delivery_without_approval_evidence',
      evidenceStatus: 'not_found',
      message:
        'Records show delivery of work, but no client approval record has been supplied. An approval message or sign-off would clarify acceptance.',
      relatedFactIds: deliveryFacts.map((fact) => fact.id),
    })
  }

  // 5. Charges exist but no agreement fact was supplied.
  if (chargeFacts.length > 0 && agreementFacts.length === 0) {
    signals.push({
      id: 'charge-without-agreement',
      rule: 'charge_without_agreement_evidence',
      evidenceStatus: 'not_found',
      message:
        'Records mention amounts due, but no agreement/quote record has been supplied. The agreed scope and price are not evidenced yet.',
      relatedFactIds: chargeFacts.filter((fact) => reviewedChargeIds.has(fact.id)).map((fact) => fact.id),
    })
  }

  return signals
}
