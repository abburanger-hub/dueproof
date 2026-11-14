/**
 * Domain: whitespace normalization and exact quote location.
 *
 * Deterministic, dependency-free string utilities shared by the proposal
 * validation pipeline and the UI. Pure TypeScript.
 */

/** Collapses runs of whitespace into single spaces (for matching only). */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Normalizes a quote for display: trimmed, inner whitespace collapsed.
 * Does NOT lowercase — the excerpt must remain faithful to the source.
 */
export function normalizeQuote(quote: string): string {
  return normalizeWhitespace(quote)
}

export interface QuoteLocation {
  /** Offsets into the ORIGINAL block text. */
  start: number
  end: number
  /** True when the match was found after whitespace normalization. */
  normalizedMatch: boolean
}

/**
 * Locates an exact or whitespace-normalized quote inside a block's text.
 * Returns the offsets into the original text (character indices), so the UI
 * can highlight the citation without re-reading the model output.
 *
 * Rules:
 * 1. Try an exact substring match (leftmost occurrence).
 * 2. Fall back to a whitespace-normalized scan, tracking original offsets.
 * 3. Never guess: no fuzzy or semantic matching. Unverifiable quotes are
 *    rejected upstream.
 */
export function locateQuote(blockText: string, quote: string): QuoteLocation | null {
  const trimmed = quote.trim()
  if (trimmed.length === 0) return null

  const exactIndex = blockText.indexOf(trimmed)
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + trimmed.length, normalizedMatch: false }
  }

  // Normalized scan: walk the original text building normalized spans.
  const target = normalizeWhitespace(trimmed)
  if (target.length === 0) return null

  const starts: number[] = []
  const lengths: number[] = []
  let normalized = ''
  let lastOriginalStart = -1

  for (let index = 0; index < blockText.length; index += 1) {
    const char = blockText[index]
    if (char === undefined) break
    if (/\s/.test(char)) {
      if (normalized.length > 0 && !normalized.endsWith(' ')) {
        normalized += ' '
      }
      continue
    }
    if (normalized.length === 0 || normalized.endsWith(' ')) {
      lastOriginalStart = index
      starts.push(index)
    }
    normalized += char
    lengths.push(index - (lastOriginalStart ?? 0))
    void lengths
  }
  void starts

  // Simpler + safer: two-pointer scan over word spans.
  const spans = buildWordSpans(blockText)
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    let assembled = ''
    let firstSpan = spanIndex
    let lastSpan = spanIndex
    for (let cursor = spanIndex; cursor < spans.length; cursor += 1) {
      const span = spans[cursor]
      if (!span) break
      assembled = cursor === spanIndex ? span.word : `${assembled} ${span.word}`
      lastSpan = cursor
      if (assembled.length > target.length) break
      if (assembled === target) {
        const first = spans[firstSpan]
        const last = spans[lastSpan]
        if (first && last) {
          return { start: first.start, end: last.end, normalizedMatch: true }
        }
      }
    }
  }

  return null
}

interface WordSpan {
  word: string
  start: number
  end: number
}

function buildWordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    spans.push({ word: match[0], start: match.index, end: match.index + match[0].length })
  }
  return spans
}

