import type { Printer, PrinterGroup } from '@/types/printer'

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

// Helper to create printer variants (main, sx, nb)
function createPrinterGroup(
  baseId: string,
  location: { building: string; room: string; floor: string },
  model: string,
  supportsColor: boolean,
  supportedPaperSizes: ('A4' | 'A3')[],
  hasBanner: boolean,
  accessLevel: 'public' | 'staff' | 'restricted',
  variants: ('main' | 'sx' | 'nb' | 'dx' | 'a3' | 'a3-dx')[] = ['main', 'sx', 'nb']
): Printer[] {
  return variants.map(variant => {
    const queueName = variant === 'main' ? baseId : `${baseId}-${variant}`
    return {
      id: `${baseId}-${variant}`,
      name: queueName,
      queue_name: queueName,
      location,
      model,
      status: 'Online' as const,
      supports_duplex: !variant.includes('sx'), // sx = simplex only
      supports_color: supportsColor,
      supported_paper_sizes: supportedPaperSizes,
      group_id: baseId,
      variant,
      queue_count: 0,
      has_banner: hasBanner,
      access_level: accessLevel,
    }
  })
}

// ============ Print Queues Without User Restrictions (Public) ============
const PUBLIC_PRINTERS: Printer[] = [
  // psc008 - COM1 Basement
  ...createPrinterGroup('psc008',
    { building: 'COM1', room: 'Basement (outside Programming Lab 3)', floor: 'B1' },
    'LEXMARK MS821DN', false, ['A4'], true, 'public'),

  // psc011 - COM1 Basement
  ...createPrinterGroup('psc011',
    { building: 'COM1', room: 'Basement', floor: 'B1' },
    'LEXMARK MS821DN', false, ['A4'], true, 'public'),

  // psts - COM1 Level 1 Printer Area
  ...createPrinterGroup('psts',
    { building: 'COM1', room: 'Printer Area', floor: '1' },
    'LEXMARK MS821DN', false, ['A4'], true, 'public'),

  // pstsb - COM1 Level 1 Printer Area
  ...createPrinterGroup('pstsb',
    { building: 'COM1', room: 'Printer Area', floor: '1' },
    'LEXMARK MS821DN', false, ['A4'], true, 'public'),

  // pstsc - COM1 Level 1 Printer Area
  ...createPrinterGroup('pstsc',
    { building: 'COM1', room: 'Printer Area', floor: '1' },
    'LEXMARK MS821DN', false, ['A4'], true, 'public'),

  // cptsc - COM1-01-06 Technical Services (Color, No Banner)
  ...createPrinterGroup('cptsc',
    { building: 'COM1', room: '01-06, Technical Services', floor: '1' },
    'LEXMARK CS921DE', true, ['A4'], false, 'public', ['main', 'dx']),
  ...createPrinterGroup('cptsc-a3',
    { building: 'COM1', room: '01-06, Technical Services', floor: '1' },
    'LEXMARK CS921DE', true, ['A3'], false, 'public', ['main', 'dx']),

  // pse124 - COM3-01-24 Printer Room
  ...createPrinterGroup('pse124',
    { building: 'COM3', room: '01-24, Printer Room', floor: '1' },
    'LEXMARK MS810', false, ['A4'], true, 'public', ['main', 'sx']),

  // psf204 - COM4 Level 2 Printer Area
  ...createPrinterGroup('psf204',
    { building: 'COM4', room: 'Printer Area (corridor)', floor: '2' },
    'LEXMARK MS810', false, ['A4'], true, 'public', ['main', 'sx']),
]

