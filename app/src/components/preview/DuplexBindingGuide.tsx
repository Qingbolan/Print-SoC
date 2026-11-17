import { bindingAxis, bindingEdge } from '@/lib/print-preview'
import { DUPLEX_LABELS } from '@/lib/print-settings'
import type { PrintSettings } from '@/types/printer'

/** A physical binding guide, separate from the actual document preview below. */
export function DuplexBindingGuide({ duplex, orientation }: Pick<PrintSettings, 'duplex' | 'orientation'>) {
  const vertical = bindingAxis(duplex, orientation) === 'vertical'
  const single = duplex === 'Simplex'
  const width = orientation === 'Portrait' ? 30 : 44
  const height = orientation === 'Portrait' ? 44 : 30
  const top = (64 - height) / 2
  const instruction = single ? 'Each side prints on a separate sheet.'
    : vertical ? 'Flip left to right, like a book.' : 'Flip top to bottom, like a calendar.'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" role="status" aria-live="polite" aria-atomic="true">
      <svg viewBox="0 0 150 64" className="h-16 w-36 shrink-0 text-primary" role="img" aria-label={`${DUPLEX_LABELS[duplex]}. ${instruction}`}>
        {[false, true].slice(0, single ? 1 : 2).map(back => {
          const x = back ? 99 : 7
          const edge = bindingEdge(duplex, orientation, back)
          return <g key={String(back)}>
            <rect x={x} y={top} width={width} height={height} rx="2" className="fill-background stroke-border" />
            <path d={`M ${x + width / 2} ${top + 8} v 8 m -3 -5 l 3 -3 3 3`} fill="none" stroke="currentColor" strokeWidth="1.5" />
            <text x={x + width / 2} y={top + height - 7} textAnchor="middle" fontSize="8" className="fill-foreground">{back ? 'Back' : 'Front'}</text>
            {edge && <line
              x1={edge === 'right' ? x + width : x} y1={edge === 'bottom' ? top + height : top}
              x2={edge === 'left' ? x : x + width} y2={edge === 'top' ? top : top + height}
              stroke="currentColor" strokeWidth="3" />}
          </g>
        })}
        {!single && <path d={vertical ? 'M 59 32 h 27 m -5 -4 l 5 4 -5 4' : 'M 65 25 q 15 -9 15 6 v 12 m -4 -5 l 4 5 4 -5'} fill="none" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
      <div className="text-xs">
        <p className="font-medium text-foreground">{DUPLEX_LABELS[duplex]}</p>
        <p className="text-muted-foreground">{instruction}</p>
        {!single && <p className="text-muted-foreground">Highlighted edge = binding. Both sides stay upright when turned this way.</p>}
      </div>
    </div>
  )
}
