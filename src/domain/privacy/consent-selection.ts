/**
 * Domain: per-fact disclosure selection for the consent UI.
 *
 * The disclosure builder already supports an explicit `includedFactIds` set;
 * this module computes the initial selection state the consent UI starts
 * from, and enforces the safety floor on top of it:
 *
 * - Only facts eligible for disclosure can ever be selected. Proposed and
 *   rejected facts are not selectable — the UI must not offer them.
 * - Sensitive-detected facts start UNselected, with a clear reason; the user
 *   may explicitly include them after seeing the warning (the override).
 * - Any selection that drifts outside the eligible set is sanitized, so a
 *   stale UI state can never smuggle an ineligible fact into a payload.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import type { EvidenceFact } from '../evidence'
import { eligibleForDisclosure, scanSensitive, type SensitiveMatch } from './disclosure'

export interface SelectableFact {
  fact: EvidenceFact
  /** Sensitive matches found in the statement (display only). */
  sensitiveMatches: SensitiveMatch[]
  /** Whether this fact is currently selected for the payload. */
  selected: boolean
}

export interface SelectionState {
  /** All facts eligible for disclosure, in stable input order. */
  selectable: SelectableFact[]
  /** Eligible facts that cannot be included for structural reasons (cap). */
  capped: EvidenceFact[]
  /** The initial `includedFactIds` for `buildDisclosure`. */
  defaultIncludedFactIds: ReadonlySet<string>
}

export const MAX_DISCLOSURE_FACTS = 60

/**
 * Computes the consent UI's initial selection state:
 * eligible facts, their sensitive scan, and the default selection (clean
 * facts selected, sensitive facts left out pending an explicit override).
 */
export function buildSelectionState(facts: EvidenceFact[]): SelectionState {
  const selectable: SelectableFact[] = []
  for (const fact of facts) {
    if (!eligibleForDisclosure(fact)) continue
    const sensitiveMatches = scanSensitive(fact.statement)
    selectable.push({
      fact,
      sensitiveMatches,
      selected: sensitiveMatches.length === 0,
    })
  }
  if (selectable.length > MAX_DISCLOSURE_FACTS) {
    const capped = selectable.slice(MAX_DISCLOSURE_FACTS).map((entry) => entry.fact)
    return {
      selectable: selectable.slice(0, MAX_DISCLOSURE_FACTS),
      capped,
      defaultIncludedFactIds: new Set(
        selectable
          .slice(0, MAX_DISCLOSURE_FACTS)
          .filter((entry) => entry.selected)
          .map((entry) => entry.fact.id),
      ),
    }
  }
  return {
    selectable,
    capped: [],
    defaultIncludedFactIds: new Set(
      selectable.filter((entry) => entry.selected).map((entry) => entry.fact.id),
    ),
  }
}

/**
 * Sanitizes a live selection: drops ids that are no longer eligible, no
 * longer exist, or exceed the cap. The UI calls this before every build so
 * a stale checkbox state can never include an ineligible fact.
 */
export function sanitizeSelection(
  selection: ReadonlySet<string>,
  eligibleIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const kept = new Set<string>()
  let count = 0
  for (const id of selection) {
    if (!eligibleIds.has(id)) continue
    if (count >= MAX_DISCLOSURE_FACTS) break
    kept.add(id)
    count += 1
  }
  return kept
}
