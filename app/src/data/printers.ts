import catalogue from '../../shared/printers.json'
import queueAliases from '../../shared/printer-aliases.json'
import type { Printer, PrinterGroup } from '@/types/printer'

export const DEFAULT_PRINTER_QUEUE = 'psts-dx'

// Public queues copied from socprint-web/SOCprint's documented common queues:
// COM1 basement: psc008, psc011; COM1 L1 tech services: psts, pstb, pstc.
// Queue suffixes are explicit: -dx = double-sided, -sx = single-sided.
export const SOCPRINT_PUBLIC_BASE_QUEUES = ['psc008', 'psc011', 'psts', 'pstb', 'pstc'] as const
export const SOCPRINT_PUBLIC_QUEUE_NAMES = SOCPRINT_PUBLIC_BASE_QUEUES.flatMap((queue) => [
  `${queue}-dx`,
  `${queue}-sx`,
])

// Building coordinates for distance calculation (relative positions in meters)
// Based on NUS SoC campus layout
export const BUILDING_COORDINATES: Record<string, { x: number; y: number }> = {
  'COM1': { x: 0, y: 0 },
  'COM2': { x: 80, y: 0 },
  'COM3': { x: 80, y: 80 },
  'COM4': { x: 0, y: 80 },
  'AS6': { x: -60, y: 40 },
}

// Real GPS coordinates for NUS SoC buildings (latitude, longitude)
// Verified from Google Maps - NUS Computing Complex
export const BUILDING_GPS_COORDINATES: Record<string, { lat: number; lng: number; name: string }> = {
  'COM1': { lat: 1.2950, lng: 103.7736, name: 'Computing 1' },   // Main COM1 building
  'COM2': { lat: 1.2943, lng: 103.7745, name: 'Computing 2' },   // COM2 (south of COM1)
  'COM3': { lat: 1.2949, lng: 103.7755, name: 'Computing 3' },   // COM3 (east side)
  'COM4': { lat: 1.2954, lng: 103.7755, name: 'Computing 4' },   // COM4 (north of COM3)
  'AS6': { lat: 1.2955, lng: 103.7725, name: 'Arts & Social Sciences 6' }, // AS6 (west of COM1)
}

// NUS SoC campus center for initial map view
export const NUS_SOC_CENTER = { lat: 1.2950, lng: 103.7745 }

// All buildings available for filtering
export const BUILDINGS = ['COM1', 'COM2', 'COM3', 'COM4', 'AS6'] as const

// Floors by building (for dynamic floor selection)
export const FLOORS_BY_BUILDING: Record<string, string[]> = {
  'COM1': ['B1', '1', '2', '3'],
  'COM2': ['B1', '1', '2', '3', '4'],
  'COM3': ['B1', '1', '2'],
  'COM4': ['2', '5'],
  'AS6': ['4', '5'],
}

// Get all unique floors from printers
export function getAllFloors(): string[] {
  const floors = new Set<string>()
  Object.values(FLOORS_BY_BUILDING).flat().forEach(f => floors.add(f))
  return Array.from(floors).sort((a, b) => {
    // Sort B1 first, then numerically
    if (a === 'B1') return -1
    if (b === 'B1') return 1
    return parseInt(a) - parseInt(b)
  })
}

// Shared with the Rust agent API; keep catalogue metadata in one place.
export const PRINTERS: Printer[] = (catalogue as Omit<Printer, 'status'>[]).map(p => ({ ...p, status: 'Unknown', queue_count: 0 }))
const PUBLIC_PRINTERS = PRINTERS.filter(p => p.access_level === 'public')
const STAFF_PRINTERS = PRINTERS.filter(p => p.access_level === 'staff')
const RESTRICTED_PRINTERS = PRINTERS.filter(p => p.access_level === 'restricted')

// Export by access level for filtering
export const PUBLIC_PRINTER_IDS = PUBLIC_PRINTERS.map(p => p.queue_name)
export const STAFF_PRINTER_IDS = STAFF_PRINTERS.map(p => p.queue_name)
export const RESTRICTED_PRINTER_IDS = RESTRICTED_PRINTERS.map(p => p.queue_name)

