/**
 * Infrastructure: client-side PDF report rendering with pdf-lib.
 *
 * The PDF is generated entirely on this device from the local report
 * snapshot. No network, no server, no third-party fonts (StandardFonts only).
 *
 * Honesty rules in the rendering:
 * - The balance line is labelled "based on reviewed supplied records".
 * - Facts whose cited source block no longer resolves print
 *   "source no longer available" instead of a fabricated reference.
 * - The source index prints readable references (document · page · lines);
 *   exported PDFs cannot link into IndexedDB, so no fake links are drawn.
 * - A footer on every page repeats that this is a record of supplied
 *   documents, not proof of authenticity or a legal claim.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { PaymentRequestReport, ReportFact } from '../../domain/reports/report'
import { formatMinorUnits } from '../../domain/evidence/format'

const PAGE_WIDTH = 595.28 // A4 at 72dpi
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const BODY_SIZE = 10.5
const LINE_GAP = 4.5

const ink = rgb(0.13, 0.16, 0.23)
const muted = rgb(0.42, 0.47, 0.55)
const accent = rgb(0.29, 0.33, 0.85)

interface Cursor {
  page: PDFPage
  y: number
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('')
      continue
    }
    const words = paragraph.split(/\s+/)
    let current = ''
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
      } else {
        if (current.length > 0) lines.push(current)
        current = word
      }
    }
    if (current.length > 0) lines.push(current)
  }
  return lines
}

function drawWrapped(
  doc: PDFDocument,
  cursor: Cursor,
  text: string,
  font: PDFFont,
  size: number,
  color = ink,
): void {
  const maxWidth = PAGE_WIDTH - MARGIN * 2
  for (const line of wrapText(text, font, size, maxWidth)) {
    if (cursor.y < MARGIN + 40) {
      cursor.page = newPage(doc)
      cursor.y = PAGE_HEIGHT - MARGIN
    }
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y,
      size,
      font,
      color,
    })
    cursor.y -= size + LINE_GAP
  }
}

function factSourceLabel(fact: ReportFact): string {
  const source = fact.source
  if (!source) return fact.statement ? 'source: manual entry' : ''
  if (source.sourceMissing) return 'source no longer available'
  const parts: string[] = []
  if (source.documentName) parts.push(source.documentName)
  if (source.pageNumber !== null) parts.push(`page ${source.pageNumber}`)
  if (source.lineStart !== null && source.lineEnd !== null) {
    parts.push(`lines ${source.lineStart}–${source.lineEnd}`)
  }
  return parts.length > 0 ? `source: ${parts.join(' · ')}` : 'source: imported document'
}

/** Renders the report snapshot into a PDF byte array, fully client-side. */
export async function renderReportPdf(report: PaymentRequestReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  doc.setTitle(`DueProof evidence report — ${report.title}`)
  doc.setSubject('Evidence reconciliation report')
  doc.setProducer('DueProof (local, client-side)')

  const cursor: Cursor = { page: newPage(doc), y: PAGE_HEIGHT - MARGIN }

  // Title block
  cursor.page.drawText('DueProof — evidence report', {
    x: MARGIN,
    y: cursor.y,
    size: 16,
    font: bold,
    color: ink,
  })
  cursor.y -= 24
  cursor.page.drawText(report.title, {
    x: MARGIN,
    y: cursor.y,
    size: 12,
    font: bold,
    color: accent,
  })
  cursor.y -= 18
  const composed = new Date(report.composedAt).toISOString().slice(0, 10)
  drawWrapped(doc, cursor, `Composed ${composed} · case revision ${report.caseRevision}`, font, 9, muted)
  cursor.y -= 6

  // Recorded balance
  cursor.page.drawText('Recorded balance (based on reviewed supplied records)', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  const totals = report.ledger.totals
  if (totals) {
    const currency = totals.currency
    const lines = [
      `Charges: ${formatMinorUnits(totals.charges, currency)}`,
      `Payments: ${formatMinorUnits(totals.payments, currency)}`,
      `Credits: ${formatMinorUnits(totals.credits, currency)}`,
      `Recorded balance: ${formatMinorUnits(totals.recordedBalance, currency)}`,
    ]
    for (const line of lines) {
      drawWrapped(doc, cursor, line, font, BODY_SIZE)
    }
  } else {
    drawWrapped(
      doc,
      cursor,
      'No reviewed financial entries yet — no balance is shown.',
      font,
      BODY_SIZE,
      muted,
    )
  }
  cursor.y -= 8

  // Timeline
  cursor.page.drawText('Evidence timeline', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  if (report.timeline.groups.length === 0) {
    drawWrapped(doc, cursor, 'No dated reviewed facts yet.', font, BODY_SIZE, muted)
  }
  for (const group of report.timeline.groups) {
    drawWrapped(doc, cursor, group.label, bold, BODY_SIZE)
    for (const fact of group.entries) {
      drawWrapped(doc, cursor, `• ${fact.statement}`, font, BODY_SIZE)
      const label = factSourceLabel({
        id: fact.id,
        kind: fact.kind,
        statement: fact.statement,
        amount: fact.amount,
        date: fact.date,
        status: fact.status,
        source:
          report.facts.find((entry) => entry.id === fact.id)?.source ?? null,
      })
      drawWrapped(doc, cursor, `   ${label}`, font, 8.5, muted)
    }
    cursor.y -= 4
  }
  cursor.y -= 8

  // Findings
  cursor.page.drawText('Findings kept from the cloud analysis', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  if (report.findings.length === 0) {
    drawWrapped(doc, cursor, 'No kept findings.', font, BODY_SIZE, muted)
  }
  for (const finding of report.findings) {
    drawWrapped(doc, cursor, `• [${finding.evidenceStatus}] ${finding.explanation}`, font, BODY_SIZE)
    if (finding.unresolvedQuestion) {
      drawWrapped(doc, cursor, `   Question: ${finding.unresolvedQuestion}`, font, 8.5, muted)
    }
  }
  cursor.y -= 8

  // Missing-evidence observations
  cursor.page.drawText('Missing-evidence observations', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  if (report.signals.length === 0) {
    drawWrapped(doc, cursor, 'None.', font, BODY_SIZE, muted)
  }
  for (const signal of report.signals) {
    drawWrapped(doc, cursor, `• [${signal.evidenceStatus}] ${signal.message}`, font, BODY_SIZE)
  }
  cursor.y -= 8

  // Payment request letter
  cursor.page.drawText('Payment request (your text)', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  drawWrapped(doc, cursor, report.letter, font, BODY_SIZE)
  cursor.y -= 8

  // Source index
  cursor.page.drawText('Source index', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: ink,
  })
  cursor.y -= 16
  for (const fact of report.facts) {
    const label = factSourceLabel(fact)
    drawWrapped(doc, cursor, `• ${fact.statement} — ${label}`, font, 8.5, muted)
  }

  // Footer on every page
  const pages = doc.getPages()
  pages.forEach((page, index) => {
    const footer =
      'Based on reviewed supplied records. Not proof of authenticity, not a legal claim.'
    const width = font.widthOfTextAtSize(footer, 8)
    page.drawText(footer, {
      x: (PAGE_WIDTH - width) / 2,
      y: MARGIN / 2,
      size: 8,
      font,
      color: muted,
    })
    page.drawText(`${index + 1}`, {
      x: PAGE_WIDTH - MARGIN,
      y: MARGIN / 2,
      size: 8,
      font,
      color: muted,
    })
  })

  return doc.save()
}
