import { useEffect, useState } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { checkPrinterQueue, getPrinters } from '@/lib/printer-api'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  ListOrdered,
  RefreshCw,
  AlertCircle,
  Clock,
  Printer as PrinterIcon,
  CheckCircle
} from 'lucide-react'

interface QueueData {
  printerName: string
  queueName: string
  items: string[]
  loading: boolean
  error?: string
}

export default function PrintQueuePage() {
  const { printers, setPrinters, sshConfig, isConnected } = usePrinterStore()
  const [queueData, setQueueData] = useState<QueueData[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Load printers on mount
  useEffect(() => {
    loadPrinters()
  }, [])

  useEffect(() => {
    if (isConnected && sshConfig && printers.length > 0) {
      loadAllQueues()
    }
  }, [isConnected, sshConfig, printers])

  const loadPrinters = async () => {
    const result = await getPrinters()
    if (result.success && result.data) {
      setPrinters(result.data)
    }
  }

  useEffect(() => {
    if (!autoRefresh || !isConnected || !sshConfig) return

    const interval = setInterval(() => {
      loadAllQueues(true)
    }, 30000) // Refresh every 30 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, isConnected, sshConfig, printers])

  const loadAllQueues = async (silent = false) => {
    if (!sshConfig) {
      toast.error('Not connected to SSH')
      return
    }

    if (!silent) {
      setIsRefreshing(true)
    }

    // Initialize queue data with loading state
    const initialData: QueueData[] = printers.map(printer => ({
      printerName: printer.name,
      queueName: printer.queue_name,
      items: [],
      loading: true,
    }))
    setQueueData(initialData)

    // Fetch queue data for each printer
    const results = await Promise.all(
      printers.map(async (printer) => {
        try {
          const result = await checkPrinterQueue(sshConfig, printer.queue_name)
          return {
            printerName: printer.name,
            queueName: printer.queue_name,
            items: result.success ? (result.data || []) : [],
            loading: false,
            error: result.success ? undefined : result.error,
          }
        } catch (error) {
          return {
            printerName: printer.name,
            queueName: printer.queue_name,
            items: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      })
    )

    setQueueData(results)
    setLastUpdate(new Date())
    setIsRefreshing(false)

    if (!silent) {
      toast.success('Queue data refreshed')
    }
  }

  const totalJobs = queueData.reduce((sum, q) => sum + q.items.length, 0)
  const activeQueues = queueData.filter(q => q.items.length > 0).length

  if (!isConnected || !sshConfig) {
    return (
      <div className="p-8 space-y-8">
        <PageHeader
          title="Print Queue"
          description="Monitor real-time print queue status"
          icon={<ListOrdered className="w-8 h-8" />}
        />
        <SimpleCard variant="bordered" padding="lg">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Not Connected</h3>
            <p className="text-muted-foreground mb-6">
              Please connect to SSH in Settings to view the print queue
            </p>
            <Button onClick={() => window.location.href = '/settings'}>
              Go to Settings
            </Button>
          </div>
        </SimpleCard>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <PageHeader
        title="Print Queue"
        description="Monitor real-time print queue status across all printers"
        icon={<ListOrdered className="w-8 h-8" />}
      />

      {/* Controls and Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <PrinterIcon className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm">
              <span className="font-semibold">{activeQueues}</span>
              <span className="text-muted-foreground"> / {printers.length} active</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm">
              <span className="font-semibold">{totalJobs}</span>
              <span className="text-muted-foreground"> jobs in queue</span>
            </span>
          </div>
          {lastUpdate && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-4 h-4" />
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span>Auto-refresh (30s)</span>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAllQueues()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Queue Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {queueData.map((queue) => (
          <SimpleCard key={queue.queueName} variant="default" hoverable>
            <SimpleCardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <SimpleCardTitle className="flex items-center gap-2">
                    <PrinterIcon className="w-5 h-5" />
                    {queue.printerName}
                  </SimpleCardTitle>
                  <SimpleCardDescription className="mt-1">
                    Queue: {queue.queueName}
                  </SimpleCardDescription>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    queue.loading
                      ? 'bg-blue-500 text-white'
                      : queue.error
                      ? 'bg-red-500 text-white'
                      : queue.items.length > 0
                      ? 'bg-yellow-500 text-white'
                      : 'bg-green-500 text-white'
                  }
                >
                  {queue.loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span className="ml-1">Loading...</span>
                    </>
                  ) : queue.error ? (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span className="ml-1">Error</span>
                    </>
                  ) : queue.items.length > 0 ? (
                    <>
                      <Clock className="w-4 h-4" />
                      <span className="ml-1">{queue.items.length} job(s)</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span className="ml-1">Empty</span>
                    </>
                  )}
                </Badge>
              </div>
            </SimpleCardHeader>
            <SimpleCardContent>
              {queue.loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : queue.error ? (
                <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-600 dark:text-red-400">{queue.error}</div>
                </div>
              ) : queue.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mb-2" />
                  <p className="text-sm text-muted-foreground">Queue is empty</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium mb-3">
                    Jobs in Queue ({queue.items.length})
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {queue.items.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border/50"
                      >
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-primary">{index + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono break-all">{item}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SimpleCardContent>
          </SimpleCard>
        ))}
      </div>

      {printers.length === 0 && (
        <SimpleCard variant="bordered" padding="lg">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <PrinterIcon className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Printers Available</h3>
            <p className="text-muted-foreground mb-6">
              No printers found. Please add printers to view their queues.
            </p>
          </div>
        </SimpleCard>
      )}
    </div>
  )
}
