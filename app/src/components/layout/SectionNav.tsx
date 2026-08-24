import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SectionNavItem {
  value: string
  label: string
  icon: LucideIcon
}

interface SectionNavProps {
  label: string
  value: string
  items: readonly SectionNavItem[]
  onValueChange: (value: string) => void
  footer?: ReactNode
}

export function SectionNav({ label, value, items, onValueChange, footer }: SectionNavProps) {
  return (
    <aside className="sticky top-0 hidden rounded-md bg-muted/55 p-1.5 lg:block">
      <div className="px-2.5 pb-2 pt-1.5 text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <nav aria-label={label} className="space-y-0.5">
        {items.map(({ value: itemValue, label: itemLabel, icon: Icon }) => (
          <button
            key={itemValue}
            type="button"
            onClick={() => onValueChange(itemValue)}
            aria-current={value === itemValue ? 'page' : undefined}
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-sm transition-colors',
              value === itemValue
                ? 'bg-card font-medium text-foreground'
                : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{itemLabel}</span>
          </button>
        ))}
      </nav>
      {footer && <div className="mt-1">{footer}</div>}
    </aside>
  )
}
