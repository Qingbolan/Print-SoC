import { BUILDING_COORDINATES } from '@/data/printers'
import type { Printer, UserLocation } from '@/types/printer'

// Constants for distance estimation
const FLOOR_HEIGHT = 15 // meters per floor
const SAME_BUILDING_SAME_FLOOR_BASE = 20 // base walking distance on same floor
const SAME_BUILDING_DIFFERENT_FLOOR_BASE = 30 // base distance when changing floors

/**
 * Parse floor string to numeric value for comparison
 * B1 = -1, 1 = 1, 2 = 2, etc.
 */
function parseFloor(floor: string): number {
  if (floor === 'B1') return -1
  return parseInt(floor, 10) || 0
}

/**
 * Calculate estimated walking distance from user location to a printer
 * Returns distance in meters, or null if calculation isn't possible
 */
export function calculateDistance(
  userLocation: UserLocation | null,
  printer: Printer
): number | null {
  if (!userLocation) return null

  const userBuilding = userLocation.building
  const printerBuilding = printer.location.building

  // Get building coordinates
  const userCoords = BUILDING_COORDINATES[userBuilding]
  const printerCoords = BUILDING_COORDINATES[printerBuilding]

  if (!userCoords || !printerCoords) return null

  const userFloor = parseFloor(userLocation.floor)
  const printerFloor = parseFloor(printer.location.floor)
  const floorDifference = Math.abs(userFloor - printerFloor)

  if (userBuilding === printerBuilding) {
    // Same building
    if (floorDifference === 0) {
      // Same floor - base walking distance
      return SAME_BUILDING_SAME_FLOOR_BASE
    } else {
      // Different floor - add vertical distance
      return SAME_BUILDING_DIFFERENT_FLOOR_BASE + floorDifference * FLOOR_HEIGHT
    }
  } else {
    // Different buildings - calculate horizontal distance between buildings
    const dx = printerCoords.x - userCoords.x
    const dy = printerCoords.y - userCoords.y
    const buildingDistance = Math.sqrt(dx * dx + dy * dy)

    // Add floor differences (need to go down and up)
    const verticalDistance = floorDifference * FLOOR_HEIGHT

    return Math.round(buildingDistance + verticalDistance + SAME_BUILDING_SAME_FLOOR_BASE)
  }
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number | null): string {
  if (meters === null) return ''

  if (meters < 1000) {
    return `${Math.round(meters)}m`
  }
  return `${(meters / 1000).toFixed(1)}km`
}

/**
 * Sort printers by distance from user location
 */
export function sortByDistance(
  printers: Printer[],
  userLocation: UserLocation | null
): Printer[] {
  if (!userLocation) return printers

  return [...printers].sort((a, b) => {
    const distA = calculateDistance(userLocation, a)
    const distB = calculateDistance(userLocation, b)

    // Printers with unknown distance go to the end
    if (distA === null && distB === null) return 0
    if (distA === null) return 1
    if (distB === null) return -1

    return distA - distB
  })
}

/**
 * Sort printers by queue count (shortest first)
 */
export function sortByQueueCount(printers: Printer[]): Printer[] {
  return [...printers].sort((a, b) => {
    const queueA = a.queue_count ?? 0
    const queueB = b.queue_count ?? 0
    return queueA - queueB
  })
}
