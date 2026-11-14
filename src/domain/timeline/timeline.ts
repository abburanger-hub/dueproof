/**
 * Domain: evidence timeline.
 *
 * A pure, deterministic chronological view over a case's facts.
 *
 * Mandatory honesty rules:
 * - Rejected facts never appear.
 * - Only facts whose parsed date has day, month, or year precision are
 *   placed on the timeline. Everything else (ambiguous, relative,
 *   unresolved, or undated facts) lands in a clearly labelled trailing
 *   "Date uncertain" group. Dates are never guessed or forced to a false
 *   precision.
 * - Group order is chronological (ISO keys sort naturally); the uncertain
 *   group is always last.
 * - Within a group, entries keep a stable order (createdAt, then id) so the
 *   view never shuffles between renders.
 *
 * Pure TypeScript — no React, Firebase, or storage imports.
 */

import type { EvidenceFact } from '../evidence'

export type TimelineGroupPrecision = 'day' | 'month' | 'year' | 'uncertain'

export interface TimelineGroup {
  /** Sort key: ISO date prefix, or 'uncertain' for the trailing group. */
  key: string
  /** Human-readable group label (e.g. "28 October 2026", "November 2026"). */
  label: string
  precision: TimelineGroupPrecision
  /** ISO prefix when placed on the timeline; null for the uncertain group. */
  iso: string | null
  entries: EvidenceFact[]
}

export interface TimelineResult {
  groups: TimelineGroup[]
  /** Facts that could not be placed on a date. */
  uncertainCount: number
  /** Total non-rejected facts included in the view. */
  includedCount: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/
const ISO_YEAR = /^\d{4}$/

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function dayLabel(iso: string): string {
  const [year = '0', month = '1', day = '1'] = iso.split('-')
  return dayFormatter.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))))
}

function monthLabel(iso: string): string {
  const [year = '0', month = '1'] = iso.split('-')
  return monthFormatter.format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)))
}

interface Placement {
  key: string
  precision: 'day' | 'month' | 'year'
  iso: string
}

/** Returns a timeline placement, or null when the fact cannot be dated. */
function placementFor(fact: EvidenceFact): Placement | null {
  const date = fact.date
  if (!date?.iso) return null
  const iso = date.iso
  if (date.precision === 'day' && ISO_DAY.test(iso)) return { key: iso, precision: 'day', iso }
  if (date.precision === 'month' && ISO_MONTH.test(iso)) return { key: iso, precision: 'month', iso }
  if (date.precision === 'year' && ISO_YEAR.test(iso)) return { key: iso, precision: 'year', iso }
  return null
}

/** Stable ordering inside a group: createdAt, then id. */
function stableOrder(a: EvidenceFact, b: EvidenceFact): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

export function buildTimeline(facts: EvidenceFact[]): TimelineResult {
  const placed = new Map<string, TimelineGroup>()
  const uncertain: EvidenceFact[] = []
  let includedCount = 0

  for (const fact of facts) {
    if (fact.status === 'rejected') continue
    includedCount += 1

    const placement = placementFor(fact)
    if (!placement) {
      uncertain.push(fact)
      continue
    }

    let group = placed.get(placement.key)
    if (!group) {
      group = {
        key: placement.key,
        label:
          placement.precision === 'day'
            ? dayLabel(placement.iso)
            : placement.precision === 'month'
              ? monthLabel(placement.iso)
              : placement.iso,
        precision: placement.precision,
        iso: placement.iso,
        entries: [],
      }
      placed.set(placement.key, group)
    }
    group.entries.push(fact)
  }

  for (const group of placed.values()) {
    group.entries.sort(stableOrder)
  }
  uncertain.sort(stableOrder)

  const groups = [...placed.values()].sort((a, b) => a.key.localeCompare(b.key))
  if (uncertain.length > 0) {
    groups.push({
      key: 'uncertain',
      label: 'Date uncertain',
      precision: 'uncertain',
      iso: null,
      entries: uncertain,
    })
  }

  return { groups, uncertainCount: uncertain.length, includedCount }
}
