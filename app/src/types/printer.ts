// ========== SSH Authentication ==========
export interface SSHConfig {
  host: string
  port: number
  username: string
  auth_type: SSHAuthType
}

export type SSHAuthType =
  | { type: 'Password'; password: string }
  | { type: 'PrivateKey'; key_path: string; passphrase?: string }

// ========== Print Job ==========
export interface PrintJob {
  id: string
  name: string
  file_path: string
  printer: string
  settings: PrintSettings
  status: PrintJobStatus
  created_at: string
  updated_at: string
  error?: string
  /** The job ID assigned by lpq (e.g., "psts-123") */
  lpq_job_id?: string
}

export interface PrintSettings {
  copies: number
  duplex: DuplexMode
  orientation: Orientation
  page_range: PageRange
  pages_per_sheet: number
  booklet: boolean
  paper_size: PaperSize
}

export type DuplexMode = 'Simplex' | 'DuplexLongEdge' | 'DuplexShortEdge'
export type Orientation = 'Portrait' | 'Landscape'

export type PageRange =
  | { type: 'All' }
  | { type: 'Range'; start: number; end: number }
  | { type: 'Selection'; pages: number[] }

export type PaperSize = 'A4' | 'A3'

export type PrintJobStatus =
  | 'Pending'
  | 'Uploading'
  | 'Queued'
  | 'Printing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'

// ========== Printer Info ==========
export interface Printer {
  id: string
  name: string
  queue_name: string
  location: PrinterLocation
  model?: string
  status: PrinterStatus
  paper_level?: number
  supports_duplex: boolean
  supports_color: boolean
  supported_paper_sizes: PaperSize[]
  group_id?: string
  variant?: PrinterVariant
  queue_count?: number
  has_banner?: boolean
  access_level?: 'public' | 'staff' | 'restricted'
}

export interface PrinterGroup {
  id: string
  name: string
  display_name: string
  printers: Printer[]
  total_queue_count: number
}

export type PrinterVariant = 'main' | 'sx' | 'nb' | 'dx' | 'a3' | 'a3-dx'

export interface PrinterLocation {
  building: string
  room: string
  floor: string
  coordinates?: Coordinates
}

export interface Coordinates {
  x: number
  y: number
}

export type PrinterStatus = 'Online' | 'Offline' | 'Busy' | 'OutOfPaper' | 'Error'

// ========== API Responses ==========
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ========== PDF Processing ==========
export interface PDFInfo {
  num_pages: number
  page_size: [number, number]
  file_size: number
}

export interface BookletLayout {
  total_sheets: number
  pages_per_sheet: number
  page_order: (number | null)[][]
}