// ============ Print Queues Restricted to Staff Only ============
const STAFF_PRINTERS: Printer[] = [
  // psc106 - COM1-01-06 Technical Services
  ...createPrinterGroup('psc106',
    { building: 'COM1', room: '01-06, Technical Services', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),

  // cpc313 - COM1-03-13 Mail Room (Color, No Banner)
  ...createPrinterGroup('cpc313',
    { building: 'COM1', room: '03-13, Mail Room', floor: '3' },
    'LEXMARK CS521DN', true, ['A4'], false, 'staff', ['main', 'dx']),

  // psc313 - COM1-03-13 Mail Room
  ...createPrinterGroup('psc313',
    { building: 'COM1', room: '03-13, Mail Room', floor: '3' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),

  // psgob - COM1-03-68 Dean's Office
  ...createPrinterGroup('psgob',
    { building: 'COM1', room: "03-68, Dean's Office", floor: '3' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff', ['main', 'sx']),

  // psgoc - COM1-03-38 Equipment Room
  ...createPrinterGroup('psgoc',
    { building: 'COM1', room: '03-38, Equipment Room', floor: '3' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff', ['main', 'sx']),

  // cpgoc - COM1-03-38 Equipment Room (Color)
  ...createPrinterGroup('cpgoc',
    { building: 'COM1', room: '03-38, Equipment Room', floor: '3' },
    'LEXMARK C950', true, ['A4'], false, 'staff', ['main', 'dx']),
  ...createPrinterGroup('cpgoc-a3',
    { building: 'COM1', room: '03-38, Equipment Room', floor: '3' },
    'LEXMARK C950', true, ['A3'], false, 'staff', ['main']),

  // psd238 - COM2-02-38 Equipment Room
  ...createPrinterGroup('psd238',
    { building: 'COM2', room: '02-38, Equipment Room', floor: '2' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),

  // psd263 - COM2-02-63 Equipment Room
  ...createPrinterGroup('psd263',
    { building: 'COM2', room: '02-63, Equipment Room', floor: '2' },
    'LEXMARK MS821DN', false, ['A4'], true, 'staff'),

  // cpd313 - COM2-03-13 Equipment Room (Color)
  ...createPrinterGroup('cpd313',
    { building: 'COM2', room: '03-13, Equipment Room', floor: '3' },
    'LEXMARK C950', true, ['A4'], false, 'staff', ['main', 'dx']),

  // psd313 - COM2-03-13 Equipment Room
  ...createPrinterGroup('psd313',
    { building: 'COM2', room: '03-13, Equipment Room', floor: '3' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),

  // psd405 - COM2-04-05 Equipment Room
  ...createPrinterGroup('psd405',
    { building: 'COM2', room: '04-05, Equipment Room', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),

  // pse202 - COM3-02-02 Staff Equipment Room
  ...createPrinterGroup('pse202',
    { building: 'COM3', room: '02-02, Staff Equipment Room', floor: '2' },
    'LEXMARK MS821DN', false, ['A4'], true, 'staff', ['main', 'sx']),

  // pse017 - COM3-B1-17 Staff Equipment Room
  ...createPrinterGroup('pse017',
    { building: 'COM3', room: 'B1-17, Staff Equipment Room', floor: 'B1' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff', ['main', 'sx']),

  // cpa518 - AS6-05-18 Staff Equipment Room (Color)
  ...createPrinterGroup('cpa518',
    { building: 'AS6', room: '05-18, Staff Equipment Room', floor: '5' },
    'LEXMARK CS521DN', true, ['A4'], false, 'staff', ['main', 'dx']),

  // psa427 - AS6-04-27 TA Office
  ...createPrinterGroup('psa427',
    { building: 'AS6', room: '04-27, TA Office', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff', ['main', 'sx']),

  // psa518 - AS6-05-18 Staff Equipment Room
  ...createPrinterGroup('psa518',
    { building: 'AS6', room: '05-18, Staff Equipment Room', floor: '5' },
    'LEXMARK MS810DN', false, ['A4'], true, 'staff'),
]

// ============ Restricted Access Printers ============
const RESTRICTED_PRINTERS: Printer[] = [
  // COM1 Labs
  ...createPrinterGroup('psc107',
    { building: 'COM1', room: '01-07, Database Research Lab 3', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc108',
    { building: 'COM1', room: '01-08, Database Research Lab 1', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc109',
    { building: 'COM1', room: '01-09, AI Research Lab 2', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc111',
    { building: 'COM1', room: '01-11, Database Research Lab 2', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc113',
    { building: 'COM1', room: '01-13, Embedded Systems Teaching Lab 2', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], true, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc115',
    { building: 'COM1', room: '01-15, Computational Biology Research Lab 2', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc116',
    { building: 'COM1', room: '01-16, Systems and Networking Research Lab 1', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psc121',
    { building: 'COM1', room: '01-21, Computational Biology Research Lab 1', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),

  // COM2 Labs
  ...createPrinterGroup('psd002',
    { building: 'COM2', room: 'B1-02, TA/GT Cluster 2', floor: 'B1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psd003',
    { building: 'COM2', room: 'B1-03, TA/GT Cluster 3', floor: 'B1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psd102',
    { building: 'COM2', room: '01-02, Media Research Lab 5', floor: '1' },
    'LEXMARK MS821DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psd107',
    { building: 'COM2', room: '01-07, IS Research Lab 3', floor: '1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psd404',
    { building: 'COM2', room: '04-04, PL & SE Research Lab 2', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),

  // COM3 Labs
  ...createPrinterGroup('pse033',
    { building: 'COM3', room: 'B1-33, AI Research Lab 2', floor: 'B1' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('pse217',
    { building: 'COM3', room: '02-17, Systems and Networking Lab', floor: '2' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('pse218',
    { building: 'COM3', room: '02-18, Security Research Lab 1', floor: '2' },
    'LEXMARK MS821DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('pse220',
    { building: 'COM3', room: '02-20, PL & SE Lab', floor: '2' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('pse221',
    { building: 'COM3', room: '02-21, AI Research Lab 1', floor: '2' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('pse265',
    { building: 'COM3', room: '02-65, ISA Research Lab 1', floor: '2' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),

  // COM4 Labs
  ...createPrinterGroup('psf501',
    { building: 'COM4', room: '05-01, AI Research Lab 3', floor: '5' },
    'LEXMARK MS821DN', false, ['A4'], false, 'restricted', ['main', 'sx']),

  // AS6 Labs
  ...createPrinterGroup('psa403',
    { building: 'AS6', room: '04-03, Media Research Lab 2', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa411',
    { building: 'AS6', room: '04-11, Media Research Lab 4B', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa413',
    { building: 'AS6', room: '04-13, Media Research Lab 1', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa421',
    { building: 'AS6', room: '04-21, Media Teaching Lab 1', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], true, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa425',
    { building: 'AS6', room: '04-25, Systems & Networking Research Lab 9', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa426',
    { building: 'AS6', room: '04-26, Media Teaching Lab 2A', floor: '4' },
    'LEXMARK MS810DN', false, ['A4'], true, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa517',
    { building: 'AS6', room: '05-17, Media Research Lab 5', floor: '5' },
    'LEXMARK MS821DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa501',
    { building: 'AS6', room: '05-01, Media Research Lab 3', floor: '5' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa502',
    { building: 'AS6', room: '05-02, Media Research Lab 4', floor: '5' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa521',
    { building: 'AS6', room: '05-21, Media Research Lab 6', floor: '5' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa522',
    { building: 'AS6', room: '05-22, Media Research Lab 7', floor: '5' },
    'LEXMARK MS810DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
  ...createPrinterGroup('psa525',
    { building: 'AS6', room: '05-25, Media Research Lab 8', floor: '5' },
    'LEXMARK MS821DN', false, ['A4'], false, 'restricted', ['main', 'sx']),
]

// All printers combined
export const PRINTERS: Printer[] = [
  ...PUBLIC_PRINTERS,
  ...STAFF_PRINTERS,
  ...RESTRICTED_PRINTERS,
]

// Export by access level for filtering
export const PUBLIC_PRINTER_IDS = PUBLIC_PRINTERS.map(p => p.queue_name)
export const STAFF_PRINTER_IDS = STAFF_PRINTERS.map(p => p.queue_name)
export const RESTRICTED_PRINTER_IDS = RESTRICTED_PRINTERS.map(p => p.queue_name)

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
