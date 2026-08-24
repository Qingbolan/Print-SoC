import React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div
        className={cn(
          'grid min-w-0 items-start gap-x-3 gap-y-0.5',
          icon ? 'grid-cols-[1.5rem_minmax(0,1fr)]' : 'grid-cols-1',
        )}
      >
        {icon && (
          <span className="row-span-2 mt-1 flex size-6 items-center justify-center text-primary [&>svg]:size-[1.125rem]">
            {icon}
          </span>
        )}
        <h1 className="min-w-0 break-words text-xl font-semibold leading-7 text-foreground">
          {title}
        </h1>
        {description && (
          <p className="min-w-0 text-sm leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:pl-4">
          {actions}
        </div>
      )}
    </div>
  )
}
