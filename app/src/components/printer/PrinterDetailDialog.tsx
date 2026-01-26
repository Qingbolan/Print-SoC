import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { groupPrinters, BUILDING_GPS_COORDINATES } from '@/data/printers'
import { useGeolocation, calculateGpsDistance, formatGpsDistance, type GeolocationPosition } from '@/hooks/useGeolocation'
import type { Printer, PrinterStatus } from '@/types/printer'

// Validate GPS position - returns null if invalid
function getValidPosition(position: GeolocationPosition | null): GeolocationPosition | null {
  if (!position) return null
  // Check for null island (0, 0) or invalid coordinates
  if (position.lat === 0 && position.lng === 0) return null
  if (position.lat < -90 || position.lat > 90) return null
  if (position.lng < -180 || position.lng > 180) return null
  return position
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
  Locate,
  Map,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface PrinterDetailDialogProps {
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

export function PrinterDetailDialog({
  printer,
  open,
  onOpenChange,
}: PrinterDetailDialogProps) {
  const navigate = useNavigate()
  const [mapLoaded, setMapLoaded] = useState(false)

  const {
    settings,
    setSettings,
    setQuickPrintPrinter,
    printers,
  } = usePrinterStore()

  const { position: rawPosition, loading: gpsLoading, requestPosition, isSupported, permissionState } = useGeolocation()

  // Validate position to filter out (0, 0) and invalid coordinates
  const position = getValidPosition(rawPosition)

  const buildingCoords = printer ? BUILDING_GPS_COORDINATES[printer.location.building] : null
  const distance = position && buildingCoords
    ? calculateGpsDistance(position.lat, position.lng, buildingCoords.lat, buildingCoords.lng)
    : null

  const isDefault = printer ? settings.defaultPrinter === printer.queue_name : false

  // Get all variants of this printer (same group_id)
  const printerGroup = printer ? groupPrinters(printers).find(g => g.id === printer.group_id) : null
  const variants = printerGroup?.printers || (printer ? [printer] : [])

  if (!printer) return null

  const handleSetDefault = () => {
    setSettings({ defaultPrinter: printer.queue_name })
  }

  const handlePrintWithPrinter = () => {
    setQuickPrintPrinter(printer.queue_name)
    onOpenChange(false)
    navigate('/')
  }

  // Generate Google Maps navigation URL
  const getGoogleMapsUrl = () => {
    if (!buildingCoords) return null

    const destination = `${buildingCoords.lat},${buildingCoords.lng}`

    if (position) {
      const origin = `${position.lat},${position.lng}`
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`
    } else {
      return `https://www.google.com/maps/search/?api=1&query=${destination}`
    }
  }

  // Generate OpenStreetMap embed URL
  const getOsmEmbedUrl = () => {
    if (!buildingCoords) return null
    const delta = 0.002
    const bbox = `${buildingCoords.lng - delta},${buildingCoords.lat - delta},${buildingCoords.lng + delta},${buildingCoords.lat + delta}`
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${buildingCoords.lat},${buildingCoords.lng}`
  }

  const mapsUrl = getGoogleMapsUrl()
  const osmEmbedUrl = getOsmEmbedUrl()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!min-w-[700px] !max-w-4xl !w-[85vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent">
              <PrinterIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">{printer.name}</DialogTitle>
              <DialogDescription className="text-sm">
                {printer.queue_name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
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

          {/* Location Info */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
            <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <div className="font-medium">{printer.location.building}</div>
              <div className="text-sm text-muted-foreground">
                {printer.location.room} · Floor {printer.location.floor}
              </div>
            </div>
            {distance !== null && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary">
                <Navigation className="w-4 h-4" />
                <span className="text-sm font-medium">{formatGpsDistance(distance)}</span>
              </div>
            )}
          </div>

          {/* Map Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Navigation
              </h3>
              <div className="flex items-center gap-2">
                {!position && isSupported && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={requestPosition}
                    disabled={gpsLoading}
                    className="gap-2"
                  >
                    <Locate className={cn("w-4 h-4", gpsLoading && "animate-pulse")} />
                    {gpsLoading ? 'Getting location...' :
                     permissionState === 'denied' ? 'Location denied' : 'Enable GPS'}
                  </Button>
                )}
                {position && (
                  <Badge variant="secondary" className="gap-2 bg-success/20 text-success">
                    <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    GPS Active
                  </Badge>
                )}
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="default" className="gap-2">
                      <Navigation className="w-4 h-4" />
                      Open Google Maps
                    </Button>
                  </a>
                )}
              </div>
            </div>

            {/* Location cards */}
            {position && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                  <div className="flex items-center gap-2 text-primary mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">Your Location</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-success/30 bg-success/5">
                  <div className="flex items-center gap-2 text-success mb-1">
                    <PrinterIcon className="w-4 h-4" />
                    <span className="text-sm font-medium">Printer Location</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {buildingCoords?.lat.toFixed(4)}, {buildingCoords?.lng.toFixed(4)}
                  </div>
                </div>
              </div>
            )}

            {/* OpenStreetMap Embed */}
            {buildingCoords && osmEmbedUrl && (
              <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
                {/* Loading overlay */}
                {!mapLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
                    <div className="flex flex-col items-center gap-3">
                      <Map className="w-10 h-10 text-muted-foreground animate-pulse" />
                      <span className="text-sm text-muted-foreground">Loading map...</span>
                    </div>
                  </div>
                )}

                {/* OSM iframe */}
                <iframe
                  src={osmEmbedUrl}
                  width="100%"
                  height="280"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  onLoad={() => setMapLoaded(true)}
                  title={`Map showing ${printer.name} location`}
                  className="w-full"
                />

                {/* Distance badge */}
                {position && distance !== null && (
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-background/95 backdrop-blur rounded-full px-3 py-1.5 shadow-md z-20 border">
                    <Navigation className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">{formatGpsDistance(distance)} away</span>
                  </div>
                )}

                {/* View larger link */}
                <div className="absolute bottom-3 right-3 z-20">
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${buildingCoords.lat}&mlon=${buildingCoords.lng}#map=18/${buildingCoords.lat}/${buildingCoords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="secondary" className="gap-2 bg-background/90 backdrop-blur">
                      <ExternalLink className="w-3 h-3" />
                      View larger
                    </Button>
                  </a>
                </div>
              </div>
            )}

            {/* Hint text */}
            <p className="text-xs text-muted-foreground text-center">
              📍 Blue marker shows printer location • Click "Open Google Maps" for walking directions
            </p>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {variants.map((variant) => (
                    <button
                      key={variant.id}
                      className={cn(
                        'p-3 rounded-md border text-left transition-colors',
                        variant.id === printer.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-accent/50'
                      )}
                    >
                      <div className="font-medium text-sm">{variant.queue_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {variant.variant === 'main' ? 'Standard' : variant.variant}
                        {variant.variant === 'sx' && ' (Simplex)'}
                        {variant.variant === 'nb' && ' (No Banner)'}
                        {variant.variant === 'dx' && ' (Duplex)'}
                      </div>
                      <div className="text-xs mt-1">Queue: {variant.queue_count || 0}</div>
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

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant={isDefault ? 'secondary' : 'outline'}
              className="flex-1 gap-2"
              onClick={handleSetDefault}
              disabled={isDefault}
            >
              <Star className={cn('w-4 h-4', isDefault && 'fill-current')} />
              {isDefault ? 'Default Printer' : 'Set as Default'}
            </Button>

            <Button
              className="flex-1 gap-2"
              onClick={handlePrintWithPrinter}
              disabled={printer.status !== 'Online'}
            >
              <ExternalLink className="w-4 h-4" />
              Print with this Printer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
