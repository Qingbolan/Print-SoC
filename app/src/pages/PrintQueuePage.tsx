import { useEffect, useState, useRef } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { checkPrinterQueue } from '@/lib/printer-api'
import type { PrinterGroup, PrinterStatus } from '@/types/printer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { RefreshCw, MapPin, Printer as PrinterIcon, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PrinterGridSkeleton } from '@/components/PrinterCardSkeleton'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'

const statusConfig: Record<
  PrinterStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  Online: {
    color: 'bg-green-500',
    label: 'Online',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  Offline: {
    color: 'bg-gray-500',
    label: 'Offline',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Busy: {
    color: 'bg-yellow-500',
    label: 'Busy',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  OutOfPaper: {
    color: 'bg-red-500',
    label: 'Out of Paper',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Error: {
    color: 'bg-red-500',
    label: 'Error',
    icon: <AlertCircle className="w-4 h-4" />,
  },
}

export default function PrintQueuePage() {
  const { printerGroups, setPrinters, updatePrinterStatus, sshConfig, isConnected } = usePrinterStore()
  const [selectedGroup, setSelectedGroup] = useState<string | null>('info')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isLoadingRef = useRef(false)
  const hasInitializedRef = useRef(false)

  // Initialize printers on mount
  useEffect(() => {
    setPrinters(PRINTERS)
  }, [setPrinters])

  // Auto-refresh only when on this page and connected
  useEffect(() => {
    if (!isConnected || !sshConfig) {
      hasInitializedRef.current = false
      return
    }

    // Load data once when entering the page
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      setTimeout(() => {
        loadAllQueues(true) // silent = true for initial load
      }, 500)
    }

    // Set up auto-refresh every 30 seconds
    const interval = setInterval(() => {
      if (!isLoadingRef.current) {
        loadAllQueues(true) // silent = true for background refresh
      }
    }, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [isConnected, sshConfig])

  // Check if we have printers loaded
  const hasLoadedData = printerGroups.length > 0

  const loadAllQueues = (silent = false) => {
    if (!sshConfig || isLoadingRef.current) {
      if (!silent) toast.error('Not connected to SSH')
      return
    }

    isLoadingRef.current = true
    setIsRefreshing(true)
    if (!silent) toast.info('Refreshing printer data...')

    // Fire off all requests in parallel, don't wait for them
    // Each printer updates independently as it completes
    const promises = PRINTERS.map(async (printer) => {
      try {
        const result = await checkPrinterQueue(sshConfig, printer.queue_name)
        const queueCount = result.success ? (result.data?.length || 0) : 0
        const status = result.success ? 'Online' : 'Error'
        updatePrinterStatus(printer.id, status, queueCount)
        return { success: true, printer: printer.name }
      } catch (error) {
        updatePrinterStatus(printer.id, 'Error', 0)
        return { success: false, printer: printer.name, error }
      }
    })

    // Handle completion in background, don't block UI
    Promise.allSettled(promises).then((results) => {
      const successCount = results.filter(r => r.status === 'fulfilled').length

      setIsRefreshing(false)
      isLoadingRef.current = false

      if (!silent) {
        if (successCount === PRINTERS.length) {
          toast.success('All printers refreshed')
        } else if (successCount > 0) {
          toast.warning(`Refreshed ${successCount}/${PRINTERS.length} printers`)
        } else {
          toast.error('Failed to refresh printers')
        }
      }
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
          onClick={() => loadAllQueues(false)}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl">
            {displayPrinters.map((printer) => {
            const queueCount = printer.queue_count || 0

            return (
              <SimpleCard key={printer.id} variant="default" hoverable>
                <SimpleCardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <SimpleCardTitle className="flex items-center gap-2">
                        <PrinterIcon className="w-5 h-5" />
                        {printer.name}
                      </SimpleCardTitle>
                      <SimpleCardDescription className="mt-1">
                        Queue: {printer.queue_name}
                      </SimpleCardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge
                        variant="secondary"
                        className={`${statusConfig[printer.status].color} text-white`}
                      >
                        {statusConfig[printer.status].icon}
                        <span className="ml-1">{statusConfig[printer.status].label}</span>
                      </Badge>
                      {/* Queue Count Badge */}
                      <div
                        className={cn(
                          'min-w-[48px] h-9 rounded-md flex items-center justify-center px-3 text-white font-bold text-base shadow-md',
                          printer.status === 'Online' && queueCount === 0
                            ? 'bg-green-600 dark:bg-green-700'
                            : printer.status !== 'Online'
                            ? 'bg-red-600 dark:bg-red-700'
                            : 'bg-yellow-500 dark:bg-yellow-600'
                        )}
                      >
                        {queueCount}
                      </div>
                    </div>
                  </div>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  {/* Location */}
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{printer.location.building}</div>
                      <div className="text-muted-foreground">
                        {printer.location.room} • Floor {printer.location.floor}
                      </div>
                    </div>
                  </div>

                  {/* Features & Variant */}
                  <div className="flex flex-wrap gap-2">
                    {printer.supports_duplex && (
                      <Badge variant="outline">Duplex</Badge>
                    )}
                    {printer.supports_color && (
                      <Badge variant="outline">Color</Badge>
                    )}
                    {printer.variant && (
                      <Badge variant="outline" className="uppercase">
                        {printer.variant}
                      </Badge>
                    )}
                  </div>

                  {/* Paper Level */}
                  {printer.paper_level !== undefined && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Paper Level</span>
                        <span className="font-medium">{printer.paper_level}%</span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            printer.paper_level > 50
                              ? 'bg-green-500'
                              : printer.paper_level > 20
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${printer.paper_level}%` }}
                        />
                      </div>
                    </div>
                  )}
                </SimpleCardContent>
              </SimpleCard>
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
