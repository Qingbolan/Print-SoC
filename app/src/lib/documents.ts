import { safeInvoke, safeDialogOpen } from '@/lib/tauri-utils'
import type { PDFInfo } from '@/types/printer'

export interface PreparedDocument { path: string; name: string; info: PDFInfo }

export function prepareDocument(filePath: string) {
  return safeInvoke<PreparedDocument>('document_prepare', { filePath })
}

export async function browseDocument() {
  const formats = await safeInvoke<string[]>('document_extensions')
  if (!formats.success || !formats.data) throw new Error(formats.error || 'Document formats unavailable')
  return safeDialogOpen({ multiple: false, filters: [{ name: 'Printable documents', extensions: formats.data }] })
}
