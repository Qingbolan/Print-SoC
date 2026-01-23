use crate::ssh_service::submit_print_job_ssh;
use crate::storage_service;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use uuid::Uuid;

// Global state for print jobs - initialized from storage on first access
lazy_static::lazy_static! {
    static ref PRINT_JOBS: Mutex<HashMap<String, PrintJob>> = {
        match storage_service::load_print_history() {
            Ok(jobs) => Mutex::new(jobs),
            Err(e) => {
                eprintln!("[Print] Failed to load history: {}, starting with empty state", e);
                Mutex::new(HashMap::new())
            }
        }
    };
    static ref HISTORY_DIRTY: AtomicBool = AtomicBool::new(false);
}

/// Mark history as dirty (needs saving)
fn mark_dirty() {
    HISTORY_DIRTY.store(true, Ordering::SeqCst);
}

/// Save history if dirty
pub fn save_if_dirty() -> Result<(), String> {
    if HISTORY_DIRTY.load(Ordering::SeqCst) {
        let jobs = PRINT_JOBS.lock().unwrap();
        storage_service::save_print_history(&jobs)?;
        HISTORY_DIRTY.store(false, Ordering::SeqCst);
    }
    Ok(())
}

/// Create a new print job
#[tauri::command]
pub fn print_create_job(
    name: String,
    file_path: String,
    printer: String,
    settings: PrintSettings,
) -> ApiResponse<PrintJob> {
    let job_id = Uuid::new_v4().to_string();

    // Backup the PDF file
    let backup_result = storage_service::backup_pdf_file(&job_id, &file_path);
    if let Err(e) = &backup_result {
        eprintln!("[Print] Warning: Failed to backup PDF: {}", e);
        // Continue anyway, the original file will be used
    }

    let job = PrintJob {
        id: job_id.clone(),
        name,
        file_path,
        printer,
        settings,
        status: PrintJobStatus::Pending,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        error: None,
        lpq_job_id: None,
    };

    let mut jobs = PRINT_JOBS.lock().unwrap();
    jobs.insert(job_id.clone(), job.clone());
    mark_dirty();

    // Try to save immediately (non-blocking)
    drop(jobs);
    let _ = save_if_dirty();

    ApiResponse::success(job)
}

/// Get all print jobs
#[tauri::command]
pub fn print_get_all_jobs() -> ApiResponse<Vec<PrintJob>> {
    let jobs = PRINT_JOBS.lock().unwrap();
    let all_jobs: Vec<PrintJob> = jobs.values().cloned().collect();
    ApiResponse::success(all_jobs)
}

/// Get a specific print job by ID
#[tauri::command]
pub fn print_get_job(job_id: String) -> ApiResponse<PrintJob> {
    let jobs = PRINT_JOBS.lock().unwrap();
    match jobs.get(&job_id) {
        Some(job) => ApiResponse::success(job.clone()),
        None => ApiResponse::error("Job not found".to_string()),
    }
}

/// Update print job status
#[tauri::command]
pub fn print_update_job_status(
    job_id: String,
    status: PrintJobStatus,
    error: Option<String>,
) -> ApiResponse<PrintJob> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    match jobs.get_mut(&job_id) {
        Some(job) => {
            job.status = status;
            job.updated_at = Utc::now();
            job.error = error;
            let result = job.clone();
            mark_dirty();
            drop(jobs);
            let _ = save_if_dirty();
            ApiResponse::success(result)
        }
        None => ApiResponse::error("Job not found".to_string()),
    }
}

/// Cancel a print job
#[tauri::command]
pub fn print_cancel_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    match jobs.get_mut(&job_id) {
        Some(job) => {
            // Try to cancel via SSH if job is queued
            if matches!(job.status, PrintJobStatus::Queued | PrintJobStatus::Printing) {
                // Cancel command would be: lprm -P printer job_name
                let command = format!("lprm -P {} {}", job.printer, job.name);
                let result = crate::ssh_service::ssh_execute_command(ssh_config, command);
                if !result.success {
                    return ApiResponse::error(format!("Failed to cancel job: {:?}", result.error));
                }
            }

            job.status = PrintJobStatus::Cancelled;
            job.updated_at = Utc::now();
            mark_dirty();
            drop(jobs);
            let _ = save_if_dirty();
            ApiResponse::success("Job cancelled successfully".to_string())
        }
        None => ApiResponse::error("Job not found".to_string()),
    }
}

