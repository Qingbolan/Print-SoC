import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Segment<T extends string> {
  value: T
  label: string
  mobileLabel?: string
  icon?: LucideIcon
  count?: number
}

interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  items: ReadonlyArray<Segment<T>>
  ariaLabel: string
  className?: string
  mobileLayout?: 'scroll' | 'equal'
  mobileHideIcons?: boolean
  mobileHideCounts?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
  mobileLayout = 'scroll',
  mobileHideIcons = false,
  mobileHideCounts = false,
}: SegmentedControlProps<T>) {
  const equalOnMobile = mobileLayout === 'equal'

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={
        equalOnMobile
          ? { gridTemplateColumns: `repeat(${items.length === 4 ? 2 : items.length}, minmax(0, 1fr))` }
          : undefined
      }
      className={cn(
        'inline-flex min-h-11 max-w-full items-center gap-1 overflow-x-auto rounded-md bg-muted/70 p-1 sm:min-h-9',
        equalOnMobile && 'grid w-full overflow-visible sm:inline-flex sm:w-auto',
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon
        const selected = item.value === value

        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 rounded-[5px] px-3 text-sm font-medium transition-colors sm:h-8',
              equalOnMobile && 'min-w-0 justify-center px-2 sm:flex-none sm:px-3',
              selected
                ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(20_34_53/0.08)]'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
            )}
          >
            {Icon && (
              <Icon className={cn('size-4', mobileHideIcons && 'hidden sm:block')} />
            )}
            {item.mobileLabel ? (
              <>
                <span className="sm:hidden">{item.mobileLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </>
            ) : (
              <span>{item.label}</span>
            )}
            {item.count !== undefined && (
              <span
                className={cn(
                  'min-w-5 rounded px-1.5 text-center text-xs tabular-nums',
                  mobileHideCounts && 'hidden sm:inline-block',
                  selected ? 'bg-primary/10 text-primary' : 'bg-background/70',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
