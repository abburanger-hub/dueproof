/**
 * Domain: the consent-gated disclosure payload for cloud reconciliation.
 *
 * This module decides exactly WHAT may leave the device:
 * - Only reviewed facts (user_reviewed / unresolved / disputed) are
 *   eligible. Proposed (unreviewed) and rejected facts never leave.
 * - Statements are scanned for obvious identifiers (emails, phone-like
 *   digit runs, URLs, PAN-like tokens, social handles). Sensitive facts
 *   are excluded by default and can only be included through an explicit
 *   user override recorded in the consent UI.
 * - Each payload entry carries ONLY: a local fact id, kind, statement,
 *   amount (integer minor units + currency), and a parsed date
 *   (iso + precision). Quotes, document names, filenames, block ids, and
 *   timestamps never leave the device through this path.
 * - The payload embeds the deterministic recorded balance computed by the
 *   ledger, so the cloud model reads app-computed arithmetic instead of
 *   performing its own math.
 * - `canonicalizeDisclosure` produces a stable serialization used for the
 *   approval digest: approve-what-you-sent is enforced byte-for-byte at
 *   send time (revalidation happens in the application service).
 *
 * Pseudonymization honesty: local UUID ids hide names, but amounts, dates,
 * and unusual details can still identify a client. The consent UI must say
 * so — pseudonymized is not anonymous.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import type { DatePrecision, EvidenceFact, FactKind } from '../evidence'
import { buildLedger } from '../ledger/ledger'

export const DISCLOSURE_SCHEMA = 'dueproof.disclosure/v1'
export const RECON_PROMPT_VERSION = 'recon-v1'

/** Hard cap on facts per disclosure — bounds payload size and model output. */
export const MAX_DISCLOSURE_FACTS = 60

/* ------------------------------------------------------------------ */
/* Sensitive-content scan (deterministic, assistance not a guarantee) */
/* ------------------------------------------------------------------ */

export type SensitiveCategory = 'email' | 'phone' | 'url' | 'pan_or_id' | 'handle'

export interface SensitiveMatch {
  category: SensitiveCategory
  /** First characters of the match, for UI display only. */
  excerpt: string
  index: number
  length: number
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL_RE = /https?:\/\/[^\s]+/gi
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g
const LONG_TOKEN_RE = /\b[A-Z0-9]{12,}\b/g
const HANDLE_RE = /(?<=^|\s)@[A-Za-z0-9_]{3,}/g
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g
/** ISO dates are legitimate content, not identifiers — masked before the phone scan. */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g

/**
 * Deterministic scan of a statement for likely identifiers. Detection is
 * assistance, not a guarantee of complete de-identification: the consent UI
 * still shows the exact payload and requires explicit approval.
 */
export function scanSensitive(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  // Masking with NUL prevents one pattern from re-matching inside another
  // (e.g. a phone-like run inside a URL) and lets ISO dates pass silently.
  let working = text
  const mask = (index: number, length: number): void => {
    working = working.slice(0, index) + '\u0000'.repeat(length) + working.slice(index + length)
  }
  const run = (re: RegExp, category: SensitiveCategory, silent = false): void => {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(working)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      if (!match[0].includes('\u0000') && !silent) {
        matches.push({
          category,
          excerpt: match[0].slice(0, 16),
          index: match.index,
          length: match[0].length,
        })
      }
      mask(match.index, match[0].length)
    }
  }

  run(ISO_DATE_RE, 'pan_or_id', true) // silently neutralized, never reported
  run(EMAIL_RE, 'email')
  run(URL_RE, 'url')
  run(PAN_RE, 'pan_or_id')
  run(LONG_TOKEN_RE, 'pan_or_id')
  run(HANDLE_RE, 'handle')
  run(PHONE_RE, 'phone')

  return matches.sort((a, b) => a.index - b.index)
}

/* ------------------------------------------------------------------ */
/* Payload shape                                                       */
/* ------------------------------------------------------------------ */

export interface DisclosureFactEntry {
  factId: string
  kind: FactKind
  statement: string
  amount: { minorUnits: number; currency: string } | null
  date: { iso: string | null; precision: DatePrecision } | null
}

export interface DisclosureBalance {
  charges: number
  payments: number
  credits: number
  balance: number
}

export interface DisclosurePayload {
  schema: typeof DISCLOSURE_SCHEMA
  currency: string
  caseRevision: number
  promptVersion: string
  recordedBalance: DisclosureBalance | null
  facts: DisclosureFactEntry[]
}

