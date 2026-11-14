/**
 * Local-only SHA-256 checksums for duplicate detection.
 *
 * Uses the platform's Web Crypto API (available in all modern browsers and
 * Node 18+). A checksum detects accidental duplicate imports; it is NOT an
 * authenticity proof, per the project's evidence rules.
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
