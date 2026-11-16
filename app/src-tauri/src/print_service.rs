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
        if job.status == PrintJobStatus::Cancelled { return; }
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
    let info = match crate::pdf_service::get_pdf_info_internal(&file_path) {
        Ok(info) => info,
        Err(error) => return ApiResponse::error(format!("Prepare a valid PDF before creating a print job: {}", error)),
    };
    if let Err(error) = crate::pdf_service::validate_print_settings(&settings, info.num_pages) {
        return ApiResponse::error(error);
    }
    if let Err(error) = crate::ssh_service::validate_print_queue_name(&printer) {
        return ApiResponse::error(error);
    }
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
        progress: None,
        submission: None,
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
    let Some(job) = jobs.get_mut(&job_id) else { return ApiResponse::error("Job not found".into()); };
    if let Err(error) = job.request_status(status, error) { return ApiResponse::error(error); }
    let result = job.clone();
    mark_dirty();
    drop(jobs);
    match save_if_dirty() {
        Ok(()) => ApiResponse::success(result),
        Err(error) => ApiResponse::error(error),
    }
}

/// Cancel a print job
#[tauri::command]
pub async fn print_cancel_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    match tauri::async_runtime::spawn_blocking(move || print_cancel_job_blocking(job_id, ssh_config)).await {
        Ok(result) => result,
        Err(error) => ApiResponse::error(error.to_string()),
    }
}