/// Delete a print job from history
#[tauri::command]
pub fn print_delete_job(job_id: String) -> ApiResponse<String> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    match jobs.remove(&job_id) {
        Some(_) => {
            mark_dirty();
            // Clean up backup
            if let Err(e) = storage_service::delete_pdf_backup(&job_id) {
                eprintln!("[Print] Warning: Failed to delete backup: {}", e);
            }
            drop(jobs);
            let _ = save_if_dirty();
            ApiResponse::success("Job deleted successfully".to_string())
        }
        None => ApiResponse::error("Job not found".to_string()),
    }
}

/// Submit a print job via SSH
#[tauri::command]
pub fn print_submit_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let mut jobs = PRINT_JOBS.lock().unwrap();

    let (file_path, printer_name, _job_name, settings) = {
        match jobs.get_mut(&job_id) {
            Some(job) => {
                job.status = PrintJobStatus::Uploading;
                job.updated_at = Utc::now();
                (job.file_path.clone(), job.printer.clone(), job.name.clone(), job.settings.clone())
            }
            None => return ApiResponse::error("Job not found".to_string()),
        }
    };

    // Release lock before SSH operations
    drop(jobs);

    // Verify input file exists
    if !std::path::Path::new(&file_path).exists() {
        let mut jobs = PRINT_JOBS.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            job.status = PrintJobStatus::Failed;
            job.error = Some(format!("Source PDF file not found: {}", file_path));
            job.updated_at = Utc::now();
        }
        return ApiResponse::error(format!("PDF file not found: {}", file_path));
    }

    eprintln!("[Print] Processing job {} with file: {}", job_id, file_path);

    // Use original file directly - scaling will be done on server
    let base_file_path = file_path.clone();

    // Apply n-up layout or booklet if needed
    let processed_file_path = if settings.pages_per_sheet > 1 {
        // Use NUS SoC recommended pdfjam for n-up layout
        let temp_dir = std::env::temp_dir();
        let output_path = temp_dir.join(format!("nup_{}.pdf", job_id));
        let output_str = output_path.to_string_lossy().to_string();

        eprintln!("[Print] Creating {}-up layout: {} -> {}", settings.pages_per_sheet, base_file_path, output_str);
        match crate::pdf_service::create_nup_pdf_internal(&base_file_path, &output_str, settings.pages_per_sheet) {
            Ok(_) => {
                eprintln!("[Print] N-up layout succeeded");
                output_str
            }
            Err(e) => {
                eprintln!("[Print] N-up layout failed: {}", e);
                let mut jobs = PRINT_JOBS.lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id) {
                    job.status = PrintJobStatus::Failed;
                    job.error = Some(format!("PDF n-up layout failed: {}", e));
                    job.updated_at = Utc::now();
                }
                return ApiResponse::error(format!("Failed to create n-up layout: {}", e));
            }
        }
    } else if settings.booklet {
        // Use booklet layout
        let temp_dir = std::env::temp_dir();
        let output_path = temp_dir.join(format!("booklet_{}.pdf", job_id));
        let output_str = output_path.to_string_lossy().to_string();

        eprintln!("[Print] Creating booklet layout: {} -> {}", base_file_path, output_str);
        match crate::pdf_service::create_booklet_pdf_internal(&base_file_path, &output_str) {
            Ok(_) => {
                eprintln!("[Print] Booklet layout succeeded");
                output_str
            }
            Err(e) => {
                eprintln!("[Print] Booklet layout failed: {}", e);
                let mut jobs = PRINT_JOBS.lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id) {
                    job.status = PrintJobStatus::Failed;
                    job.error = Some(format!("Booklet creation failed: {}", e));
                    job.updated_at = Utc::now();
                }
                return ApiResponse::error(format!("Failed to create booklet: {}", e));
            }
        }
    } else {
        eprintln!("[Print] Using original file directly");
        base_file_path
    };

    // Generate remote file path using job_id (UUID, always safe)
    let remote_path = format!("/tmp/{}.pdf", job_id);
    let upload_result = crate::ssh_service::ssh_upload_file(
        ssh_config.clone(),
        processed_file_path,
        remote_path.clone(),
    );

    let mut jobs = PRINT_JOBS.lock().unwrap();
    let job = jobs.get_mut(&job_id).unwrap();

    if !upload_result.success {
        job.status = PrintJobStatus::Failed;
        let error_msg = upload_result.error.clone().unwrap_or_else(|| "Unknown error".to_string());
        job.error = Some(error_msg.clone());
        job.updated_at = Utc::now();
        return ApiResponse::error(error_msg);
    }

    // Submit print job
    job.status = PrintJobStatus::Queued;
    job.updated_at = Utc::now();
    let settings_clone = job.settings.clone();

    drop(jobs);

    match submit_print_job_ssh(&ssh_config, &printer_name, &remote_path, &settings_clone) {
        Ok(output) => {
            let mut jobs = PRINT_JOBS.lock().unwrap();
            if let Some(job) = jobs.get_mut(&job_id) {
                job.status = PrintJobStatus::Printing;
                job.updated_at = Utc::now();
                // Parse lpq job ID from lpr output (format: "request id is psts-123 (1 file(s))")
                if let Some(lpq_id) = parse_lpr_job_id(&output) {
                    job.lpq_job_id = Some(lpq_id);
                }
            }
            ApiResponse::success(format!("Print job submitted: {}", output))
        }
        Err(e) => {
            let mut jobs = PRINT_JOBS.lock().unwrap();
            if let Some(job) = jobs.get_mut(&job_id) {
                job.status = PrintJobStatus::Failed;
                job.error = Some(e.to_string());
                job.updated_at = Utc::now();
            }
            ApiResponse::error(format!("Failed to submit print job: {}", e))
        }
    }
}

