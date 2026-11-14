/**
 * Domain: money formatting for display only.
 *
 * Facts store integer minor units. This module renders them for humans.
 * Rendering never changes the stored value.
 */

import { supportedMinorUnitDigits } from './parse'

/** Formats integer minor units as a localized currency string. */
export function formatMinorUnits(minorUnits: number, currency: string, locale = 'en-IN'): string {
  const digits = supportedMinorUnitDigits(currency)
  const value = minorUnits / 10 ** digits
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).format(value)
  } catch {
    // Unknown currency code: fall back to a plain number with the code.
    return `${value.toFixed(digits)} ${currency.toUpperCase()}`
  }
}

