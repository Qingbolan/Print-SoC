import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageScaffoldProps {
  header: ReactNode
  metrics?: ReactNode
  navigation?: ReactNode
  children: ReactNode
  contentClassName?: string
  contentInnerClassName?: string
  contentWidth?: 'full' | 'wide' | 'reading' | 'form'
}

const contentWidthClasses = {
  full: '',
  wide: '',
  reading: '',
  form: '',
}

export function PageScaffold({
  header,
  metrics,
  navigation,
  children,
  contentClassName,
  contentInnerClassName,
  contentWidth = 'full',
}: PageScaffoldProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-4 pb-5 pt-5 sm:px-7 sm:pt-7 lg:px-10 lg:pt-8">
        {header}
        {metrics && <div className="mt-5">{metrics}</div>}
        {navigation && <div className="mt-4">{navigation}</div>}
      </header>
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-7 sm:pb-8 lg:px-10',
          contentClassName,
        )}
      >
        <div
          className={cn(
            'w-full',
            contentWidthClasses[contentWidth],
            contentInnerClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
