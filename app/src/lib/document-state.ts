import type { PDFInfo } from '@/types/printer'

interface DocumentIdentity { id: string; sourcePath: string; name: string }
export type QueuedDocument = DocumentIdentity & (
  | { state: 'preparing'; path: null; pdfUrl: null; pdfInfo: null; error: null }
  | { state: 'ready'; path: string; pdfUrl: string; pdfInfo: PDFInfo; error: null }
  | { state: 'failed'; path: null; pdfUrl: null; pdfInfo: null; error: string }
)
export type ReadyDocument = Extract<QueuedDocument, { state: 'ready' }>

export function requireReadyDocument(document: QueuedDocument): ReadyDocument {
  if (document.state !== 'ready') {
    throw new Error(document.state === 'failed' ? document.error : 'Wait for document preparation to finish before printing.')
  }
  return document
}
