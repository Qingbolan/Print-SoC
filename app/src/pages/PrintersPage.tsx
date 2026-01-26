import { useState, useMemo } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { refreshPrinters } from '@/hooks/useBackgroundMonitor'
import { getPrintersForServerType, groupPrinters } from '@/data/printers'
import { calculateDistance, formatDistance, sortByDistance, sortByQueueCount } from '@/lib/distance'
import type { Printer, PrinterStatus } from '@/types/printer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { RefreshCw, MapPin, Printer as PrinterIcon, CheckCircle, AlertCircle, Navigation, List, Map } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGroup, StatItem } from '@/components/ui/stat-item'
import { PrinterFilter } from '@/components/printer/PrinterFilter'
import { PrinterDetailDialog } from '@/components/printer/PrinterDetailDialog'
import { PrinterMap } from '@/components/printer/PrinterMap'

const statusConfig: Record<
  PrinterStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  Online: {
    color: 'bg-success',
    label: 'Online',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  Offline: {
    color: 'bg-muted-foreground',
    label: 'Offline',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Busy: {
    color: 'bg-warning text-warning-foreground',
    label: 'Busy',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  OutOfPaper: {
    color: 'bg-destructive',
    label: 'Out of Paper',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Error: {
    color: 'bg-destructive',
    label: 'Error',
    icon: <AlertCircle className="w-4 h-4" />,
  },
}

export default function PrintQueuePage() {
  const { sshConfig, isConnected, isRefreshing, savedCredentials, printerFilter, userLocation } = usePrinterStore()
  const [selectedGroup, setSelectedGroup] = useState<string | null>('info')
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')

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
    if (!sshConfig) {
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
      ? groups.flatMap(g => g.printers.filter(p => p.variant === 'main'))
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
      {/* Header Section */}
      <div className="p-8 space-y-8 border-b border-border/50">
        {/* Header with Refresh Button */}
        <div className="flex items-start justify-between">
          <PageHeader
            title="Available Printers"
            description="Browse and select from SoC printers across campus"
            icon={<PrinterIcon className="w-8 h-8" />}
          />
          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center rounded-lg border border-border p-1">
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="gap-2 h-8"
              >
                <List className="w-4 h-4" />
                List
              </Button>
              <Button
                variant={viewMode === 'map' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('map')}
                className="gap-2 h-8"
              >
                <Map className="w-4 h-4" />
                Map
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatGroup>
          <StatItem
            icon={CheckCircle}
            value={filteredPrinters.filter((p) => p.status === 'Online').length}
            label="Online"
          />
          <div className="w-px h-8 bg-border/50" />
          <StatItem
            icon={PrinterIcon}
            value={filteredPrinters.length}
            label="Total Printers"
          />
        </StatGroup>

        {/* Filter Bar */}
        <PrinterFilter />
      </div>

      {/* Content Area */}
      {viewMode === 'map' ? (
        /* Map View */
        <div className="flex-1 p-4">
          <PrinterMap
            printers={filteredPrinters}
            onPrinterClick={handlePrinterClick}
            selectedPrinterId={selectedPrinter?.id}
            className="rounded-lg border border-border shadow-sm"
          />
        </div>
      ) : (
        /* List View */
        <>
          {/* Navigation Tabs */}
          <div className="border-b border-border/50 px-4 py-3 overflow-x-auto">
            <div className="flex items-center gap-3 min-w-max">
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
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                    style={{ backgroundColor: '#EF7C00' }}
                  >
                    {group.total_queue_count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Printer Cards Grid */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl">
              {displayPrinters.map((printer) => {
                const queueCount = printer.queue_count || 0
                const distance = calculateDistance(userLocation, printer)

                return (
                  <SimpleCard
                    key={printer.id}
                    variant="default"
                    hoverable
                    className="cursor-pointer"
                    onClick={() => handlePrinterClick(printer)}
                  >
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
                                ? 'bg-success'
                                : printer.status !== 'Online'
                                ? 'bg-destructive'
                                : 'bg-warning text-warning-foreground'
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
                            {printer.location.room} - Floor {printer.location.floor}
                          </div>
                        </div>
                      </div>

                      {/* Distance (if user location is set) */}
                      {distance !== null && (
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <Navigation className="w-4 h-4" />
                          <span>{formatDistance(distance)} away</span>
                        </div>
                      )}

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
                    </SimpleCardContent>
                  </SimpleCard>
                )
              })}
            </div>

            {displayPrinters.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg">No printers match your filters</p>
                <p className="text-sm mt-2">Try adjusting your filter criteria</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Printer Detail Dialog */}
      <PrinterDetailDialog
        printer={selectedPrinter}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  )
}
