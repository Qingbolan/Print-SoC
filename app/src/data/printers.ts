import type { Printer, PrinterGroup } from '@/types/printer'

// All printers extracted from the screenshots
export const PRINTERS: Printer[] = [
  // psts group
  {
    id: 'psts-main',
    name: 'psts',
    queue_name: 'psts',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psts',
    variant: 'main',
    queue_count: 0,
  },
  {
    id: 'psts-sx',
    name: 'psts-sx',
    queue_name: 'psts-sx',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psts',
    variant: 'sx',
    queue_count: 0,
  },
  {
    id: 'psts-nb',
    name: 'psts-nb',
    queue_name: 'psts-nb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psts',
    variant: 'nb',
    queue_count: 0,
  },

  // pstsb group
  {
    id: 'pstsb-main',
    name: 'pstsb',
    queue_name: 'pstsb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsb',
    variant: 'main',
    queue_count: 0,
  },
  {
    id: 'pstsb-sx',
    name: 'pstsb-sx',
    queue_name: 'pstsb-sx',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsb',
    variant: 'sx',
    queue_count: 0,
  },
  {
    id: 'pstsb-nb',
    name: 'pstsb-nb',
    queue_name: 'pstsb-nb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsb',
    variant: 'nb',
    queue_count: 0,
  },

  // pstsc group
  {
    id: 'pstsc-main',
    name: 'pstsc',
    queue_name: 'pstsc',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsc',
    variant: 'main',
    queue_count: 0,
  },
  {
    id: 'pstsc-sx',
    name: 'pstsc-sx',
    queue_name: 'pstsc-sx',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsc',
    variant: 'sx',
    queue_count: 0,
  },
  {
    id: 'pstsc-nb',
    name: 'pstsc-nb',
    queue_name: 'pstsc-nb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'pstsc',
    variant: 'nb',
    queue_count: 0,
  },

  // psc008 group
  {
    id: 'psc008-main',
    name: 'psc008',
    queue_name: 'psc008',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc008',
    variant: 'main',
    queue_count: 0,
  },
  {
    id: 'psc008-sx',
    name: 'psc008-sx',
    queue_name: 'psc008-sx',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc008',
    variant: 'sx',
    queue_count: 0,
  },
  {
    id: 'psc008-nb',
    name: 'psc008-nb',
    queue_name: 'psc008-nb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc008',
    variant: 'nb',
    queue_count: 0,
  },

  // psc011 group
  {
    id: 'psc011-main',
    name: 'psc011',
    queue_name: 'psc011',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc011',
    variant: 'main',
    queue_count: 0,
  },
  {
    id: 'psc011-sx',
    name: 'psc011-sx',
    queue_name: 'psc011-sx',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc011',
    variant: 'sx',
    queue_count: 0,
  },
  {
    id: 'psc011-nb',
    name: 'psc011-nb',
    queue_name: 'psc011-nb',
    location: {
      building: 'Main Building',
      room: 'Print Room',
      floor: '1F',
    },
    status: 'Online',
    supports_duplex: true,
    supports_color: false,
    supported_paper_sizes: ['A4', 'A3'],
    group_id: 'psc011',
    variant: 'nb',
    queue_count: 0,
  },
]

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

  return Array.from(groupMap.entries()).map(([groupId, printers]) => {
    const totalQueueCount = printers.reduce(
      (sum, p) => sum + (p.queue_count || 0),
      0
    )

    return {
      id: groupId,
      name: groupId,
      display_name: groupId.toUpperCase(),
      printers,
      total_queue_count: totalQueueCount,
    }
  })
}

// Get printer groups with status summary
export function getPrinterGroupsWithStatus(): PrinterGroup[] {
  return groupPrinters(PRINTERS)
}
