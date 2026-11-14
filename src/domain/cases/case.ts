/**
 * Domain: payment cases.
 *
 * A case is the container for one client engagement's evidence. Domain code
 * here is pure TypeScript with no React, Firebase, or IndexedDB imports so the
 * rules can be unit-tested and reused by any storage implementation.
 *
 * Money rules (mandatory, per project context):
 * - Amounts are integer minor units within safe bounds.
 * - Currency codes are ISO-4217 uppercase strings.
 * - A case never mixes currencies.
 */

/** ISO-4217 currency code, uppercase (e.g. "INR", "USD", "EUR"). */
export type CurrencyCode = string

/** Case lifecycle states. */
export type CaseStatus = 'active' | 'archived'

export interface PaymentCase {
  id: string
  title: string
  /** Optional short description of the engagement. */
  description: string
  currency: CurrencyCode
  status: CaseStatus
  /**
   * Monotonic revision counter. Any change to case-relevant evidence or
   * reviewed facts must increment this so dependent analyses and reports can
   * be marked stale instead of silently outdated.
   */
  revision: number
  createdAt: number
  updatedAt: number
}

/** Error shape shared by validation and use-case results. */
export interface CaseError {
  code: 'validation_error' | 'not_found' | 'storage_error'
  message: string
  /** Field name the error belongs to, so forms can show it inline. */
  field?: string
}

/** Success/failure for validators (no payload on success). */
export type ValidationResult = { ok: true } | { ok: false; error: CaseError }

/** Success/failure for use cases that produce or update a case. */
export type CaseResult =
  | { ok: true; case: PaymentCase }
  | { ok: false; error: CaseError }

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Currencies offered in the MVP list. One currency per case. */
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const

export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 500

/**
 * Validates and normalizes a case title: trimmed, 1–TITLE_MAX characters.
 */
export function validateTitle(title: string): ValidationResult {
  const t = title.trim()
  if (t.length === 0) {
    return {
      ok: false,
      error: { code: 'validation_error', message: 'Give the case a title.', field: 'title' },
    }
  }
  if (t.length > TITLE_MAX) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `Keep the title under ${TITLE_MAX} characters.`,
        field: 'title',
      },
    }
  }
  return { ok: true }
}

/**
 * Validates a case description (optional field, bounded length).
 */
export function validateDescription(description: string): ValidationResult {
  const d = description.trim()
  if (d.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `Keep the description under ${DESCRIPTION_MAX} characters.`,
        field: 'description',
      },
    }
  }
  return { ok: true }
}

/**
 * Normalizes a currency code: trims, uppercases, and verifies it is one of
 * the supported MVP currencies. Returns the normalized code on success.
 */
export function normalizeCurrency(
  currency: string,
): { ok: true; currency: CurrencyCode } | { ok: false; error: CaseError } {
  const c = currency.trim().toUpperCase()
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(c)) {
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: 'Choose one of the supported currencies.',
        field: 'currency',
      },
    }
  }
  return { ok: true, currency: c }
}

/* ------------------------------------------------------------------ */
/* Factory and transitions                                             */
/* ------------------------------------------------------------------ */

/**
 * Creates a new active payment case. Does not persist it — persistence is a
 * repository concern. The ID is supplied by the caller (storage layer) so the
 * domain stays storage-agnostic.
 */
export function createCase(input: {
  id: string
  title: string
  description: string
  currency: string
  createdAt: number
}): CaseResult {
  const title = validateTitle(input.title)
  if (!title.ok) return { ok: false, error: title.error }

  const description = validateDescription(input.description)
  if (!description.ok) return { ok: false, error: description.error }

  const currency = normalizeCurrency(input.currency)
  if (!currency.ok) return { ok: false, error: currency.error }

  const now = input.createdAt
  return {
    ok: true,
    case: {
      id: input.id,
      title: input.title.trim(),
      description: input.description.trim(),
      currency: currency.currency,
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/**
 * Renames a case (title and optionally description). Bumps `revision` only
 * when the content actually changes, so downstream analyses are invalidated
 * by real edits, not no-ops.
 */
export function renameCase(
  existing: PaymentCase,
  input: { title: string; description: string },
  now: number,
): CaseResult {
  const title = validateTitle(input.title)
  if (!title.ok) return { ok: false, error: title.error }

  const description = validateDescription(input.description)
  if (!description.ok) return { ok: false, error: description.error }

  const nextTitle = input.title.trim()
  const nextDescription = input.description.trim()

  const changed =
    nextTitle !== existing.title || nextDescription !== existing.description

  return {
    ok: true,
    case: changed
      ? {
          ...existing,
          title: nextTitle,
          description: nextDescription,
          revision: existing.revision + 1,
          updatedAt: now,
        }
      : existing,
  }
}

/**
 * Archives or restores a case. Archiving hides it from the active list but
 * never deletes evidence; only the explicit delete use case removes data.
 */
export function setCaseStatus(
  existing: PaymentCase,
  status: CaseStatus,
  now: number,
): CaseResult {
  if (existing.status === status) {
    return { ok: true, case: existing }
  }
  return {
    ok: true,
    case: {
      ...existing,
      status,
      revision: existing.revision + 1,
      updatedAt: now,
    },
  }
}
