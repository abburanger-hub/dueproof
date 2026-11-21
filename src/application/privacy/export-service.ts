/**
 * Application: local data controls — export/backup of a case.
 *
 * Exports a case as a single self-contained JSON document:
 * - Case metadata, documents (metadata + original bytes as base64),
 *   extracted source blocks, facts, disclosure snapshots, and findings.
 * - Byte-for-byte local: no network is touched anywhere in this module.
 *
 * Honesty rules (mirrored in the UI):
 * - The export contains SENSITIVE data (client names, messages, amounts).
 *   The UI must warn before export and before the user shares the file.
 * - An export is a backup of the LOCAL record. Restoring it elsewhere moves
 *   the data — that is the user's decision, not a sync feature.
 */

import { getDb } from '../../infrastructure/storage/db'
import { listCaseFacts } from '../../infrastructure/storage/fact-repository'
import { listFindings } from '../../infrastructure/storage/finding-repository'
import { getCase } from '../../infrastructure/storage/case-repository'

export const EXPORT_SCHEMA = 'dueproof.case-export/v1'

export type ExportErrorCode = 'not_found' | 'storage_error'

export interface ExportError {
  code: ExportErrorCode
  message: string
}

export interface CaseExport {
  schema: typeof EXPORT_SCHEMA
  exportedAt: number
  case: Record<string, unknown>
  documents: Array<Record<string, unknown> & { originalBase64: string | null }>
  sourceBlocks: Array<Record<string, unknown>>
  facts: Array<Record<string, unknown>>
  disclosures: Array<Record<string, unknown>>
  findings: Array<Record<string, unknown>>
}

export type ExportResult =
  | { ok: true; export: CaseExport }
  | { ok: false; error: ExportError }

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** Builds the full local export for a case. Pure read + serialize. */
export async function buildCaseExport(caseId: string): Promise<ExportResult> {
  let paymentCase
  try {
    paymentCase = await getCase(caseId)
  } catch {
    return { ok: false, error: { code: 'storage_error', message: 'Reading this case failed.' } }
  }
  if (!paymentCase) {
    return { ok: false, error: { code: 'not_found', message: 'This case is no longer on this device.' } }
  }

  try {
    const db = getDb()
    const documents = (await db.documents.where('caseId').equals(caseId).toArray()).sort(
      (a, b) => a.createdAt - b.createdAt,
    )
    const blocks = (await db.sourceBlocks.where('caseId').equals(caseId).toArray()).sort(
      (a, b) => a.order - b.order,
    )
    const originals = await db.originals.bulkGet(documents.map((doc) => doc.id))
    const factRows = await listCaseFacts(caseId)
    const disclosures = (await db.disclosures.where('caseId').equals(caseId).toArray()).sort(
      (a, b) => a.approvedAt - b.approvedAt,
    )
    const findingRows = await listFindings(caseId)

    const exportDoc: CaseExport = {
      schema: EXPORT_SCHEMA,
      exportedAt: Date.now(),
      case: { ...paymentCase },
      documents: documents.map((doc, index) => {
        const original = originals[index]
        return {
          ...doc,
          originalBase64: original ? toBase64(original.bytes) : null,
        }
      }),
      sourceBlocks: blocks.map((block) => ({ ...block })),
      facts: factRows.map((row) => ({ ...row.fact })),
      disclosures: disclosures.map((snapshot) => ({ ...snapshot })),
      findings: findingRows.map((row) => ({ ...row.finding })),
    }
    return { ok: true, export: exportDoc }
  } catch {
    return { ok: false, error: { code: 'storage_error', message: 'Exporting this case failed.' } }
  }
}

/** Serializes the export and returns it as a downloadable JSON blob string. */
export function serializeExport(exportDoc: CaseExport): string {
  return JSON.stringify(exportDoc, null, 2)
}

/** Suggested filename: `dueproof-<case title slug>-<iso date>.json`. */
export function exportFileName(title: string, exportedAt: number): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'case'
  const iso = new Date(exportedAt).toISOString().slice(0, 10)
  return `dueproof-${slug}-${iso}.json`
}
