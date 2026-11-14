import { useDocuments } from '../documents/useDocuments'
import { EvidencePanel } from './EvidencePanel'
import type { PaymentCase } from '../../domain/cases/case'
import { LocalOnDeviceFactExtractor } from '../../infrastructure/ai/local/fact-extractor'

/**
 * Bridges the documents state into the evidence panel: facts are extracted
 * per document, so the panel needs the same case's document list. The
 * extractor stays a single shared on-device instance.
 */
export function EvidencePanelWithDocuments({ paymentCase }: { paymentCase: PaymentCase }) {
  const { documents } = useDocuments(paymentCase)
  return (
    <EvidencePanel
      paymentCase={paymentCase}
      documents={documents}
      extractor={new LocalOnDeviceFactExtractor()}
    />
  )
}

export { LocalOnDeviceFactExtractor }

