/**
 * Domain: deterministic amount and date parsing from quotes.
 *
 * The model NEVER computes or converts money. It returns a quote; this module
 * parses the quote with plain code so money and dates stay auditable.
 * Money is integer minor units. Dates keep their real precision.
 *
 * Pure TypeScript — no dependencies.
 */

/** MVP case currencies (matches SUPPORTED_CURRENCIES in the case domain). */
export const CASE_SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const

/** Minor-unit digits per ISO-4217 for the currencies DueProof supports. */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
}

export function supportedMinorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2
}

/** Currency symbols/names recognized in quotes. */
const CURRENCY_TOKENS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /₹|rs\.?\s|inr\b/i, code: 'INR' },
  { pattern: /\$|usd\b/i, code: 'USD' },
  { pattern: /€|eur\b/i, code: 'EUR' },
  { pattern: /£|gbp\b/i, code: 'GBP' },
]

/** Detects the first currency hint in a quote; null when none found. */
export function detectCurrencySymbol(text: string): string | null {
  for (const token of CURRENCY_TOKENS) {
    if (token.pattern.test(text)) return token.code
  }
  return null
}

export interface ParsedAmount {
  minorUnits: number
  currency: string | null
  ambiguous: boolean
}

/**
 * Parses the FIRST money value in a quote into integer minor units.
 *
 * Returns `ambiguous: true` when several distinct amounts appear — the user
 * must resolve which one the fact refers to. This is deliberate: guessing a
 * number from a payment record would be worse than asking.
 */
export function parseAmountFromQuote(quote: string): ParsedAmount | null {
  // Either a comma-grouped number (Indian 1,20,000 or Western 120,000) or a
  // plain ungrouped run of digits, optionally with a 2-digit decimal part.
  // The (?!\d) guard prevents matching a prefix of a longer digit run.
  const amountPattern = /(?:₹|\$|€|£)?\s?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?(?!\d)/g
  const matches = Array.from(quote.matchAll(amountPattern))
    .map((match) => match[0])
    .filter((raw) => /\d/.test(raw))
    .map((raw) => raw.replace(/[₹$€£\s]/g, ''))

  if (matches.length === 0) return null

  // Only distinct VALUES matter for ambiguity (a repeated amount is not
  // ambiguous). Trivial zero-values are ignored as noise.
  const distinctValues = new Set(
    matches.filter((raw) => Number(raw.replace(/[.,]/g, '')) !== 0),
  )
  const ambiguous = distinctValues.size > 1

  const first = matches.find((raw) => Number(raw.replace(/[.,]/g, '')) !== 0) ?? matches[0]
  if (!first) return null

  const minorUnits = toMinorUnits(first)
  if (minorUnits === null) return null

  return {
    minorUnits,
    currency: detectCurrencySymbol(quote),
    ambiguous,
  }
}

/** Converts a grouped number string to integer minor units, or null. */
function toMinorUnits(raw: string): number | null {
  const hasDecimal = /[.,]\d{1,2}$/.test(raw)
  const cleaned = raw.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(hasDecimal ? cleaned : cleaned)) {
    // Non-standard shape (e.g. mixed separators) — refuse rather than guess.
    if (!/^\d+$/.test(cleaned)) return null
  }
  const value = hasDecimal ? Number(cleaned) : Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

export interface ParsedDate {
  text: string
  iso: string | undefined
  precision: 'day' | 'month' | 'year' | 'ambiguous' | 'relative' | 'unresolved'
}

/**
 * Parses the first date-like phrase in a quote. Keeps the verbatim text and a
 * best-effort ISO form; `ambiguous` is used when the day/month order cannot
 * be determined, `relative` for phrases like "next Friday" or "within 7 days".
 */
export function parseDateFromQuote(quote: string): ParsedDate | null {
  const text = quote.trim()

  // Relative phrases first — common in commitments/deadlines.
  const relative =
    /\b(?:within|in|after)\s+(?:\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|hours?)\b/i
  if (relative.test(text)) {
    const match = text.match(relative)
    return { text: match?.[0] ?? text, iso: undefined, precision: 'relative' }
  }

  // ISO dates: 2026-11-30 or 2026/11/30
  const isoMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    if (isValidDay(year, month, day)) {
      return {
        text: isoMatch[0],
        iso: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`,
        precision: 'day',
      }
    }
  }

  // Written dates: "30 November 2026" or "November 30, 2026".
  // An impossible day (e.g. "30 February 2026") must NOT silently degrade to
  // "February 2026" — the phrase itself is unreliable, so it stays unresolved.
  const writtenA = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/)
  if (writtenA) {
    const day = Number(writtenA[1])
    const month = MONTHS[writtenA[2]?.toLowerCase().slice(0, 9) ?? '']
    const year = Number(writtenA[3])
    if (month && !isValidDay(year, month, day) && day >= 1 && day <= 31) {
      return { text: writtenA[0], iso: undefined, precision: 'unresolved' }
    }
    if (month && isValidDay(year, month, day)) {
      return {
        text: writtenA[0],
        iso: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`,
        precision: 'day',
      }
    }
  }

  const writtenB = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/)
  if (writtenB) {
    const month = MONTHS[writtenB[1]?.toLowerCase().slice(0, 9) ?? '']
    const day = Number(writtenB[2])
    const year = Number(writtenB[3])
    if (month && !isValidDay(year, month, day) && day >= 1 && day <= 31) {
      return { text: writtenB[0], iso: undefined, precision: 'unresolved' }
    }
    if (month && isValidDay(year, month, day)) {
      return {
        text: writtenB[0],
        iso: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`,
        precision: 'day',
      }
    }
  }

  // Ambiguous numeric: 30/11/2026 vs 11/30/2026 (day-month unknowable)
  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (numeric) {
    const a = Number(numeric[1])
    const b = Number(numeric[2])
    let year = Number(numeric[3])
    if (year < 100) year += 2000
    if (a > 12 && b <= 12) {
      return { text: numeric[0], iso: `${year}-${pad(b)}-${pad(a)}`, precision: 'day' }
    }
    if (b > 12 && a <= 12) {
      return { text: numeric[0], iso: `${year}-${pad(a)}-${pad(b)}`, precision: 'day' }
    }
    return { text: numeric[0], iso: undefined, precision: 'ambiguous' }
  }

  // Month + year: "November 2026"
  const monthYear = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/)
  if (monthYear) {
    const month = MONTHS[monthYear[1]?.toLowerCase().slice(0, 9) ?? '']
    const year = Number(monthYear[2])
    if (month && year >= 1900 && year <= 2200) {
      return { text: monthYear[0], iso: `${year}-${pad(month)}`, precision: 'month' }
    }
  }

  // Bare year in a deadline-ish context
  const bareYear = text.match(/\b(19|20)\d{2}\b/)
  if (bareYear) {
    return { text: bareYear[0], iso: bareYear[0], precision: 'year' }
  }

  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isValidDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (year < 1900 || year > 2200) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

