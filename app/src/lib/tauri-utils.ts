/**
 * Tauri API utilities for safe browser/Tauri environment handling
 */

import { PRINTERS } from '@/data/printers'
import type {
  ApiResponse,
  BookletLayout,
  PDFInfo,
  PrintJob,
  PrintQueueJob,
  PrintSettings,
  PrintQuota,
  StorageInfo,
} from '@/types/printer'

type TauriCommandResponses = {
  check_network_connectivity: boolean
  ssh_connect: string
  ssh_disconnect: string
  ssh_connection_status: boolean
  ssh_test_connection: string
  ssh_execute_command: string
  ssh_upload_file: string
  print_check_printer_status: PrintQueueJob[]
  print_list_queues: string[]
  print_get_quota: PrintQuota
  pdf_get_info: PDFInfo
  pdf_generate_booklet_layout: BookletLayout
  pdf_create_booklet: string
  pdf_create_nup: string
  print_create_job: PrintJob
  print_get_all_jobs: PrintJob[]
  print_get_job: PrintJob
  print_update_job_status: PrintJob
  print_cancel_job: string
  print_delete_job: string
  print_submit_job: string
  print_check_active_jobs: string[]
  print_save_history: string
  print_get_backup_path: string
  print_cleanup_history: string[]
  print_get_storage_info: StorageInfo
}

/**
 * Check if running in Tauri environment
 */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

/**
 * Check if running in debug/offline mode
 */
export function isDebugMode(): boolean {
  return import.meta.env.VITE_DEBUG_OFFLINE === 'true'
}

/**
 * Safe wrapper for Tauri invoke function
 * Returns mock data in browser/debug mode
 */
export async function safeInvoke<K extends keyof TauriCommandResponses>(
  command: K,
  args?: Record<string, unknown>
): Promise<ApiResponse<TauriCommandResponses[K]>>
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<ApiResponse<T>>
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  // If in debug mode and Tauri is not available, return mock success
  if (isDebugMode() && !isTauriAvailable()) {
    console.log(`[Debug Mode] Mock invoke: ${command}`, args)

    // Return appropriate mock data based on command
    return getMockResponse(command, args) as ApiResponse<T>
  }

  // If Tauri is not available and not in debug mode, return error
  if (!isTauriAvailable()) {
    return {
      success: false,
      error: 'Tauri API not available. Please run the app using "npm run tauri:dev"',
    }
  }

  // Normal Tauri invoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke(command, args)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get mock response for debug mode
 */
function success<T>(data: T): ApiResponse<T> {
  return { success: true, data }
}

const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  copies: 1,
  duplex: 'DuplexLongEdge',
  orientation: 'Portrait',
  page_range: { type: 'All' },
  pages_per_sheet: 1,
  booklet: false,
  paper_size: 'A4',
}

const MOCK_QUEUE_JOBS: PrintQueueJob[] = [
  {
    rank: '1st',
    owner: 'mock',
    job_id: '123',
    file: 'sample.pdf',
    total_size: '1024 bytes',
    raw_line: '1st mock 123 sample.pdf 1024 bytes',
  },
]