export type DisclosureExcludedReason =
  | 'unreviewed'
  | 'rejected'
  | 'sensitive'
  | 'not_selected'

export interface DisclosureExcluded {
  fact: EvidenceFact
  reason: DisclosureExcludedReason
  matches?: SensitiveMatch[]
}

export interface DisclosureBuildResult {
  payload: DisclosurePayload
  excluded: DisclosureExcluded[]
  /** Eligible facts dropped only because of the size cap. */
  capped: EvidenceFact[]
}

/** Reviewed facts may be approved for disclosure; others never leave. */
export function eligibleForDisclosure(fact: EvidenceFact): boolean {
  return fact.status !== 'proposed' && fact.status !== 'rejected'
}

function sanitizeStatement(statement: string): string {
  // Strip control characters (oxlint:no-control-regex) — payload text must
  // never carry control codes into a cloud request.
  const cleaned = Array.from(statement)
    .map((character) => (character.codePointAt(0)! <= 0x1f ? ' ' : character))
    .join('')
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Builds the minimal disclosure payload.
 *
 * @param includedFactIds When provided, exactly this selection is used (the
 * consent UI's explicit per-fact choice, including overrides of the
 * sensitive default). When omitted, eligible non-sensitive facts are
 * auto-included and sensitive facts are listed as excluded with reasons.
 */
export function buildDisclosure(
  facts: EvidenceFact[],
  input: {
    caseCurrency: string
    caseRevision: number
    includedFactIds?: ReadonlySet<string>
  },
): DisclosureBuildResult {
  const currency = input.caseCurrency.toUpperCase()
  const excluded: DisclosureExcluded[] = []
  const candidates: EvidenceFact[] = []

  for (const fact of facts) {
    if (!eligibleForDisclosure(fact)) {
      excluded.push({ fact, reason: fact.status === 'proposed' ? 'unreviewed' : 'rejected' })
      continue
    }
    if (input.includedFactIds) {
      if (input.includedFactIds.has(fact.id)) {
        candidates.push(fact)
      } else {
        const sensitive = scanSensitive(fact.statement)
        excluded.push({
          fact,
          reason: 'not_selected',
          ...(sensitive.length > 0 ? { matches: sensitive } : {}),
        })
      }
      continue
    }
    const sensitive = scanSensitive(fact.statement)
    if (sensitive.length > 0) {
      excluded.push({ fact, reason: 'sensitive', matches: sensitive })
      continue
    }
    candidates.push(fact)
  }

  const capped =
    candidates.length > MAX_DISCLOSURE_FACTS ? candidates.slice(MAX_DISCLOSURE_FACTS) : []
  const included = capped.length > 0 ? candidates.slice(0, MAX_DISCLOSURE_FACTS) : candidates

  const entries: DisclosureFactEntry[] = included.map((fact) => ({
    factId: fact.id,
    kind: fact.kind,
    statement: sanitizeStatement(fact.statement),
    amount: fact.amount
      ? { minorUnits: fact.amount.minorUnits, currency: fact.amount.currency.toUpperCase() }
      : null,
    date: fact.date ? { iso: fact.date.iso ?? null, precision: fact.date.precision } : null,
  }))

  const ledger = buildLedger(included, currency)
  const recordedBalance = ledger.totals
    ? {
        charges: ledger.totals.charges,
        payments: ledger.totals.payments,
        credits: ledger.totals.credits,
        balance: ledger.totals.recordedBalance,
      }
    : null

  return {
    payload: {
      schema: DISCLOSURE_SCHEMA,
      currency,
      caseRevision: input.caseRevision,
      promptVersion: RECON_PROMPT_VERSION,
      recordedBalance,
      facts: entries,
    },
    excluded,
    capped,
  }
}

/* ------------------------------------------------------------------ */
/* Canonical serialization + digest input                              */
/* ------------------------------------------------------------------ */

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stable(item)).join(',') + ']'
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return '{' + entries.map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`).join(',') + '}'
  }
  return JSON.stringify(value)
}

/**
 * Stable serialization of the payload: object key order never changes the
 * output. The application service digests this exact string, stores it in
 * the approval snapshot, and re-derives it before sending — so the payload
 * that leaves the device is byte-for-byte the payload the user approved.
 */
export function canonicalizeDisclosure(payload: DisclosurePayload): string {
  return stable(payload)
}