/// Parse the lpq job ID from lpr output
/// Format: "request id is psts-123 (1 file(s))"
fn parse_lpr_job_id(output: &str) -> Option<String> {
    // Look for "request id is XXX" pattern
    if let Some(start) = output.find("request id is ") {
        let rest = &output[start + 14..]; // Skip "request id is "
        // Find the end (space or newline)
        let end = rest.find(|c: char| c == ' ' || c == '\n' || c == '(').unwrap_or(rest.len());
        let job_id = rest[..end].trim();
        if !job_id.is_empty() {
            return Some(job_id.to_string());
        }
    }
    None
}

/// Get list of available printers (mock data for now)
#[tauri::command]
pub fn print_get_printers() -> ApiResponse<Vec<Printer>> {
    let printers = vec![
        Printer {
            id: "psts".to_string(),
            name: "COM1-01-PS".to_string(),
            queue_name: "psts".to_string(),
            location: PrinterLocation {
                building: "COM1".to_string(),
                room: "01".to_string(),
                floor: "1".to_string(),
                coordinates: Some(Coordinates { x: 50.0, y: 50.0 }),
            },
            status: PrinterStatus::Online,
            paper_level: Some(75),
            supports_duplex: true,
            supports_color: false,
            supported_paper_sizes: vec![PaperSize::A4],
        },
        Printer {
            id: "psc008".to_string(),
            name: "COM1-02-PS-Color".to_string(),
            queue_name: "psc008".to_string(),
            location: PrinterLocation {
                building: "COM1".to_string(),
                room: "02".to_string(),
                floor: "2".to_string(),
                coordinates: Some(Coordinates { x: 80.0, y: 60.0 }),
            },
            status: PrinterStatus::Online,
            paper_level: Some(60),
            supports_duplex: true,
            supports_color: true,
            supported_paper_sizes: vec![PaperSize::A4, PaperSize::A3],
        },
        Printer {
            id: "pstsc".to_string(),
            name: "COM2-03-PS".to_string(),
            queue_name: "pstsc".to_string(),
            location: PrinterLocation {
                building: "COM2".to_string(),
                room: "03".to_string(),
                floor: "3".to_string(),
                coordinates: Some(Coordinates { x: 120.0, y: 90.0 }),
            },
            status: PrinterStatus::Busy,
            paper_level: Some(40),
            supports_duplex: true,
            supports_color: false,
            supported_paper_sizes: vec![PaperSize::A4],
        },
    ];

    ApiResponse::success(printers)
}

