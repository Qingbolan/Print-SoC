import type { DuplexMode, PrintSettings } from '@/types/printer'

export type TurnAxis = 'vertical' | 'horizontal'

export function bindingAxis(duplex: DuplexMode, orientation: PrintSettings['orientation']): TurnAxis {
  const longEdgeIsVertical = orientation === 'Portrait'
  return (duplex === 'DuplexLongEdge') === longEdgeIsVertical ? 'vertical' : 'horizontal'
}

export function backRotation(duplex: DuplexMode, orientation: PrintSettings['orientation'], turn: TurnAxis): number {
  return duplex !== 'Simplex' && bindingAxis(duplex, orientation) !== turn ? 180 : 0
}

export function makeSheets(pages: number[], perSide: number, duplex: DuplexMode) {
  if (!Number.isInteger(perSide) || perSide < 1) throw new Error('Invalid pages per side')
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const stride = perSide * (duplex === 'Simplex' ? 1 : 2)
  const sheets: { front: number[]; back: number[] }[] = []
  for (let i = 0; i < sorted.length; i += stride) {
    sheets.push({ front: sorted.slice(i, i + perSide), back: duplex === 'Simplex' ? [] : sorted.slice(i + perSide, i + stride) })
  }
  return sheets
}

export function fitPage(width: number, height: number, pageWidth: number, pageHeight: number) {
  return Math.max(1, Math.min(width, height * pageWidth / pageHeight))
}

/** Saddle-stitch imposition: outside-in pairs, padded to complete sheets. */
export function makeBookletSheets(pages: number[]) {
  const selected = [...new Set(pages)].sort((a, b) => a - b)
  const padded = Math.ceil(selected.length / 4) * 4
  const page = (index: number): number | null => selected[index] ?? null
  return Array.from({ length: padded / 4 }, (_, sheet) => ({
    front: [page(padded - 1 - sheet * 2), page(sheet * 2)],
    back: [page(sheet * 2 + 1), page(padded - 2 - sheet * 2)],
  }))
}

/** Physical turning direction determines the duplex binding sent to the printer. */
export function duplexForTurn(turn: TurnAxis, orientation: PrintSettings['orientation']): DuplexMode {
  return (turn === 'vertical') === (orientation === 'Portrait') ? 'DuplexLongEdge' : 'DuplexShortEdge'
}

/** The same physical binding appears on the opposite edge after turning over. */
export function bindingEdge(duplex: DuplexMode, orientation: PrintSettings['orientation'], back = false): 'left' | 'right' | 'top' | 'bottom' | null {
  if (duplex === 'Simplex') return null
  return bindingAxis(duplex, orientation) === 'vertical'
    ? (back ? 'right' : 'left')
    : (back ? 'bottom' : 'top')
}
