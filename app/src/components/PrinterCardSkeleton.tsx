import { cn } from '@/lib/utils'

export function PrinterCardSkeleton() {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden animate-pulse">
      <div className="p-6 flex items-center justify-between">
        {/* Printer Name Skeleton */}
        <div className="h-8 bg-muted rounded w-32" />

        {/* Queue Count Badge Skeleton */}
        <div className="w-12 h-10 bg-muted rounded-md" />
      </div>

      {/* Additional Info Skeleton */}
      <div className="px-6 pb-4 pt-2 border-t border-border/50">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-4 bg-muted rounded w-12" />
            <div className="h-4 bg-muted rounded w-16" />
          </div>
          <div className="flex items-center justify-between">
            <div className="h-4 bg-muted rounded w-14" />
            <div className="h-4 bg-muted rounded w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function PrinterGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl">
      {Array.from({ length: count }).map((_, i) => (
        <PrinterCardSkeleton key={i} />
      ))}
    </div>
  )
}
