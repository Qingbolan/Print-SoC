import { usePrinterStore } from '@/store/printer-store'
import { BUILDINGS, FLOORS_BY_BUILDING, getAllFloors } from '@/data/printers'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { MapPin, X, Navigation } from 'lucide-react'

export function PrinterFilter() {
  const {
    printerFilter,
    setPrinterFilter,
    clearPrinterFilter,
    userLocation,
    setUserLocation,
  } = usePrinterStore()

  // Get available floors based on selected building
  const availableFloors = printerFilter.building
    ? FLOORS_BY_BUILDING[printerFilter.building] || []
    : getAllFloors()

  const hasActiveFilters = printerFilter.building || printerFilter.floor || printerFilter.sortBy !== 'default'

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Building Filter */}
      <Select
        value={printerFilter.building || 'all'}
        onValueChange={(value) => {
          const building = value === 'all' ? null : value
          setPrinterFilter({
            building,
            // Reset floor if it's not available in the new building
            floor: building && printerFilter.floor && !FLOORS_BY_BUILDING[building]?.includes(printerFilter.floor)
              ? null
              : printerFilter.floor,
          })
        }}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Building" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Buildings</SelectItem>
          {BUILDINGS.map((building) => (
            <SelectItem key={building} value={building}>
              {building}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Floor Filter */}
      <Select
        value={printerFilter.floor || 'all'}
        onValueChange={(value) => setPrinterFilter({ floor: value === 'all' ? null : value })}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Floor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Floors</SelectItem>
          {availableFloors.map((floor) => (
            <SelectItem key={floor} value={floor}>
              Floor {floor}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sort Filter */}
      <Select
        value={printerFilter.sortBy}
        onValueChange={(value) => setPrinterFilter({ sortBy: value as 'default' | 'distance' | 'queue' })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectItem value="distance" disabled={!userLocation}>
            Distance {!userLocation && '(set location)'}
          </SelectItem>
          <SelectItem value="queue">Queue (shortest)</SelectItem>
        </SelectContent>
      </Select>

      {/* User Location Setting */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={userLocation ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
          >
            <Navigation className="w-4 h-4" />
            {userLocation ? `${userLocation.building} F${userLocation.floor}` : 'Set Location'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">Your Location</span>
            </div>

            <div className="space-y-3">
              <Select
                value={userLocation?.building || ''}
                onValueChange={(value) => {
                  if (!value) {
                    setUserLocation(null)
                  } else {
                    setUserLocation({
                      building: value,
                      floor: userLocation?.floor || '1',
                    })
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select building" />
                </SelectTrigger>
                <SelectContent>
                  {BUILDINGS.map((building) => (
                    <SelectItem key={building} value={building}>
                      {building}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={userLocation?.floor || ''}
                onValueChange={(value) => {
                  if (userLocation) {
                    setUserLocation({
                      ...userLocation,
                      floor: value,
                    })
                  }
                }}
                disabled={!userLocation?.building}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select floor" />
                </SelectTrigger>
                <SelectContent>
                  {(userLocation?.building ? FLOORS_BY_BUILDING[userLocation.building] : getAllFloors()).map((floor) => (
                    <SelectItem key={floor} value={floor}>
                      Floor {floor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {userLocation && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setUserLocation(null)}
                >
                  Clear Location
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearPrinterFilter}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
