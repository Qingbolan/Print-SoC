import { safeInvoke } from './tauri-utils'
import type {
  SSHConfig,
  PrintJob,
  PrintSettings,
  Printer,
  PDFInfo,
  BookletLayout,
  ApiResponse,
  PrintJobStatus,
} from '@/types/printer'

// ========== SSH Operations ==========
export async function testSSHConnection(config: SSHConfig): Promise<ApiResponse<string>> {
  return await safeInvoke('ssh_test_connection', { config })
}

export async function executeSSHCommand(
  config: SSHConfig,
  command: string
): Promise<ApiResponse<string>> {
  return await safeInvoke('ssh_execute_command', { config, command })
}

export async function uploadFile(
  config: SSHConfig,
  localPath: string,
  remotePath: string
): Promise<ApiResponse<string>> {
  return await safeInvoke('ssh_upload_file', {
    config,
    localPath,
    remotePath,
  })
}

export async function checkPrinterQueue(
  config: SSHConfig,
  printer: string
): Promise<ApiResponse<string[]>> {
  return await safeInvoke('ssh_check_printer_queue', { config, printer })
}

// ========== PDF Operations ==========
export async function getPDFInfo(filePath: string): Promise<ApiResponse<PDFInfo>> {
  return await safeInvoke('pdf_get_info', { filePath })
}

export async function generateBookletLayout(
  numPages: number
): Promise<ApiResponse<BookletLayout>> {
  return await safeInvoke('pdf_generate_booklet_layout', { numPages })
}

export async function createBookletPDF(
  inputPath: string,
  outputPath: string
): Promise<ApiResponse<string>> {
  return await safeInvoke('pdf_create_booklet', { inputPath, outputPath })
}

export async function createNupPDF(
  inputPath: string,
  outputPath: string,
  pagesPerSheet: number
): Promise<ApiResponse<string>> {
  return await safeInvoke('pdf_create_nup', {
    inputPath,
    outputPath,
    pagesPerSheet,
  })
}

// ========== Print Job Operations ==========
export async function createPrintJob(
  name: string,
  filePath: string,
  printer: string,
  settings: PrintSettings
): Promise<ApiResponse<PrintJob>> {
  return await safeInvoke('print_create_job', {
    name,
    filePath,
    printer,
    settings,
  })
}

export async function getAllPrintJobs(): Promise<ApiResponse<PrintJob[]>> {
  return await safeInvoke('print_get_all_jobs')
}

export async function getPrintJob(jobId: string): Promise<ApiResponse<PrintJob>> {
  return await safeInvoke('print_get_job', { jobId })
}

export async function updateJobStatus(
  jobId: string,
  status: PrintJobStatus,
  error?: string
): Promise<ApiResponse<PrintJob>> {
  return await safeInvoke('print_update_job_status', { jobId, status, error })
}

export async function cancelPrintJob(
  jobId: string,
  sshConfig: SSHConfig
): Promise<ApiResponse<string>> {
  return await safeInvoke('print_cancel_job', { jobId, sshConfig })
}

export async function deletePrintJob(jobId: string): Promise<ApiResponse<string>> {
  return await safeInvoke('print_delete_job', { jobId })
}

export async function submitPrintJob(
  jobId: string,
  sshConfig: SSHConfig
): Promise<ApiResponse<string>> {
  return await safeInvoke('print_submit_job', { jobId, sshConfig })
}

export async function getPrinters(): Promise<ApiResponse<Printer[]>> {
  return await safeInvoke('print_get_printers')
}

export async function checkPrinterStatus(
  sshConfig: SSHConfig,
  printerQueue: string
): Promise<ApiResponse<string[]>> {
  return await safeInvoke('print_check_printer_status', { sshConfig, printerQueue })
}