function getMockResponse(command: string, args?: Record<string, unknown>): ApiResponse<unknown> {
  switch (command) {
    case 'check_network_connectivity':
    case 'ssh_connection_status':
      return success(true)

    case 'ssh_connect':
    case 'ssh_test_connection':
      return success('Connection successful (mock)')

    case 'ssh_disconnect':
      return success('Disconnected (mock)')

    case 'ssh_execute_command':
      return success('Mock command output')

    case 'ssh_upload_file':
      return success('File uploaded (mock)')

    case 'print_get_all_jobs':
      return success([])

    case 'print_list_queues':
      return success(PRINTERS.map((printer) => printer.queue_name))

    case 'print_get_quota':
      return success({
        raw_output: 'Print quota: mock output',
        summary: 'Print quota: mock output',
      } satisfies PrintQuota)

    case 'print_check_printer_status':
      return success(MOCK_QUEUE_JOBS)

    case 'pdf_get_info':
      return success({
        num_pages: 10,
        page_size: [595, 842],
        file_size: 1024000,
      } satisfies PDFInfo)

    case 'pdf_generate_booklet_layout':
      return success({
        total_sheets: 3,
        pages_per_sheet: 4,
        page_order: [
          [12, 1],
          [2, 11],
          [10, 3],
          [4, 9],
          [8, 5],
          [6, 7],
        ],
      } satisfies BookletLayout)

    case 'pdf_create_booklet':
    case 'pdf_create_nup':
      return success(String(args?.outputPath ?? '/tmp/mock-output.pdf'))

    case 'print_create_job': {
      const now = new Date().toISOString()
      const job: PrintJob = {
        id: `mock-${Date.now()}`,
        name: String(args?.name ?? 'mock.pdf'),
        file_path: String(args?.filePath ?? '/tmp/mock.pdf'),
        printer: String(args?.printer ?? 'psts-dx'),
        settings: (args?.settings as PrintSettings | undefined) ?? DEFAULT_PRINT_SETTINGS,
        status: 'Pending',
        created_at: now,
        updated_at: now,
      }
      return success(job)
    }

    case 'print_get_job': {
      const now = new Date().toISOString()
      return success({
        id: String(args?.jobId ?? 'mock-job'),
        name: 'mock.pdf',
        file_path: '/tmp/mock.pdf',
        printer: 'psts-dx',
        settings: DEFAULT_PRINT_SETTINGS,
        status: 'Pending',
        created_at: now,
        updated_at: now,
      } satisfies PrintJob)
    }

    case 'print_update_job_status': {
      const now = new Date().toISOString()
      return success({
        id: String(args?.jobId ?? 'mock-job'),
        name: 'mock.pdf',
        file_path: '/tmp/mock.pdf',
        printer: 'psts-dx',
        settings: DEFAULT_PRINT_SETTINGS,
        status: (args?.status as PrintJob['status'] | undefined) ?? 'Pending',
        created_at: now,
        updated_at: now,
        error: args?.error as string | undefined,
      } satisfies PrintJob)
    }

    case 'print_submit_job':
      return success('Print job submitted (mock)')

    case 'print_cancel_job':
      return success('Job cancelled successfully (mock)')

    case 'print_delete_job':
      return success('Job deleted successfully (mock)')

    case 'print_check_active_jobs':
    case 'print_cleanup_history':
      return success([])

    case 'print_save_history':
      return success('History saved successfully (mock)')

    case 'print_get_backup_path':
      return success('/tmp/mock-backup.pdf')

    case 'print_get_storage_info':
      return success({
        data_dir: '/tmp/print-soc',
        history_size: 0,
        backups_size: 0,
        total_size: 0,
        backup_count: 0,
      } satisfies StorageInfo)

    default:
      return success(null)
  }
}

/**
 * Safe wrapper for Tauri dialog open function
 */
export async function safeDialogOpen(options: {
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}): Promise<string | string[] | null> {
  // If in debug mode and Tauri is not available, return null (cancelled)
  if (isDebugMode() && !isTauriAvailable()) {
    console.log('[Debug Mode] Dialog open cancelled (mock)')
    return null
  }

  // If Tauri is not available, show error
  if (!isTauriAvailable()) {
    console.error('Tauri dialog API not available')
    return null
  }

  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    return await open(options)
  } catch (error) {
    console.error('Error opening dialog:', error)
    return null
  }
}

/**
 * Safe wrapper for getCurrentWebviewWindow
 */
export function safeGetCurrentWebviewWindow() {
  if (!isTauriAvailable()) {
    console.warn('Tauri webview API not available')
    return null
  }

  try {
    const { getCurrentWebviewWindow } = require('@tauri-apps/api/webviewWindow')
    return getCurrentWebviewWindow()
  } catch (error) {
    console.error('Error getting webview window:', error)
    return null
  }
}

/**
 * Safe wrapper for opening DevTools
 */
export async function safeOpenDevTools(): Promise<boolean> {
  const window = safeGetCurrentWebviewWindow()

  if (!window) {
    // If running in browser, try browser's native console
    if (typeof console !== 'undefined') {
      console.log('[Debug Mode] DevTools not available in browser mode. Use browser DevTools instead.')
    }
    return false
  }

  try {
    // @ts-ignore - openDevtools exists but may not be in types
    if (window.openDevtools) {
      // @ts-ignore
      await window.openDevtools()
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to open DevTools:', error)
    return false
  }
}