/// Check printer status via SSH
#[tauri::command]
pub fn print_check_printer_status(
    ssh_config: SSHConfig,
    printer_queue: String,
) -> ApiResponse<Vec<String>> {
    crate::ssh_service::ssh_check_printer_queue(ssh_config, printer_queue)
}

/// Check and update status of active print jobs
/// Returns list of jobs that were marked as completed
#[tauri::command]
pub fn print_check_active_jobs(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
    let mut completed_jobs = Vec::new();

    // Get all jobs that are currently in Printing or Queued status
    let active_jobs: Vec<(String, String, Option<String>)> = {
        let jobs = PRINT_JOBS.lock().unwrap();
        jobs.values()
            .filter(|job| matches!(job.status, PrintJobStatus::Printing | PrintJobStatus::Queued))
            .map(|job| (job.id.clone(), job.printer.clone(), job.lpq_job_id.clone()))
            .collect()
    };

    if active_jobs.is_empty() {
        return ApiResponse::success(completed_jobs);
    }

    // Group jobs by printer to minimize lpq calls
    let mut printer_jobs: std::collections::HashMap<String, Vec<(String, Option<String>)>> = std::collections::HashMap::new();
    for (job_id, printer, lpq_id) in active_jobs {
        printer_jobs.entry(printer).or_default().push((job_id, lpq_id));
    }

    // Check each printer's queue
    for (printer, jobs_to_check) in printer_jobs {
        let queue_result = crate::ssh_service::ssh_check_printer_queue(ssh_config.clone(), printer.clone());

        if queue_result.success {
            let queue_output = queue_result.data.unwrap_or_default().join("\n");

            // Check each job
            for (job_id, lpq_job_id) in jobs_to_check {
                let job_in_queue = if let Some(ref lpq_id) = lpq_job_id {
                    // Check if lpq job ID is in the queue output
                    queue_output.contains(lpq_id)
                } else {
                    // If no lpq_job_id, assume job completed after some time
                    false
                };

                if !job_in_queue {
                    // Job not in queue anymore, mark as completed
                    let mut jobs = PRINT_JOBS.lock().unwrap();
                    if let Some(job) = jobs.get_mut(&job_id) {
                        if matches!(job.status, PrintJobStatus::Printing | PrintJobStatus::Queued) {
                            job.status = PrintJobStatus::Completed;
                            job.updated_at = Utc::now();
                            completed_jobs.push(job_id.clone());
                        }
                    }
                }
            }
        }
    }

    ApiResponse::success(completed_jobs)
}

/// Force save print history to disk
#[tauri::command]
pub fn print_save_history() -> ApiResponse<String> {
    let jobs = PRINT_JOBS.lock().unwrap();
    match storage_service::save_print_history(&jobs) {
        Ok(_) => {
            HISTORY_DIRTY.store(false, Ordering::SeqCst);
            ApiResponse::success("History saved successfully".to_string())
        }
        Err(e) => ApiResponse::error(format!("Failed to save history: {}", e)),
    }
}

/// Get the backup file path for a job
#[tauri::command]
pub fn print_get_backup_path(job_id: String) -> ApiResponse<String> {
    match storage_service::get_backup_file_path(&job_id) {
        Some(path) => ApiResponse::success(path.to_string_lossy().to_string()),
        None => ApiResponse::error("Backup not found".to_string()),
    }
}

/// Clean up old history entries (default: 30 days)
#[tauri::command]
pub fn print_cleanup_history(days: Option<i64>) -> ApiResponse<Vec<String>> {
    let days = days.unwrap_or(30);
    let mut jobs = PRINT_JOBS.lock().unwrap();
    let removed = storage_service::cleanup_old_history(&mut jobs, days);

    if !removed.is_empty() {
        mark_dirty();
        drop(jobs);
        let _ = save_if_dirty();
    }

    ApiResponse::success(removed)
}

/// Get storage information
#[tauri::command]
pub fn print_get_storage_info() -> ApiResponse<StorageInfo> {
    match storage_service::get_storage_info() {
        Ok(info) => ApiResponse::success(info),
        Err(e) => ApiResponse::error(format!("Failed to get storage info: {}", e)),
    }
}
