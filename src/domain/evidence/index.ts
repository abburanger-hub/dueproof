/**
 * Evidence domain barrel.
 *
 * Everything the application layer needs from the evidence domain in one
 * import. Pure domain logic only — no infrastructure here.
 */

export {
  FACT_KINDS,
  MAX_FACTS_PER_BLOCK,
  QUOTE_MAX,
  STATEMENT_MAX,
  applyFactEdit,
  applyFactStatus,
  createManualFact,
  evidenceError,
  nextStatusForAction,
  normalizeKind,
  validateQuoteText,
  validateStatement,
  type DatePrecision,
  type EvidenceError,
  type EvidenceErrorCode,
  type EvidenceFact,
  type FactAction,
  type FactAmount,
  type FactDate,
  type FactEditInput,
  type FactKind,
  type FactStatus,
  type ManualFactInput,
} from './fact'

export {
  capProposals,
  createFactFromProposal,
  dedupeProposals,
  parseProposalJson,
  toCandidateProposal,
  validateRawProposal,
  type FactFromProposalInput,
  type RawProposal,
  type RejectedProposal,
  type ValidatedProposal,
} from './proposal'

export { locateQuote, normalizeQuote, normalizeWhitespace } from './quote-utils'

export {
  CASE_SUPPORTED_CURRENCIES,
  detectCurrencySymbol,
  parseAmountFromQuote,
  parseDateFromQuote,
  supportedMinorUnitDigits,
  type ParsedAmount,
  type ParsedDate,
} from './parse'

export { formatMinorUnits } from './format'

