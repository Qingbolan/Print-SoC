import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { refreshPrinters } from '@/hooks/useBackgroundMonitor'
import { getPrintersForServerType, groupPrinters } from '@/data/printers'
import { calculateDistance, formatDistance, sortByDistance, sortByQueueCount } from '@/lib/distance'
import type { Printer, PrinterStatus } from '@/types/printer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { RefreshCw, MapPin, Printer as PrinterIcon, CheckCircle, AlertCircle, Navigation, List, Map, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PrinterFilter } from '@/components/printer/PrinterFilter'
import { PrinterDetailSheet } from '@/components/printer/PrinterDetailSheet'
import { PrinterMap } from '@/components/printer/PrinterMap'

const statusConfig: Record<
  PrinterStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  Online: {
    color: 'bg-success/10 text-success',
    label: 'Online',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  Offline: {
    color: 'bg-muted text-muted-foreground border-border/70',
    label: 'Offline',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Busy: {
    color: 'bg-warning/10 text-warning-foreground',
    label: 'Busy',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  OutOfPaper: {
    color: 'bg-destructive/10 text-destructive',
    label: 'Out of Paper',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Error: {
    color: 'bg-destructive/10 text-destructive',
    label: 'Error',
    icon: <AlertCircle className="w-4 h-4" />,
  },
}

export default function PrintQueuePage() {
  const navigate = useNavigate()
  const { sshConfig, connectionStatus, isRefreshing, savedCredentials, printerFilter, userLocation } = usePrinterStore()
  const [selectedGroup, setSelectedGroup] = useState<string | null>('info')
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const isConnected = connectionStatus.type === 'connected'

  // Filter printers based on user account type (stu = student, stf = staff)
  const serverType = savedCredentials?.serverType || (sshConfig?.host?.includes('stf') ? 'stf' : 'stu')
  const basePrinters = useMemo(() => getPrintersForServerType(serverType), [serverType])

  // Apply filters
  const filteredPrinters = useMemo(() => {
    let result = basePrinters

    // Filter by building
    if (printerFilter.building) {
      result = result.filter(p => p.location.building === printerFilter.building)
    }

    // Filter by floor
    if (printerFilter.floor) {
      result = result.filter(p => p.location.floor === printerFilter.floor)
    }

    return result
  }, [basePrinters, printerFilter.building, printerFilter.floor])

  // Group filtered printers
  const printerGroups = useMemo(() => groupPrinters(filteredPrinters), [filteredPrinters])

  const handleRefresh = async () => {
    if (!isConnected || !sshConfig) {
      toast.error('Not connected to SSH')
      return
    }

    toast.info('Refreshing printer data...')
    await refreshPrinters()
    toast.success('Printer data refreshed')
  }

  const handlePrinterClick = (printer: Printer) => {
    setSelectedPrinter(printer)
    setSheetOpen(true)
  }

  // Use Info as a special view showing all groups
  const groups = printerGroups.length > 0 ? printerGroups : []

  const displayGroup = groups.find((g) => g.id === selectedGroup)

  // Get display printers and apply sorting
  const displayPrinters = useMemo(() => {
    let printers = selectedGroup === 'info'
      ? groups.flatMap((group) => {
          const representative =
            group.printers.find((printer) => printer.variant === 'main') ??
            group.printers.find((printer) => printer.variant === 'dx') ??
            group.printers[0]

          return representative ? [representative] : []
        })
      : displayGroup?.printers || []

    // Apply sorting
    if (printerFilter.sortBy === 'distance' && userLocation) {
      printers = sortByDistance(printers, userLocation)
    } else if (printerFilter.sortBy === 'queue') {
      printers = sortByQueueCount(printers)
    }

    return printers
  }, [selectedGroup, groups, displayGroup, printerFilter.sortBy, userLocation])

  if (!isConnected || !sshConfig) {
    return (
      <PageScaffold
        header={
          <PageHeader
            title="Printer directory"
            description="Live queues across the School of Computing"
            icon={<PrinterIcon />}
          />
        }
        contentWidth="wide"
      >
        <div className="overflow-hidden rounded-md bg-card">
          <div className="p-6 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
              <AlertCircle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
            <h2 className="mb-1 text-lg font-semibold">Connection required</h2>
            <p className="mb-5 text-sm leading-6 text-muted-foreground">
              Add your NUS SoC SSH account in Settings before loading printer availability.
            </p>
            <Button size="sm" onClick={() => navigate('/settings')}>
              Go to Settings
            </Button>
            </div>
          </div>
          </div>
        </div>
      </PageScaffold>
    )
  }

  return (
    <PageScaffold
      header={
        <PageHeader
          title="Printer directory"
          description="Live queues across the School of Computing"
          icon={<PrinterIcon />}
          actions={
            <>
              <SegmentedControl
                ariaLabel="Printer view"
                value={viewMode}
                onValueChange={setViewMode}
                items={[
                  { value: 'list', label: 'List', icon: List },
                  { value: 'map', label: 'Map', icon: Map },
                ]}
              />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            </>
          }
        />
      }
      metrics={
        <div className="flex flex-col gap-4 rounded-md bg-card px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{filteredPrinters.filter((p) => p.status === 'Online').length}</div>
              <div className="text-xs text-muted-foreground">Online queues</div>
            </div>
            <div className="h-8 w-px bg-border/70" />
            <div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{groups.length}</div>
              <div className="text-xs text-muted-foreground">Locations</div>
            </div>
          </div>
          <PrinterFilter />
        </div>
      }
      navigation={viewMode === 'list' ? (
        <>
          <div className="sm:hidden">
            <Select value={selectedGroup || 'info'} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-full" aria-label="Printer location">
                <SelectValue placeholder="Select printer location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">All Printers</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} ({group.total_queue_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SegmentedControl
            className="hidden sm:inline-flex"
            ariaLabel="Printer location"
            value={selectedGroup || 'info'}
            onValueChange={setSelectedGroup}
            items={[
              { value: 'info', label: 'All Printers' },
              ...groups.map((group) => ({
                value: group.id,
                label: group.name,
                count: group.total_queue_count > 0 ? group.total_queue_count : undefined,
              })),
            ]}
          />
        </>
      ) : undefined}
      contentWidth="wide"
    >
      {viewMode === 'map' ? (
        <div className="aspect-square pb-6 sm:aspect-[16/10]">
          <PrinterMap
            printers={filteredPrinters}
            onPrinterClick={handlePrinterClick}
            selectedPrinterId={selectedPrinter?.id}
            className="rounded-lg"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-card">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.7fr)_auto] items-center gap-4 bg-muted/70 px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground md:grid">
              <span>Printer / queue</span>
              <span>Location</span>
              <span>Capabilities</span>
              <span>Queue</span>
              <span className="sr-only">Open</span>
            </div>
            <div className="divide-y divide-border/60">
              {displayPrinters.map((printer) => {
                const queueCount = printer.queue_count || 0
                const distance = calculateDistance(userLocation, printer)
                const queueTone =
                  printer.status === 'Online' && queueCount === 0
                    ? 'bg-success/10 text-success'
                    : printer.status !== 'Online'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/10 text-warning-foreground'

                return (
                  <button
                    key={printer.id}
                    type="button"
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 text-left transition-colors hover:bg-accent/55 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.7fr)_auto] md:px-5"
                    onClick={() => handlePrinterClick(printer)}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                        <PrinterIcon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{printer.name}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs text-muted-foreground">{printer.queue_name}</span>
                          <Badge
                            variant="outline"
                            className={cn('px-1.5 py-0 text-xs', statusConfig[printer.status].color)}
                          >
                            {statusConfig[printer.status].label}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 text-sm max-md:col-span-2 max-md:pl-11">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{printer.location.building} · Floor {printer.location.floor}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{printer.location.room}</div>
                        </div>
                      </div>
                      {distance !== null && (
                        <div className="mt-1 flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
                          <Navigation className="size-3" />
                          <span>{formatDistance(distance)}</span>
                        </div>
                      )}
                    </div>

                    <div className="hidden flex-wrap gap-1.5 md:flex">
                      <span className="text-xs font-medium text-foreground">{printer.supports_color ? 'Colour' : 'Mono'}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{printer.supports_duplex ? 'Duplex' : 'Simplex'}</span>
                    </div>

                    <div className={cn('justify-self-end rounded-md px-2.5 py-1.5 text-center', queueTone)}>
                      <div className="text-base font-semibold leading-none tabular-nums">{queueCount}</div>
                      <div className="mt-1 text-xs font-semibold uppercase leading-none opacity-75">waiting</div>
                    </div>
                    <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
                  </button>
                )
              })}
            </div>

            {displayPrinters.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                <p className="text-sm font-medium text-foreground">No printers match your filters</p>
                <p className="text-sm mt-2">Try adjusting your filter criteria</p>
              </div>
            )}
        </div>
      )}

      <PrinterDetailSheet
        printer={selectedPrinter}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </PageScaffold>
  )
}
