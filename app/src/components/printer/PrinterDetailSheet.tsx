import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { groupPrinters } from '@/data/printers'
import { calculateDistance, formatDistance } from '@/lib/distance'
import type { Printer, PrinterStatus } from '@/types/printer'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Printer as PrinterIcon,
  MapPin,
  Navigation,
  CheckCircle,
  AlertCircle,
  Star,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface PrinterDetailSheetProps {
  printer: Printer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusConfig: Record<
  PrinterStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  Online: {
    color: 'bg-success text-white',
    label: 'Online',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  Offline: {
    color: 'bg-muted-foreground text-white',
    label: 'Offline',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Busy: {
    color: 'bg-warning text-warning-foreground',
    label: 'Busy',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  OutOfPaper: {
    color: 'bg-destructive text-white',
    label: 'Out of Paper',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  Error: {
    color: 'bg-destructive text-white',
    label: 'Error',
    icon: <AlertCircle className="w-4 h-4" />,
  },
}

export function PrinterDetailSheet({
  printer,
  open,
  onOpenChange,
}: PrinterDetailSheetProps) {
  const navigate = useNavigate()
  const {
    userLocation,
    settings,
    setSettings,
    setQuickPrintPrinter,
    printers,
  } = usePrinterStore()

  if (!printer) return null

  const distance = calculateDistance(userLocation, printer)
  const isDefault = settings.defaultPrinter === printer.queue_name

  // Get all variants of this printer (same group_id)
  const printerGroup = groupPrinters(printers).find(g => g.id === printer.group_id)
  const variants = printerGroup?.printers || [printer]

  const handleSetDefault = () => {
    setSettings({ defaultPrinter: printer.queue_name })
  }

  const handlePrintWithPrinter = () => {
    setQuickPrintPrinter(printer.queue_name)
    onOpenChange(false)
    navigate('/')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent">
              <PrinterIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <SheetTitle className="text-xl">{printer.name}</SheetTitle>
              <SheetDescription className="text-sm">
                {printer.queue_name}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Status & Queue */}
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className={cn(statusConfig[printer.status].color, 'gap-1')}
            >
              {statusConfig[printer.status].icon}
              {statusConfig[printer.status].label}
            </Badge>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Queue:</span>
              <span
                className={cn(
                  'px-3 py-1 rounded-md font-bold text-white',
                  printer.status === 'Online' && (printer.queue_count || 0) === 0
                    ? 'bg-success'
                    : printer.status !== 'Online'
                    ? 'bg-destructive'
                    : 'bg-warning text-warning-foreground'
                )}
              >
                {printer.queue_count || 0}
              </span>
            </div>
          </div>

          <Separator />

          {/* Location */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Location
            </h3>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <div className="font-medium">{printer.location.building}</div>
                <div className="text-sm text-muted-foreground">
                  {printer.location.room}
                </div>
                <div className="text-sm text-muted-foreground">
                  Floor {printer.location.floor}
                </div>
              </div>
            </div>

            {distance !== null && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-accent/50">
                <Navigation className="w-4 h-4 text-primary" />
                <span className="text-sm">
                  Approx. <strong>{formatDistance(distance)}</strong> away
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Features */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Features
            </h3>
            <div className="flex flex-wrap gap-2">
              {printer.supports_duplex && (
                <Badge variant="outline">Duplex</Badge>
              )}
              {printer.supports_color && (
                <Badge variant="outline" className="border-primary text-primary">
                  Color
                </Badge>
              )}
              {printer.supported_paper_sizes.map((size) => (
                <Badge key={size} variant="outline">
                  {size}
                </Badge>
              ))}
              {printer.has_banner && (
                <Badge variant="outline">Banner Page</Badge>
              )}
            </div>
          </div>

          {/* Variants */}
          {variants.length > 1 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Available Queues
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {variants.map((variant) => (
                    <button
                      key={variant.id}
                      className={cn(
                        'p-3 rounded-md border text-left transition-colors',
                        variant.id === printer.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-accent/50'
                      )}
                      onClick={() => {
                        // Could trigger opening this variant in the sheet
                      }}
                    >
                      <div className="font-medium text-sm">{variant.queue_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {variant.variant === 'main' ? 'Standard' : variant.variant}
                        {variant.variant === 'sx' && ' (Simplex)'}
                        {variant.variant === 'nb' && ' (No Banner)'}
                        {variant.variant === 'dx' && ' (Duplex)'}
                      </div>
                      <div className="text-xs mt-1">
                        Queue: {variant.queue_count || 0}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Model Info */}
          {printer.model && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Model
                </h3>
                <p className="text-sm">{printer.model}</p>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 pt-4 border-t">
          <Button
            variant={isDefault ? 'secondary' : 'outline'}
            className="w-full gap-2"
            onClick={handleSetDefault}
            disabled={isDefault}
          >
            <Star className={cn('w-4 h-4', isDefault && 'fill-current')} />
            {isDefault ? 'Default Printer' : 'Set as Default'}
          </Button>

          <Button
            className="w-full gap-2"
            onClick={handlePrintWithPrinter}
            disabled={printer.status !== 'Online'}
          >
            <ExternalLink className="w-4 h-4" />
            Print with this Printer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
