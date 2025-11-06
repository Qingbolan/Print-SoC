use crate::ssh_service::submit_print_job_ssh;
use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

// Global state for print jobs
lazy_static::lazy_static! {
    static ref PRINT_JOBS: Mutex<HashMap<String, PrintJob>> = Mutex::new(HashMap::new());
}

/// Create a new print job
#[tauri::command]
pub fn print_create_job(
    name: String,
    file_path: String,
    printer: String,
    settings: PrintSettings,
) -> ApiResponse<PrintJob> {
    let job = PrintJob {
        id: Uuid::new_v4().to_string(),
        name,
        file_path,
        printer,
        settings,
        status: PrintJobStatus::Pending,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        error: None,
    };

    let mut jobs = PRINT_JOBS.lock().unwrap();
    let job_id = job.id.clone();
    jobs.insert(job_id.clone(), job.clone());

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
            ApiResponse::success(job.clone())
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
        Some(_) => ApiResponse::success("Job deleted successfully".to_string()),
        None => ApiResponse::error("Job not found".to_string()),
    }
}

/// Submit a print job via SSH
#[tauri::command]
pub fn print_submit_job(job_id: String, ssh_config: SSHConfig) -> ApiResponse<String> {
    let mut jobs = PRINT_JOBS.lock().unwrap();

    let (file_path, printer_name, job_name) = {
        match jobs.get_mut(&job_id) {
            Some(job) => {
                job.status = PrintJobStatus::Uploading;
                job.updated_at = Utc::now();
                (job.file_path.clone(), job.printer.clone(), job.name.clone())
            }
            None => return ApiResponse::error("Job not found".to_string()),
        }
    };

    // Release lock before SSH operations
    drop(jobs);

    // Generate remote file path and upload
    let remote_path = format!("/tmp/{}", job_name);
    let upload_result = crate::ssh_service::ssh_upload_file(
        ssh_config.clone(),
        file_path,
        remote_path.clone(),
    );

    let mut jobs = PRINT_JOBS.lock().unwrap();
    let job = jobs.get_mut(&job_id).unwrap();

    if !upload_result.success {
        job.status = PrintJobStatus::Failed;
        job.error = upload_result.error;
        job.updated_at = Utc::now();
        return ApiResponse::error("Failed to upload file".to_string());
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
