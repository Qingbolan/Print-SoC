import { useEffect } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { getPrinters } from '@/lib/printer-api'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'
import { StatGroup, StatItem } from '@/components/ui/stat-item'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { MapPin, Printer as PrinterIcon, CheckCircle, AlertCircle } from 'lucide-react'
import type { PrinterStatus } from '@/types/printer'

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

export default function PrintersPage() {
  const { printers, setPrinters, setSelectedPrinter } = usePrinterStore()

  useEffect(() => {
    loadPrinters()
  }, [])

  const loadPrinters = async () => {
    const result = await getPrinters()
    if (result.success && result.data) {
      setPrinters(result.data)
    }
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <PageHeader
        title="Available Printers"
        description="Browse and select from SoC printers across campus"
        icon={<PrinterIcon className="w-8 h-8" />}
      />

      {/* Stats - Simplified */}
      <StatGroup>
        <StatItem
          icon={CheckCircle}
          value={printers.filter((p) => p.status === 'Online').length}
          label="Online"
        />
        <div className="w-px h-8 bg-border/50" />
        <StatItem
          icon={PrinterIcon}
          value={printers.length}
          label="Total Printers"
        />
      </StatGroup>

      {/* Printers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {printers.map((printer) => (
          <SimpleCard key={printer.id} variant="default" hoverable>
            <SimpleCardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <PrinterIcon className="w-5 h-5" />
                    {printer.name}
                  </SimpleCardTitle>
                  <SimpleCardDescription className="mt-1">
                    Queue: {printer.queue_name}
                  </SimpleCardDescription>
                </div>
                <Badge
                  variant="secondary"
                  className={`${statusConfig[printer.status].color} text-white`}
                >
                  {statusConfig[printer.status].icon}
                  <span className="ml-1">{statusConfig[printer.status].label}</span>
                </Badge>
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

              {/* Features */}
              <div className="flex flex-wrap gap-2">
                {printer.supports_duplex && (
                  <Badge variant="outline">Duplex</Badge>
                )}
                {printer.supports_color && (
                  <Badge variant="outline">Color</Badge>
                )}
              </div>

              {/* Actions */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setSelectedPrinter(printer)}
              >
                Set as Default
              </Button>
            </SimpleCardContent>
          </SimpleCard>
        ))}
      </div>
    </div>
  )
}
