import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Printer } from '@/types/printer'
import { BUILDING_GPS_COORDINATES, NUS_SOC_CENTER } from '@/data/printers'
import { useGeolocation, calculateGpsDistance, formatGpsDistance, type GeolocationPosition } from '@/hooks/useGeolocation'

// Validate GPS position - returns null if invalid
function getValidPosition(position: GeolocationPosition | null): GeolocationPosition | null {
  if (!position) return null
  // Check for null island (0, 0) or invalid coordinates
  if (position.lat === 0 && position.lng === 0) return null
  if (position.lat < -90 || position.lat > 90) return null
  if (position.lng < -180 || position.lng > 180) return null
  return position
}
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Locate, Navigation, Printer as PrinterIcon, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

// Fix Leaflet default marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Custom marker icons
const createPrinterIcon = (status: 'Online' | 'Offline' | 'Busy' | string, queueCount: number) => {
  const color = status === 'Online' && queueCount === 0 ? '#22c55e' :
                status === 'Online' ? '#f59e0b' :
                '#ef4444'

  return L.divIcon({
    className: 'custom-printer-marker',
    html: `
      <div style="
        background: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        color: white;
        font-weight: bold;
        font-size: 12px;
      ">
        ${queueCount}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  })
}

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: `
    <div style="
      width: 20px;
      height: 20px;
      background: #3b82f6;
      border-radius: 50%;
      border: 4px solid white;
      box-shadow: 0 0 0 2px #3b82f6, 0 2px 8px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

// Component to recenter map
function RecenterButton({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap()

  const handleRecenter = () => {
    if (position) {
      map.flyTo([position.lat, position.lng], 17, { duration: 1 })
    } else {
      map.flyTo([NUS_SOC_CENTER.lat, NUS_SOC_CENTER.lng], 16, { duration: 1 })
    }
  }

  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: '10px', marginRight: '10px' }}>
      <div className="leaflet-control">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-md gap-2"
          onClick={handleRecenter}
        >
          <Locate className="w-4 h-4" />
          {position ? 'My Location' : 'Campus Center'}
        </Button>
      </div>
    </div>
  )
}

interface PrinterMapProps {
  printers: Printer[]
  onPrinterClick?: (printer: Printer) => void
  selectedPrinterId?: string | null  // Reserved for future use (highlight selected printer)
  className?: string
}

export function PrinterMap({
  printers,
  onPrinterClick,
  selectedPrinterId: _selectedPrinterId,
  className,
}: PrinterMapProps) {
  const { position: rawPosition, loading, error, requestPosition, isSupported, permissionDenied } = useGeolocation()

  // Validate position to filter out (0, 0) and invalid coordinates
  const position = getValidPosition(rawPosition)

  // Group printers by building for map markers
  const printersByBuilding = useMemo(() => {
    const grouped: Record<string, Printer[]> = {}
    printers.forEach(printer => {
      const building = printer.location.building
      if (!grouped[building]) grouped[building] = []
      grouped[building].push(printer)
    })
    return grouped
  }, [printers])

  // Calculate distances from user to each building
  const buildingDistances = useMemo(() => {
    if (!position) return {}

    const distances: Record<string, number> = {}
    Object.entries(BUILDING_GPS_COORDINATES).forEach(([building, coords]) => {
      distances[building] = calculateGpsDistance(
        position.lat,
        position.lng,
        coords.lat,
        coords.lng
      )
    })
    return distances
  }, [position])

  // Request location on mount
  useEffect(() => {
    if (isSupported && !position && !loading && !permissionDenied) {
      requestPosition()
    }
  }, [isSupported, position, loading, permissionDenied, requestPosition])

  return (
    <div className={cn('relative w-full h-full min-h-[400px]', className)}>
      {/* Location status bar */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2">
        {loading && (
          <Badge variant="secondary" className="gap-2 bg-background/90 backdrop-blur">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Getting location...
          </Badge>
        )}
        {position && !loading && (
          <Badge variant="secondary" className="gap-2 bg-background/90 backdrop-blur text-primary">
            <Navigation className="w-3 h-3" />
            GPS Active
          </Badge>
        )}
        {permissionDenied && (
          <Badge variant="destructive" className="gap-2">
            <MapPin className="w-3 h-3" />
            Location denied
          </Badge>
        )}
        {error && !permissionDenied && (
          <Button size="sm" variant="outline" onClick={requestPosition} className="gap-2 bg-background/90">
            <Locate className="w-4 h-4" />
            Enable GPS
          </Button>
        )}
      </div>

      <MapContainer
        center={[NUS_SOC_CENTER.lat, NUS_SOC_CENTER.lng]}
        zoom={16}
        className="w-full h-full rounded-lg"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* User location marker */}
        {position && (
          <>
            {/* Accuracy circle */}
            <Circle
              center={[position.lat, position.lng]}
              radius={position.accuracy}
              pathOptions={{
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                weight: 1,
              }}
            />
            {/* User marker */}
            <Marker
              position={[position.lat, position.lng]}
              icon={userLocationIcon}
            >
              <Popup>
                <div className="text-center">
                  <strong>Your Location</strong>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    Accuracy: ~{Math.round(position.accuracy)}m
                  </span>
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {/* Printer markers by building */}
        {Object.entries(printersByBuilding).map(([building, buildingPrinters]) => {
          const coords = BUILDING_GPS_COORDINATES[building]
          if (!coords) return null

          // Get main printer for the marker
          const mainPrinter = buildingPrinters.find(p => p.variant === 'main') || buildingPrinters[0]
          const onlineCount = buildingPrinters.filter(p => p.status === 'Online').length
          const totalQueueCount = buildingPrinters.reduce((sum, p) => sum + (p.queue_count || 0), 0)
          const distance = buildingDistances[building]

          return (
            <Marker
              key={building}
              position={[coords.lat, coords.lng]}
              icon={createPrinterIcon(
                onlineCount > 0 ? 'Online' : 'Offline',
                totalQueueCount
              )}
              eventHandlers={{
                click: () => {
                  if (onPrinterClick && mainPrinter) {
                    onPrinterClick(mainPrinter)
                  }
                },
              }}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <div className="font-bold text-base mb-1">{building}</div>
                  <div className="text-sm text-muted-foreground mb-2">{coords.name}</div>

                  {distance !== undefined && (
                    <div className="flex items-center gap-1 text-sm text-primary mb-2">
                      <Navigation className="w-3 h-3" />
                      {formatGpsDistance(distance)} away
                    </div>
                  )}

                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Printers:</span>
                      <span className="font-medium">{buildingPrinters.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Online:</span>
                      <span className="font-medium text-success">{onlineCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Queue:</span>
                      <span className={cn(
                        'font-medium',
                        totalQueueCount === 0 ? 'text-success' : 'text-warning'
                      )}>
                        {totalQueueCount}
                      </span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full mt-3 gap-2"
                    onClick={() => {
                      if (onPrinterClick && mainPrinter) {
                        onPrinterClick(mainPrinter)
                      }
                    }}
                  >
                    <PrinterIcon className="w-3 h-3" />
                    View Printers
                  </Button>
                </div>
              </Popup>
            </Marker>
          )
        })}

        <RecenterButton position={position} />
      </MapContainer>

      {/* Map Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-background/90 backdrop-blur rounded-lg p-3 shadow-md">
        <div className="text-xs font-medium mb-2">Legend</div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-success border-2 border-white shadow-sm" />
            <span>Available (no queue)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-warning border-2 border-white shadow-sm" />
            <span>Busy (has queue)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-destructive border-2 border-white shadow-sm" />
            <span>Offline</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-primary border-2 border-white shadow-sm" />
            <span>Your location</span>
          </div>
        </div>
      </div>
    </div>
  )
}
