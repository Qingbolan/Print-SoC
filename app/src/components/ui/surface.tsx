import * as React from 'react'
import { cn } from '@/lib/utils'

type SurfaceTone = 'default' | 'muted' | 'brand' | 'warning'

interface SurfaceProps extends React.ComponentProps<'div'> {
  tone?: SurfaceTone
  interactive?: boolean
}

const toneClasses: Record<SurfaceTone, string> = {
  default: 'bg-card text-card-foreground',
  muted: 'bg-muted/70 text-foreground',
  brand: 'border border-primary/10 bg-primary/6 text-foreground',
  warning:
    'bg-[var(--brand-orange-subtle)] text-foreground',
}

export function Surface({
  tone = 'default',
  interactive = false,
  className,
  ...props
}: SurfaceProps) {
  return (
    <div
      className={cn(
        'rounded-md',
        'transition-colors duration-150',
        toneClasses[tone],
        interactive &&
          'cursor-pointer hover:bg-[var(--card-hover)]',
        className,
      )}
      {...props}
    />
  )
}