export function normalizePrintQueueName(queueName: string | null | undefined): string | null {
  if (!queueName) return null

  const normalized = queueName.trim()
  if (!normalized) return null

  const alias = (queueAliases as Record<string, string>)[normalized]
  if (alias) return alias

  return normalized
}

export function getDefaultPrinterQueue(): string {
  return DEFAULT_PRINTER_QUEUE
}

function createDiscoveredPrinter(queueName: string): Printer {
  const normalized = normalizePrintQueueName(queueName) || queueName
  const baseId = normalized.replace(/-(dx|sx|nb)$/i, '')
  const variant = normalized.endsWith('-sx')
    ? 'sx'
    : normalized.endsWith('-dx')
      ? 'dx'
      : normalized.endsWith('-nb')
        ? 'nb'
        : 'main'

  return {
    id: normalized,
    name: normalized,
    queue_name: normalized,
    location: {
      building: 'SoC',
      room: 'Discovered from /etc/printcap',
      floor: '-',
    },
    model: 'Unknown',
    status: 'Unknown',
    supports_duplex: variant !== 'sx',
    supports_color: normalized.startsWith('c'),
    supported_paper_sizes: ['A4'],
    group_id: baseId,
    variant,
    queue_count: 0,
    access_level: 'restricted',
  }
}

function getPrinterMetadataMap(): Map<string, Printer> {
  return new Map(PRINTERS.map((printer) => [printer.queue_name, printer]))
}

export function getAvailablePrintersFromQueues(
  queueNames: string[],
  serverType: 'stu' | 'stf' | null
): Printer[] {
  const normalizedQueues = Array.from(
    new Set(
      queueNames
        .map(normalizePrintQueueName)
        .filter((queue): queue is string => Boolean(queue))
        .filter((queue) => /^[A-Za-z0-9_-]+$/.test(queue))
    )
  )

  if (normalizedQueues.length === 0) {
    return getPrintersForServerType(serverType)
  }

  const availableQueueSet = new Set(normalizedQueues)
  const metadataByQueue = getPrinterMetadataMap()
  const candidates = getPrintersForServerType(serverType)
  const knownAvailablePrinters = candidates.filter((printer) => availableQueueSet.has(printer.queue_name))

  const knownQueueSet = new Set(knownAvailablePrinters.map((printer) => printer.queue_name))
  const discoveredPrinters = normalizedQueues
    .filter((queue) => !knownQueueSet.has(queue))
    .map((queue) => metadataByQueue.get(queue) || createDiscoveredPrinter(queue))

  return [...knownAvailablePrinters, ...discoveredPrinters]
}

// Group printers by their group_id
export function groupPrinters(printers: Printer[]): PrinterGroup[] {
  const groupMap = new Map<string, Printer[]>()

  printers.forEach((printer) => {
    const groupId = printer.group_id || printer.id
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, [])
    }
    groupMap.get(groupId)!.push(printer)
  })

  return Array.from(groupMap.entries()).map(([groupId, groupPrinters]) => {
    const firstPrinter = groupPrinters[0]
    const totalQueueCount = groupPrinters.reduce(
      (sum, p) => sum + (p.queue_count || 0),
      0
    )

    return {
      id: groupId,
      name: groupId,
      display_name: `${firstPrinter.location.building} ${firstPrinter.location.room}`,
      printers: groupPrinters,
      total_queue_count: totalQueueCount,
    }
  })
}

// Get printer groups with status summary
export function getPrinterGroupsWithStatus(): PrinterGroup[] {
  return groupPrinters(PRINTERS)
}

// Get only public printers (for students)
export function getPublicPrinters(): Printer[] {
  return PUBLIC_PRINTERS
}

// Get printers based on server type (stu = student, stf = staff)
export function getPrintersForServerType(serverType: 'stu' | 'stf' | null): Printer[] {
  if (serverType === 'stf') {
    // Staff can use public + staff printers
    return [...PUBLIC_PRINTERS, ...STAFF_PRINTERS]
  }
  // Students (stu) can only use public printers
  return PUBLIC_PRINTERS
}

// Get printers by building
export function getPrintersByBuilding(building: string): Printer[] {
  return PRINTERS.filter(p => p.location.building === building)
}
