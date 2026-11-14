/**
 * On-device fact-extraction adapter.
 *
 * THE privacy boundary of DueProof:
 * - Uses `getLocalOnlyModel()` (InferenceMode.ONLY_ON_DEVICE). If the
 *   on-device model is unavailable this throws and the caller offers manual
 *   entry. There is no cloud fallback path in this file, by design.
 * - Sends exactly one block's text per call; the response must report
 *   `inferenceSource: 'on_device'` or it is DISCARDED.
 * - The model returns raw JSON text; the adapter never interprets it beyond
 *   splitting candidates. Domain code validates quotes/amounts/dates.
 *
 * Structured output: the request sets `responseMimeType: 'application/json'`
 * with a plain `SchemaRequest` object (verified against @firebase/ai 13.3.0
 * types: `GenerationConfig.responseSchema` accepts a plain JS object).
 */

import type { GenerateContentRequest, GenerativeModel } from '../../firebase/ai'
import { getLocalOnlyModel } from '../../firebase/ai'
import type { EvidenceError } from '../../../domain/evidence'
import { evidenceError } from '../../../domain/evidence'
import type {
  BlockExtractionInput,
  BlockExtractionResult,
  LocalFactExtractor,
} from '../../../application/ports/local-fact-extractor'

/** Small, strict vocabulary keeps on-device output bounded and parseable. */
const FACT_KIND_ENUM = [
  'agreement',
  'deliverable',
  'commitment',
  'deadline',
  'delivery',
  'approval',
  'invoice',
  'payment',
  'credit',
  'dispute',
  'other',
] as const

/** Plain-object schema (SchemaRequest) for the model's JSON response. */
const FACTS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      description:
        'Up to 4 candidate facts found in the excerpt. Empty array when none.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...FACT_KIND_ENUM] },
          statement: {
            type: 'string',
            description:
              'One short neutral sentence restating the fact in plain words. Max 200 characters.',
          },
          quote: {
            type: 'string',
            description:
              'The EXACT substring copied from the excerpt that supports the fact. Max 400 characters. Never paraphrase.',
          },
        },
        required: ['kind', 'statement', 'quote'],
      },
    },
  },
  required: ['facts'],
} as const

const INSTRUCTION = [
  'You are a careful evidence clerk for a freelance payment case.',
  'From the single excerpt below, list up to 4 candidate facts relevant to:',
  'what was agreed, promised, approved, delivered, invoiced, or paid.',
  'Rules:',
  '- "quote" MUST be an exact copy of a substring from the excerpt.',
  '- Never invent, infer, or combine across sentences.',
  '- Ignore greetings and boilerplate.',
  '- If nothing relevant, return {"facts":[]}.',
  'Return JSON only.',
].join(' ')

export class LocalOnDeviceFactExtractor implements LocalFactExtractor {
  async extract(
    input: BlockExtractionInput,
    signal?: AbortSignal,
  ): Promise<BlockExtractionResult> {
    try {
      const model: GenerativeModel = await getLocalOnlyModel()

      const request: GenerateContentRequest = {
        contents: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: INSTRUCTION },
              { type: 'text', text: `Excerpt:\n${input.block.text}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: FACTS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      }

      const result = await model.generateContent(request, signal ? { signal } : undefined)

      // Privacy contract: the call must have run on-device. Anything else is
      // discarded — never shown, never stored, never retried in the cloud.
      const source = result.response.inferenceSource
      if (source !== 'on_device') {
        return { ok: false, error: evidenceError('unexpected_source') }
      }

      const text = result.response.text()
      return { ok: true, rawProposals: splitFactsJson(text) }
    } catch (error) {
      return { ok: false, error: mapExtractorError(error) }
    }
  }
}

/**
 * Parses the model's JSON text into raw candidate objects. Never throws —
 * malformed output maps to `invalid_output`, which the service surfaces as a
 * skipped block rather than a data-bearing failure.
 */
export function splitFactsJson(
  text: string,
): Array<{ kind: unknown; statement: unknown; quote: unknown }> {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return []
    const facts = (parsed as { facts?: unknown }).facts
    if (!Array.isArray(facts)) return []
    const result: Array<{ kind: unknown; statement: unknown; quote: unknown }> = []
    for (const item of facts) {
      if (typeof item === 'object' && item !== null) {
        const record = item as Record<string, unknown>
        result.push({
          kind: record['kind'],
          statement: record['statement'],
          quote: record['quote'],
        })
      }
    }
    return result
  } catch {
    return []
  }
}

/**
 * Maps thrown values to safe error codes. Raw error text never leaves this
 * adapter; users see the mapped message only.
 */
export function mapExtractorError(error: unknown): EvidenceError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return evidenceError('cancelled')
  }
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (
    message.includes('not available') ||
    message.includes('unavailable') ||
    message.includes('no on-device') ||
    message.includes('model not') ||
    message.includes('notfound') ||
    message.includes('not found')
  ) {
    return evidenceError('model_unavailable')
  }
  if (message.includes('blocked') || message.includes('safety')) {
    return evidenceError('blocked')
  }
  return evidenceError('extraction_failed')
}

