import { useEffect, useState } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { checkPrinterQueue } from '@/lib/printer-api'
import type { PrinterGroup } from '@/types/printer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrinterGridSkeleton } from '@/components/PrinterCardSkeleton'
import { AnimatedCard } from '@/components/magic/animated-card'

export default function PrintQueuePage() {
  const { printerGroups, updatePrinterStatus, sshConfig, isConnected } = usePrinterStore()
  const [selectedGroup, setSelectedGroup] = useState<string | null>('info')
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Check if we have actual data loaded (not just Unknown status)
  const hasLoadedData = printerGroups.length > 0 && printerGroups.some(g =>
    g.printers.some(p => p.status !== 'Unknown')
  )

  const loadAllQueues = async () => {
    if (!sshConfig) {
      toast.error('Not connected to SSH')
      return
    }

    setIsRefreshing(true)
    toast.info('Refreshing printer data...')

    // Fetch queue data for each printer (don't await, let it run in background)
    Promise.all(
      PRINTERS.map(async (printer) => {
        try {
          const result = await checkPrinterQueue(sshConfig, printer.queue_name)
          const queueCount = result.success ? (result.data?.length || 0) : 0
          const status = result.success ? 'Online' : 'Error'
          updatePrinterStatus(printer.id, status, queueCount)
        } catch (error) {
          updatePrinterStatus(printer.id, 'Error', 0)
        }
      })
    ).then(() => {
      setIsRefreshing(false)
      toast.success('Queue data refreshed')
    }).catch(() => {
      setIsRefreshing(false)
      toast.error('Failed to refresh some printers')
    })
  }

  // Use Info as a special view showing all groups
  const groups = printerGroups.length > 0 ? printerGroups : []

  const displayGroup = groups.find((g) => g.id === selectedGroup)
  const displayPrinters = selectedGroup === 'info'
    ? groups.flatMap(g => g.printers.filter(p => p.variant === 'main'))
    : displayGroup?.printers || []

  if (!isConnected || !sshConfig) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div className="p-8 max-w-md text-center">
          <h2 className="text-xl font-bold mb-4">Not Connected</h2>
          <p className="text-muted-foreground mb-6">
            Please connect to SSH in Settings to view the print queue
          </p>
          <Button onClick={() => window.location.href = '/settings'}>
            Go to Settings
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border/50 py-4 px-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Printer Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1">Auto-refreshes every 30 seconds</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadAllQueues()}
          disabled={isRefreshing}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh Now
        </Button>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Info Tab */}
          <button
            onClick={() => setSelectedGroup('info')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedGroup === 'info'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <span>Info</span>
          </button>

          {/* Group Tabs */}
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => setSelectedGroup(group.id)}
              className={cn(
                'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
                selectedGroup === group.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <span>{group.name}</span>
              <span
                className={cn(
                  'min-w-[32px] h-7 rounded-md flex items-center justify-center px-2 text-white font-bold text-sm',
                  group.total_queue_count === 0
                    ? 'bg-red-800'
                    : 'bg-red-600'
                )}
              >
                {group.total_queue_count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Printer Cards Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {!hasLoadedData ? (
          <PrinterGridSkeleton count={9} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl">
            {displayPrinters.map((printer, index) => {
            const isOnline = printer.status === 'Online'
            const queueCount = printer.queue_count || 0

            return (
              <AnimatedCard
                key={printer.id}
                delay={index * 0.05}
                className="border-border/50 hover:border-border transition-colors overflow-hidden"
              >
                <div className="p-6 flex items-center justify-between">
                  {/* Printer Name */}
                  <h2 className="text-2xl font-bold">
                    {printer.name}
                  </h2>

                  {/* Queue Count Badge */}
                  <div
                    className={cn(
                      'min-w-[48px] h-10 rounded-md flex items-center justify-center px-3 text-white font-bold text-lg shadow-md',
                      isOnline && queueCount === 0
                        ? 'bg-green-600 dark:bg-green-700'
                        : !isOnline
                        ? 'bg-red-600 dark:bg-red-700'
                        : 'bg-yellow-500 dark:bg-yellow-600'
                    )}
                  >
                    {queueCount}
                  </div>
                </div>

                {/* Additional Info */}
                <div className="px-6 pb-4 pt-2 border-t border-border/50">
                  <div className="text-sm text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Status:</span>
                      <span className={cn(
                        'font-medium',
                        isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      )}>
                        {printer.status}
                      </span>
                    </div>
                    {printer.variant && (
                      <div className="flex items-center justify-between mt-1">
                        <span>Variant:</span>
                        <span className="font-medium text-foreground uppercase">
                          {printer.variant}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </AnimatedCard>
            )
          })}
          </div>
        )}

        {hasLoadedData && displayPrinters.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg">No printers available</p>
          </div>
        )}
      </div>
    </div>
  )
}
