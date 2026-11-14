/**
 * Domain: deterministic source-block construction.
 *
 * Extraction produces text; this module turns text into bounded, source-
 * mapped blocks with stable page/line/character coordinates. Later evidence
 * features cite these coordinates, so the mapping must be reproducible and
 * verifiable: joining blocks with BLOCK_JOIN must reconstruct a document
 * text where every block's [charStart, charEnd) slice equals its text.
 *
 * Pure TypeScript — no pdf.js, React, or storage imports.
 */

import {
  BLOCK_MAX_CHARS,
  BLOCK_TARGET_CHARS,
  type BlockBox,
} from './document'

/** Separator used to join blocks into the canonical document text. */
export const BLOCK_JOIN = '\n\n'

/** pdf.js text item reduced to the fields block building needs. */
export interface NormalizedTextItem {
  str: string
  hasEOL: boolean
  x: number
  y: number
  width: number
  height: number
}

/** One physical line of text with its position. */
export interface RawLine {
  text: string
  /** 1-based line number within the page (PDF) or file (text). */
  lineNo: number
  box?: BlockBox
}

/** A block before persistence (ids and document linkage are added later). */
export interface BlockDraft {
  order: number
  pageNumber: number | null
  lineStart: number
  lineEnd: number
  charStart: number
  charEnd: number
  text: string
  box?: BlockBox
}

/**
 * Groups positioned text items into lines. A new line starts when pdf.js
 * marks an explicit end-of-line or the baseline (y) moves by more than half
 * the current line height — the standard signals for visual line breaks.
 * Items with no content and no EOL marker are skipped as noise.
 */
export function groupItemsIntoLines(items: NormalizedTextItem[]): RawLine[] {
  const lines: RawLine[] = []
  let current: {
    lineNo: number
    parts: string[]
    minY: number
    maxY: number
    minX: number
    maxX: number
    lastY: number
    lineHeight: number
  } | null = null

  const flush = () => {
    if (!current) return
    lines.push({
      text: current.parts.join(''),
      lineNo: current.lineNo,
      box: {
        x: current.minX,
        y: current.minY,
        width: current.maxX - current.minX,
        height: current.maxY - current.minY,
      },
    })
    current = null
  }

  for (const item of items) {
    const hasContent = item.str.length > 0

    if (!current) {
      if (!hasContent && !item.hasEOL) continue // leading noise
      if (!hasContent) continue
      current = {
        lineNo: lines.length + 1,
        parts: [item.str],
        minX: item.x,
        maxX: item.x + item.width,
        minY: item.y,
        maxY: item.y + item.height,
        lastY: item.y,
        lineHeight: item.height,
      }
    } else if (
      hasContent &&
      Math.abs(item.y - current.lastY) > Math.max(current.lineHeight * 0.5, 1)
    ) {
      // Baseline moved: a new visual line started.
      flush()
      current = {
        lineNo: lines.length + 1,
        parts: [item.str],
        minX: item.x,
        maxX: item.x + item.width,
        minY: item.y,
        maxY: item.y + item.height,
        lastY: item.y,
        lineHeight: item.height,
      }
    } else if (hasContent) {
      current.parts.push(item.str)
      current.minX = Math.min(current.minX, item.x)
      current.maxX = Math.max(current.maxX, item.x + item.width)
      current.minY = Math.min(current.minY, item.y)
      current.maxY = Math.max(current.maxY, item.y + item.height)
      current.lastY = item.y
    }

    if (item.hasEOL) flush()
  }

  flush()
  // Lines with no visible text (e.g. whitespace-only) still consume a line
  // number but add no citable content.
  return lines
}

function unionBox(lines: RawLine[]): BlockBox | undefined {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let seen = false
  for (const line of lines) {
    if (!line.box) continue
    seen = true
    minX = Math.min(minX, line.box.x)
    minY = Math.min(minY, line.box.y)
    maxX = Math.max(maxX, line.box.x + line.box.width)
    maxY = Math.max(maxY, line.box.y + line.box.height)
  }
  if (!seen) return undefined
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Accumulates lines into bounded blocks. A block closes when it reaches the
 * target size, or when adding the next line would exceed the hard maximum.
 * A single line longer than the maximum still becomes its own block — text
 * is never split mid-line, so line references stay exact.
 */
export function buildBlocksFromLines(
  lines: RawLine[],
  pageNumber: number | null,
): BlockDraft[] {
  const blocks: BlockDraft[] = []
  let current: RawLine[] = []
  let currentChars = 0
  let order = 0
  let charCursor = 0

  const flush = () => {
    if (current.length === 0) return
    const text = current.map((line) => line.text).join('\n')
    const first = current[0]
    const last = current[current.length - 1]
    if (first && last) {
      blocks.push({
        order,
        pageNumber,
        lineStart: first.lineNo,
        lineEnd: last.lineNo,
        charStart: charCursor,
        charEnd: charCursor + text.length,
        text,
        box: unionBox(current),
      })
    }
    charCursor += text.length + BLOCK_JOIN.length
    order += 1
    current = []
    currentChars = 0
  }

  for (const line of lines) {
    const prospective = currentChars + line.text.length + 1
    if (current.length > 0 && (currentChars >= BLOCK_TARGET_CHARS || prospective > BLOCK_MAX_CHARS)) {
      flush()
    }
    current.push(line)
    currentChars += line.text.length + 1
  }

  flush()
  return blocks
}

/**
 * Builds blocks from plain decoded text (text files). Empty lines keep their
 * line numbers but contribute no block content.
 */
export function buildBlocksFromText(text: string): BlockDraft[] {
  const rawLines = text.split(/\r\n|\r|\n/)
  const lines: RawLine[] = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const value = rawLines[index]
    if (value === undefined || value.trim().length === 0) continue
    lines.push({ text: value, lineNo: index + 1 })
  }
  return buildBlocksFromLines(lines, null)
}

/** Reconstructs the canonical document text from blocks (for verification). */
export function documentTextFromBlocks(blocks: { text: string }[]): string {
  return blocks.map((block) => block.text).join(BLOCK_JOIN)
}
