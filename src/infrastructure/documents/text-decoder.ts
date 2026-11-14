/**
 * Plain-text import — local decoding only, no network.
 *
 * Validates that the bytes decode as UTF-8 text within the size limit and
 * returns the decoded string. All failures map to safe domain error codes.
 */

import {
  documentError,
  MAX_TEXT_CHARS,
  type DocumentError,
} from '../../domain/documents/document'

export interface TextDecodeResult {
  text: string
}

/**
 * Decodes a local file's bytes as UTF-8 text. Rejects undecodable content
 * (heuristic: U+FFFD replacement characters) and oversized text.
 */
export function decodeTextBytes(bytes: Uint8Array): { ok: true; result: TextDecodeResult } | { ok: false; error: DocumentError } {
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (text.includes('\uFFFD')) {
      return { ok: false, error: documentError('text_decode_failed') }
    }
    if (text.length > MAX_TEXT_CHARS) {
      return { ok: false, error: documentError('text_too_large') }
    }
    return { ok: true, result: { text } }
  } catch {
    return { ok: false, error: documentError('text_decode_failed') }
  }
}
