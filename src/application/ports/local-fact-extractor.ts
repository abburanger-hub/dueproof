import type { SourceBlock } from '../../domain/documents/document'
import type { EvidenceError } from '../../domain/evidence'

/**
 * Application port: local-only fact extraction.
 *
 * The port is the privacy boundary in code form. It has ONE implementation —
 * the on-device adapter — and its interface deliberately exposes no cloud
 * capability, no retry-elsewhere option, and no raw-text passthrough beyond
 * the single block being processed. The service depends on this interface,
 * never on the Firebase SDK directly, so tests can substitute a fake.
 */
export interface BlockExtractionInput {
  block: Pick<SourceBlock, 'id' | 'text'>
  caseCurrency: string
}

export type BlockExtractionResult =
  | { ok: true; rawProposals: Array<{ kind: unknown; statement: unknown; quote: unknown }> }
  | { ok: false; error: EvidenceError }

/** Local-only extractor port. Never throws. */
export interface LocalFactExtractor {
  extract(input: BlockExtractionInput, signal?: AbortSignal): Promise<BlockExtractionResult>
}

