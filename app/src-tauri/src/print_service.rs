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

fn update_job<F>(job_id: &str, update: F) -> Result<PrintJob, String>
where
    F: FnOnce(&mut PrintJob),
{
    let mut jobs = PRINT_JOBS.lock().unwrap();
    let job = jobs
        .get_mut(job_id)
        .ok_or_else(|| "Job not found".to_string())?;

    update(job);
    job.updated_at = Utc::now();
    let result = job.clone();
    mark_dirty();
    drop(jobs);
    let _ = save_if_dirty();

    Ok(result)
}

fn fail_job(job_id: &str, error: String) {
    let _ = update_job(job_id, |job| {
        job.status = PrintJobStatus::Failed;
        job.error = Some(error);
    });
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
    let durable_file_path = backup_result
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or(file_path);

    let job = PrintJob {
        id: job_id.clone(),
        name,
        file_path: durable_file_path,
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
    match update_job(&job_id, |job| {
        job.status = status;
        job.error = error;
    }) {
        Ok(job) => ApiResponse::success(job),
        Err(e) => ApiResponse::error(e),
    }
}

/// Cancel a print job
#[tauri::command]
pub fn print_cancel_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let remote_cancel = {
        let jobs = PRINT_JOBS.lock().unwrap();
        let job = match jobs.get(&job_id) {
            Some(job) => job,
            None => return ApiResponse::error("Job not found".to_string()),
        };

        if matches!(
            job.status,
            PrintJobStatus::Queued | PrintJobStatus::Printing
        ) {
            if let Err(e) = crate::ssh_service::validate_print_queue_name(&job.printer) {
                return ApiResponse::error(e);
            }

            let lpq_job_id = match job
                .lpq_job_id
                .as_deref()
                .map(crate::ssh_service::normalize_lpq_job_id)
            {
                Some(lpq_job_id) => lpq_job_id,
                None => {
                    return ApiResponse::error(
                        "Cannot cancel remote job before queue ID is known".to_string(),
                    )
                }
            };

            if !lpq_job_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return ApiResponse::error(format!("Invalid queue job ID: {}", lpq_job_id));
            }

            Some((job.printer.clone(), lpq_job_id))
        } else {
            None
        }
    };

    if let Some((printer, lpq_job_id)) = remote_cancel {
        let command = format!("lprm -P {} {}", printer, lpq_job_id);
        let result = crate::ssh_service::ssh_execute_command(ssh_config, command);
        if !result.success {
            return ApiResponse::error(format!(
                "Failed to cancel job: {}",
                result.error.unwrap_or_else(|| "unknown error".to_string())
            ));
        }
    }

    match update_job(&job_id, |job| {
        job.status = PrintJobStatus::Cancelled;
        job.error = None;
    }) {
        Ok(_) => ApiResponse::success("Job cancelled successfully".to_string()),
        Err(e) => ApiResponse::error(e),
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
    let job = match update_job(&job_id, |job| {
        job.status = PrintJobStatus::Uploading;
        job.error = None;
        job.lpq_job_id = None;
    }) {
        Ok(job) => job,
        Err(e) => return ApiResponse::error(e),
    };

    let file_path = job.file_path;
    let printer_name = job.printer;
    let settings = job.settings;

    // Verify input file exists
    if !std::path::Path::new(&file_path).exists() {
        let error = format!("PDF file not found: {}", file_path);
        fail_job(&job_id, format!("Source PDF file not found: {}", file_path));
        return ApiResponse::error(error);
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

        eprintln!(
            "[Print] Creating {}-up layout: {} -> {}",
            settings.pages_per_sheet, base_file_path, output_str
        );
        match crate::pdf_service::create_nup_pdf_internal(
            &base_file_path,
            &output_str,
            settings.pages_per_sheet,
        ) {
            Ok(_) => {
                eprintln!("[Print] N-up layout succeeded");
                output_str
            }
            Err(e) => {
                eprintln!("[Print] N-up layout failed: {}", e);
                fail_job(&job_id, format!("PDF n-up layout failed: {}", e));
                return ApiResponse::error(format!("Failed to create n-up layout: {}", e));
            }
        }
    } else if settings.booklet {
        // Use booklet layout
        let temp_dir = std::env::temp_dir();
        let output_path = temp_dir.join(format!("booklet_{}.pdf", job_id));
        let output_str = output_path.to_string_lossy().to_string();

        eprintln!(
            "[Print] Creating booklet layout: {} -> {}",
            base_file_path, output_str
        );
        match crate::pdf_service::create_booklet_pdf_internal(&base_file_path, &output_str) {
            Ok(_) => {
                eprintln!("[Print] Booklet layout succeeded");
                output_str
            }
            Err(e) => {
                eprintln!("[Print] Booklet layout failed: {}", e);
                fail_job(&job_id, format!("Booklet creation failed: {}", e));
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

    if !upload_result.success {
        let error_msg = upload_result
            .error
            .clone()
            .unwrap_or_else(|| "Unknown error".to_string());
        fail_job(&job_id, error_msg.clone());
        return ApiResponse::error(error_msg);
    }

    if let Err(e) = update_job(&job_id, |job| {
        job.status = PrintJobStatus::Queued;
        job.error = None;
    }) {
        let _ = crate::ssh_service::ssh_execute_command(
            ssh_config.clone(),
            format!("rm -f {}", crate::ssh_service::shell_quote(&remote_path)),
        );
        return ApiResponse::error(e);
    }

    let submit_result = submit_print_job_ssh(&ssh_config, &printer_name, &remote_path, &settings);
    let _ = crate::ssh_service::ssh_execute_command(
        ssh_config.clone(),
        format!("rm -f {}", crate::ssh_service::shell_quote(&remote_path)),
    );

    match submit_result {
        Ok(output) => {
            let lpq_job_id = parse_lpr_job_id(&output);
            match update_job(&job_id, |job| {
                job.status = PrintJobStatus::Printing;
                job.error = None;
                // Parse lpq job ID from lpr output (format: "request id is psts-123 (1 file(s))")
                if let Some(lpq_id) = lpq_job_id {
                    job.lpq_job_id = Some(lpq_id);
                }
            }) {
                Ok(_) => ApiResponse::success(format!("Print job submitted: {}", output)),
                Err(e) => ApiResponse::error(e),
            }
        }
        Err(e) => {
            let error = e.to_string();
            fail_job(&job_id, error.clone());
            ApiResponse::error(format!("Failed to submit print job: {}", error))
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
        let end = rest
            .find(|c: char| c == ' ' || c == '\n' || c == '(')
            .unwrap_or(rest.len());
        let job_id = crate::ssh_service::normalize_lpq_job_id(rest[..end].trim());
        if !job_id.is_empty() {
            return Some(job_id);
        }
    }
    None
}

fn lpq_job_id_matches(queue_job: &PrintQueueJob, lpq_job_id: &str) -> bool {
    let normalized = crate::ssh_service::normalize_lpq_job_id(lpq_job_id);
    queue_job.job_id == normalized
        || queue_job.job_id == lpq_job_id
        || queue_job.raw_line.contains(lpq_job_id)
}

/// Check printer status via SSH
#[tauri::command]
pub fn print_check_printer_status(
    ssh_config: SSHConfig,
    printer_queue: String,
) -> ApiResponse<Vec<PrintQueueJob>> {
    crate::ssh_service::ssh_check_printer_queue(ssh_config, printer_queue)
}

/// Dynamically list available print queues from the connected SoC server
#[tauri::command]
pub fn print_list_queues(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
    crate::ssh_service::ssh_list_print_queues(ssh_config)
}

/// Check print quota/balance using pusage on the connected SoC server
#[tauri::command]
pub fn print_get_quota(ssh_config: SSHConfig) -> ApiResponse<PrintQuota> {
    crate::ssh_service::ssh_get_print_quota(ssh_config)
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
            .filter(|job| {
                matches!(
                    job.status,
                    PrintJobStatus::Printing | PrintJobStatus::Queued
                )
            })
            .map(|job| (job.id.clone(), job.printer.clone(), job.lpq_job_id.clone()))
            .collect()
    };

    if active_jobs.is_empty() {
        return ApiResponse::success(completed_jobs);
    }

    // Group jobs by printer to minimize lpq calls
    let mut printer_jobs: std::collections::HashMap<String, Vec<(String, Option<String>)>> =
        std::collections::HashMap::new();
    for (job_id, printer, lpq_id) in active_jobs {
        printer_jobs
            .entry(printer)
            .or_default()
            .push((job_id, lpq_id));
    }

    // Check each printer's queue
    for (printer, jobs_to_check) in printer_jobs {
        let queue_result =
            crate::ssh_service::ssh_check_printer_queue(ssh_config.clone(), printer.clone());

        if queue_result.success {
            let queue_jobs = queue_result.data.unwrap_or_default();

            // Check each job
            for (job_id, lpq_job_id) in jobs_to_check {
                let job_in_queue = if let Some(ref lpq_id) = lpq_job_id {
                    // Check if lpq job ID is in the structured queue output
                    queue_jobs
                        .iter()
                        .any(|queue_job| lpq_job_id_matches(queue_job, lpq_id))
                } else {
                    // If no lpq_job_id, assume job completed after some time
                    false
                };

                if !job_in_queue {
                    // Job not in queue anymore, mark as completed
                    let was_completed = update_job(&job_id, |job| {
                        if matches!(
                            job.status,
                            PrintJobStatus::Printing | PrintJobStatus::Queued
                        ) {
                            job.status = PrintJobStatus::Completed;
                        }
                    })
                    .map(|job| job.status == PrintJobStatus::Completed)
                    .unwrap_or(false);

                    if was_completed {
                        completed_jobs.push(job_id.clone());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lpr_request_id_as_lpq_job_number() {
        let output = "request id is psts-123 (1 file(s))";

        assert_eq!(parse_lpr_job_id(output).as_deref(), Some("123"));
    }

    #[test]
    fn matches_prefixed_lpr_id_to_lpq_job_id() {
        let queue_job = PrintQueueJob {
            rank: "active".to_string(),
            owner: "alice".to_string(),
            job_id: "123".to_string(),
            file: "notes.pdf".to_string(),
            total_size: Some("1024 bytes".to_string()),
            raw_line: "active alice 123 notes.pdf 1024 bytes".to_string(),
        };

        assert!(lpq_job_id_matches(&queue_job, "psts-123"));
    }
}