fn print_cancel_job_blocking(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let remote_cancel = {
        let mut jobs = PRINT_JOBS.lock().unwrap();
        let job = match jobs.get_mut(&job_id) {
            Some(job) => job,
            None => return ApiResponse::error("Job not found".to_string()),
        };

        if matches!(job.status, PrintJobStatus::Pending | PrintJobStatus::Failed | PrintJobStatus::Uploading) {
            if let Err(error) = job.request_status(PrintJobStatus::Cancelled, None) {
                if job.status != PrintJobStatus::Uploading { return ApiResponse::error(error); }
                return ApiResponse::error("Submission is in flight. Wait for the queue receipt before cancelling.".into());
            }
            mark_dirty();
            drop(jobs);
            let _ = save_if_dirty();
            return ApiResponse::success("Preparation cancelled. No print command will be sent.".into());
        }
        match job.remote_cancellation(&SSHIdentity::from(&ssh_config)) {
            Ok(request) => request,
            Err(error) => return ApiResponse::error(error),
        }
    };

    let result = crate::ssh_service::ssh_execute_command(ssh_config, remote_cancel.command());
    if !result.success {
        return ApiResponse::error(format!(
            "Failed to cancel job: {}",
            result.error.unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    let mut jobs = PRINT_JOBS.lock().unwrap();
    let changed = jobs.get_mut(&job_id)
        .is_some_and(|job| job.complete_remote_cancellation(&remote_cancel));
    if changed { mark_dirty(); }
    drop(jobs);
    match save_if_dirty() {
        Ok(()) if changed => ApiResponse::success("Job cancelled successfully".into()),
        Ok(()) => ApiResponse::success("Cancellation request completed. The job had already changed state.".into()),
        Err(error) => ApiResponse::error(error),
    }
}

/// The user explicitly identifies the original account for pre-identity history.
#[tauri::command]
pub fn print_link_job_account(job_id: String, ssh_config: SSHConfig) -> ApiResponse<PrintJob> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    let Some(job) = jobs.get_mut(&job_id) else { return ApiResponse::error("Job not found".into()); };
    if let Err(error) = job.adopt_account(SSHIdentity::from(&ssh_config)) { return ApiResponse::error(error); }
    let result = job.clone();
    mark_dirty();
    drop(jobs);
    match save_if_dirty() {
        Ok(()) => ApiResponse::success(result),
        Err(error) => ApiResponse::error(error),
    }
}

/// Explicitly close an unresolvable submission after the user checks the queue
/// and physical output. This never sends a new print command.
#[tauri::command]
pub fn print_resolve_submission(job_id: String, printed: bool) -> ApiResponse<PrintJob> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    let Some(job) = jobs.get_mut(&job_id) else { return ApiResponse::error("Job not found".into()); };
    if let Err(error) = job.resolve_review(printed) { return ApiResponse::error(error); }
    let result = job.clone();
    mark_dirty();
    drop(jobs);
    match save_if_dirty() {
        Ok(()) => ApiResponse::success(result),
        Err(error) => ApiResponse::error(error),
    }
}

/// Delete a print job from history
#[tauri::command]
pub fn print_delete_job(job_id: String) -> ApiResponse<String> {
    let mut jobs = PRINT_JOBS.lock().unwrap();
    if jobs.get(&job_id).is_some_and(|job| !job.can_delete()) {
        return ApiResponse::error("Cancel or resolve this active job before deleting its history".into());
    }
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

fn begin_submission(job_id: &str, config: &SSHConfig) -> Result<PrintJob, String> {
    let mut jobs = PRINT_JOBS.lock().map_err(|_| "Print job state unavailable")?;
    let job = jobs.get_mut(job_id).ok_or("Job not found")?;
    if !matches!(job.status, PrintJobStatus::Pending | PrintJobStatus::Failed) {
        return Err("This job is already being submitted or has been submitted. Check its queue status before creating another job.".into());
    }
    job.submission = Some(SubmissionAttempt { id: Uuid::new_v4().to_string(), account: SSHIdentity::from(config) });
    job.status = PrintJobStatus::Uploading;
    job.printer = crate::ssh_service::queue_for_duplex_mode(&job.printer, matches!(job.settings.duplex, DuplexMode::Simplex));
    job.progress = Some(PrintProgress { stage: PrintStage::Preparing, bytes_sent: 0, total_bytes: 0 });
    job.error = None;
    job.lpq_job_id = None;
    job.updated_at = Utc::now();
    let result = job.clone();
    mark_dirty();
    drop(jobs);
    let _ = save_if_dirty();
    Ok(result)
}

fn advance_stage(job_id: &str, stage: PrintStage) -> Result<(), String> {
    let mut jobs = PRINT_JOBS.lock().map_err(|_| "Job state unavailable")?;
    let job = jobs.get_mut(job_id).ok_or("Job not found")?;
    job.transition(stage)?;
    mark_dirty();
    drop(jobs);
    save_if_dirty()
}

fn upload_progress(job_id: &str, sent: u64, total: u64) -> std::io::Result<()> {
    let mut jobs = PRINT_JOBS.lock().map_err(|_| std::io::Error::other("Job state unavailable"))?;
    let job = jobs.get_mut(job_id).ok_or_else(|| std::io::Error::other("Job not found"))?;
    if job.status == PrintJobStatus::Cancelled { return Err(std::io::Error::other("Upload cancelled")); }
    job.progress = Some(PrintProgress { stage: PrintStage::Uploading, bytes_sent: sent, total_bytes: total });
    Ok(())
}

/// Submit a print job via SSH
#[tauri::command]
pub async fn print_submit_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    match tauri::async_runtime::spawn_blocking(move || submit_job(job_id, ssh_config)).await {
        Ok(response) => response,
        Err(_) => ApiResponse::error("Submission not confirmed: the print worker stopped. Check the printer queue before retrying.".into()),
    }
}

pub(crate) fn submit_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let job = match begin_submission(&job_id, &ssh_config) {
        Ok(job) => job,
        Err(error) => return ApiResponse::error(error),
    };

    let attempt = job.submission.clone().expect("begin_submission creates an attempt");
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

    // Apply the selected layout before upload; never silently submit the original on failure.
    let processed_file_path = if settings.pages_per_sheet > 1 || settings.booklet || !matches!(settings.page_range, PageRange::All) {
        let output_path = std::env::temp_dir().join(format!("layout_{}.pdf", job_id));
        let output_str = output_path.to_string_lossy().to_string();
        if let Err(error) = crate::pdf_service::create_print_layout_cancellable(&base_file_path, &output_str, &settings, || {
            PRINT_JOBS.lock().map(|jobs| jobs.get(&job_id).is_none_or(|job| job.status == PrintJobStatus::Cancelled)).unwrap_or(true)
        }) {
            let _ = std::fs::remove_file(&output_path);
            let message = format!("PDF layout failed: {}", error);
            fail_job(&job_id, message.clone());
            return ApiResponse::error(message);
        }
        output_str
    } else {
        base_file_path.clone()
    };

    // Generate remote file path using job_id (UUID, always safe)
    let remote_path = format!("/tmp/{}.pdf", attempt.id);
    if let Err(error) = advance_stage(&job_id, PrintStage::Uploading) {
        if processed_file_path != base_file_path { let _ = std::fs::remove_file(&processed_file_path); }
        return ApiResponse::error(error);
    }
    let upload_result = crate::ssh_service::upload_with_progress(
        &attempt.account, &processed_file_path, &remote_path, &mut |sent, total| upload_progress(&job_id, sent, total),
    );
    if processed_file_path != base_file_path { let _ = std::fs::remove_file(&processed_file_path); }
    if let Err(error) = upload_result {
        let message = error.to_string();
        fail_job(&job_id, message.clone());
        let _ = crate::ssh_service::ssh_execute_command(ssh_config.clone(), format!("rm -f {}", crate::ssh_service::shell_quote(&remote_path)));
        return ApiResponse::error(message);
    }
    let submit_result = match advance_stage(&job_id, PrintStage::Formatting) {
        Ok(()) => submit_print_job_ssh(&attempt, &printer_name, &remote_path, &settings,
            || advance_stage(&job_id, PrintStage::Submitting)),
        Err(error) => {
            let _ = crate::ssh_service::ssh_execute_command(ssh_config.clone(), format!("rm -f {}", crate::ssh_service::shell_quote(&remote_path)));
            return ApiResponse::error(error);
        }
    };
    if submit_result.is_ok() || submit_result.as_ref().is_err_and(|error| !error.uncertain) {
        let _ = crate::ssh_service::ssh_execute_command(
            ssh_config.clone(),
            format!("rm -f {}", crate::ssh_service::shell_quote(&remote_path)),
        );
    }

    match submit_result {
        Ok(output) => {
            let lpq_job_id = parse_lpr_job_id(&output);
            match update_job(&job_id, |job| {
                job.status = PrintJobStatus::Queued;
                if let Some(progress) = &mut job.progress { progress.stage = PrintStage::Accepted; }
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
            if e.uncertain {
                let _ = advance_stage(&job_id, PrintStage::SubmissionUnknown);
                let _ = update_job(&job_id, |job| {
                    job.status = PrintJobStatus::Queued;
                    job.error = Some(error.clone());
                });
            } else { fail_job(&job_id, error.clone()); }
            ApiResponse::error(error)
        }
    }
}

/// Parse the lpq job ID from lpr output
/// Format: "request id is psts-123 (1 file(s))"
pub(crate) fn parse_lpr_job_id(output: &str) -> Option<String> {
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

pub(crate) fn lpq_job_id_matches(queue_job: &PrintQueueJob, lpq_job_id: &str) -> bool {
    let normalized = crate::ssh_service::normalize_lpq_job_id(lpq_job_id);
    queue_job.job_id == normalized
        || queue_job.job_id == lpq_job_id

}

/// Check printer status via SSH
#[tauri::command]
pub fn print_check_printer_status(
    ssh_config: SSHConfig,
    printer_queue: String,
) -> ApiResponse<Vec<PrintQueueJob>> {
    crate::ssh_service::ssh_check_printer_queue(ssh_config, printer_queue)
}

#[tauri::command]
pub async fn print_get_queue_snapshot(printer_queue: String) -> ApiResponse<QueueSnapshot> {
    match tauri::async_runtime::spawn_blocking(move || crate::ssh_service::queue_snapshot(&printer_queue)).await {
        Ok(Ok(snapshot)) => ApiResponse::success(snapshot),
        Ok(Err(error)) => ApiResponse::error(error),
        Err(error) => ApiResponse::error(error.to_string()),
    }
}

/// Dynamically list available print queues from the connected SoC server
#[tauri::command]
pub async fn print_list_queues(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
    match tauri::async_runtime::spawn_blocking(move || print_list_queues_blocking(ssh_config)).await {
        Ok(result) => result,
        Err(error) => ApiResponse::error(error.to_string()),
    }
}

fn print_list_queues_blocking(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
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
pub async fn print_check_active_jobs(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
    match tauri::async_runtime::spawn_blocking(move || print_check_active_jobs_blocking(ssh_config)).await {
        Ok(result) => result,
        Err(error) => ApiResponse::error(error.to_string()),
    }
}

fn print_check_active_jobs_blocking(ssh_config: SSHConfig) -> ApiResponse<Vec<String>> {
    let account = SSHIdentity::from(&ssh_config);
    let active: Vec<PrintJob> = PRINT_JOBS.lock().unwrap().values()
        .filter(|job| matches!(job.status, PrintJobStatus::Queued | PrintJobStatus::Printing))
        .filter(|job| job.submission.as_ref().is_some_and(|attempt| attempt.account == account))
        .cloned().collect();
    let mut snapshots = HashMap::new();
    let mut completed = Vec::new();
    for job in active {
        let attempt = job.submission.as_ref().unwrap();
        let receipt = if job.lpq_job_id.is_none() || job.progress.as_ref().is_some_and(|p| p.stage == PrintStage::SubmissionUnknown) {
            crate::submission_receipt::read(attempt).ok().flatten()
        } else { None };
        let snapshot = snapshots.entry(job.printer.clone()).or_insert_with(||
            crate::ssh_service::queue_snapshot_for(&account, &job.printer).ok());
        let _ = update_job(&job.id, |current| {
            if current.submission.as_ref().map(|a| &a.id) != Some(&attempt.id) { return; }
            if !matches!(current.status, PrintJobStatus::Queued | PrintJobStatus::Printing) { return; }
            if let Some(receipt) = &receipt { current.accept_receipt(receipt); }
            if let Some(snapshot) = snapshot { current.observe_queue(snapshot); }
            if current.status == PrintJobStatus::Completed { completed.push(current.id.clone()); }
        });
    }
    ApiResponse::success(completed)
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
    #[test]
    fn queue_id_match_is_exact_not_a_substring() {
        let row = PrintQueueJob { rank: "active".into(), owner: "alice".into(), job_id: "1234".into(), file: "notes-123.pdf".into(), total_size: None, raw_line: "active alice 1234 notes-123.pdf".into() };
        assert!(!lpq_job_id_matches(&row, "123"));
        assert!(lpq_job_id_matches(&row, "psts-1234"));
    }

    #[test]
    fn cancellation_closes_before_submission_and_stays_closed() {
        for stage in [PrintStage::Preparing, PrintStage::Uploading, PrintStage::Formatting] { assert!(stage.cancellable()); }
        for stage in [PrintStage::Submitting, PrintStage::Accepted, PrintStage::SubmissionUnknown, PrintStage::LeftQueue] { assert!(!stage.cancellable()); }
    }

}
