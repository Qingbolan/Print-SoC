import { cn } from '@/lib/utils'

interface BrandLogoProps {
  className?: string
  iconClassName?: string
  showName?: boolean
  showSubtitle?: boolean
  subtitle?: string
  inverse?: boolean
}

export function BrandLogo({
  className,
  iconClassName,
  showName = true,
  showSubtitle = true,
  subtitle = 'NUS School of Computing',
  inverse = false,
}: BrandLogoProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        className={cn(
          'flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden',
          inverse ? 'bg-transparent' : 'rounded-md bg-primary',
          iconClassName,
        )}
      >
        <img
          src="/logo-mark-white.png"
          alt="Print@SoC"
          className="h-full w-full object-contain"
        />
      </span>
      {showName && (
        <div className="min-w-0">
          <div className={cn('truncate text-base font-semibold', inverse ? 'text-white' : 'text-primary')}>
            Print<span className="text-[var(--brand-orange)]">@</span>SoC
          </div>
          {showSubtitle && (
            <div className={cn('truncate text-xs font-medium uppercase tracking-normal', inverse ? 'text-slate-300' : 'text-muted-foreground')}>
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BrandBadge({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-[var(--brand-orange-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--brand-orange)]',
        className,
      )}
    >
      NUS SoC
    </div>
  )
}
