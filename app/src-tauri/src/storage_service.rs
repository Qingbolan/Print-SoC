use crate::types::*;
use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;

const APP_NAME: &str = "tech.silan.PrintAtSoC";
const HISTORY_FILE: &str = "print_jobs.json";

/// Get the application data directory
/// On macOS: ~/Library/Application Support/tech.silan.PrintAtSoC/
/// On Linux: ~/.local/share/tech.silan.PrintAtSoC/
/// On Windows: C:\Users\<user>\AppData\Roaming\tech.silan.PrintAtSoC\
pub fn get_app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_NAME))
}

/// Get the history directory path
pub fn get_history_dir() -> Option<PathBuf> {
    get_app_data_dir().map(|dir| dir.join("history"))
}

/// Get the backups directory path
pub fn get_backups_dir() -> Option<PathBuf> {
    get_app_data_dir().map(|dir| dir.join("backups"))
}

/// Get the history file path
pub fn get_history_file_path() -> Option<PathBuf> {
    get_history_dir().map(|dir| dir.join(HISTORY_FILE))
}

/// Ensure all required directories exist
pub fn ensure_directories() -> Result<(), String> {
    let history_dir = get_history_dir()
        .ok_or_else(|| "Failed to get history directory path".to_string())?;
    let backups_dir = get_backups_dir()
        .ok_or_else(|| "Failed to get backups directory path".to_string())?;

    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create history directory: {}", e))?;
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backups directory: {}", e))?;

    Ok(())
}

/// Load print history from JSON file
pub fn load_print_history() -> Result<HashMap<String, PrintJob>, String> {
    let history_path = get_history_file_path()
        .ok_or_else(|| "Failed to get history file path".to_string())?;

    if !history_path.exists() {
        eprintln!("[Storage] History file does not exist, returning empty history");
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&history_path)
        .map_err(|e| format!("Failed to read history file: {}", e))?;

    if content.trim().is_empty() {
        return Ok(HashMap::new());
    }

    let jobs: Vec<PrintJob> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse history JSON: {}", e))?;

    let mut map = HashMap::new();
    for job in jobs {
        map.insert(job.id.clone(), job);
    }

    eprintln!("[Storage] Loaded {} print jobs from history", map.len());
    Ok(map)
}

/// Save print history to JSON file (atomic write)
pub fn save_print_history(jobs: &HashMap<String, PrintJob>) -> Result<(), String> {
    ensure_directories()?;

    let history_path = get_history_file_path()
        .ok_or_else(|| "Failed to get history file path".to_string())?;

    // Convert HashMap to Vec for serialization
    let jobs_vec: Vec<&PrintJob> = jobs.values().collect();

    let content = serde_json::to_string_pretty(&jobs_vec)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    // Atomic write: write to temp file first, then rename
    let temp_path = history_path.with_extension("json.tmp");

    fs::write(&temp_path, &content)
        .map_err(|e| format!("Failed to write temp history file: {}", e))?;

    fs::rename(&temp_path, &history_path)
        .map_err(|e| format!("Failed to rename history file: {}", e))?;

    eprintln!("[Storage] Saved {} print jobs to history", jobs.len());
    Ok(())
}

/// Backup a PDF file to the backups directory
pub fn backup_pdf_file(job_id: &str, source_path: &str) -> Result<PathBuf, String> {
    ensure_directories()?;

    let backups_dir = get_backups_dir()
        .ok_or_else(|| "Failed to get backups directory path".to_string())?;

    let job_backup_dir = backups_dir.join(job_id);
    fs::create_dir_all(&job_backup_dir)
        .map_err(|e| format!("Failed to create job backup directory: {}", e))?;

    let backup_path = job_backup_dir.join("original.pdf");

    fs::copy(source_path, &backup_path)
        .map_err(|e| format!("Failed to copy PDF file: {}", e))?;

    eprintln!("[Storage] Backed up PDF for job {} to {:?}", job_id, backup_path);
    Ok(backup_path)
}

/// Delete PDF backup for a job
pub fn delete_pdf_backup(job_id: &str) -> Result<(), String> {
    let backups_dir = get_backups_dir()
        .ok_or_else(|| "Failed to get backups directory path".to_string())?;

    let job_backup_dir = backups_dir.join(job_id);

    if job_backup_dir.exists() {
        fs::remove_dir_all(&job_backup_dir)
            .map_err(|e| format!("Failed to delete backup directory: {}", e))?;
        eprintln!("[Storage] Deleted backup for job {}", job_id);
    }

    Ok(())
}

/// Get the backup file path for a job
pub fn get_backup_file_path(job_id: &str) -> Option<PathBuf> {
    let backups_dir = get_backups_dir()?;
    let backup_path = backups_dir.join(job_id).join("original.pdf");

    if backup_path.exists() {
        Some(backup_path)
    } else {
        None
    }
}

/// Calculate the total size of a directory
fn get_dir_size(path: &PathBuf) -> u64 {
    if !path.exists() {
        return 0;
    }

    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// Get storage information
pub fn get_storage_info() -> Result<StorageInfo, String> {
    let data_dir = get_app_data_dir()
        .ok_or_else(|| "Failed to get app data directory".to_string())?;
    let history_dir = get_history_dir()
        .ok_or_else(|| "Failed to get history directory".to_string())?;
    let backups_dir = get_backups_dir()
        .ok_or_else(|| "Failed to get backups directory".to_string())?;

    let history_size = get_dir_size(&history_dir);
    let backups_size = get_dir_size(&backups_dir);
    let total_size = history_size + backups_size;

    // Count backup files
    let backup_count = if backups_dir.exists() {
        fs::read_dir(&backups_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };

    Ok(StorageInfo {
        data_dir: data_dir.to_string_lossy().to_string(),
        history_size,
        backups_size,
        total_size,
        backup_count,
    })
}

/// Clean up old history entries (keep only last N days)
pub fn cleanup_old_history(jobs: &mut HashMap<String, PrintJob>, days: i64) -> Vec<String> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
    let mut removed_ids = Vec::new();

    jobs.retain(|id, job| {
        // Keep jobs that are still in progress
        let keep = matches!(
            job.status,
            PrintJobStatus::Pending | PrintJobStatus::Uploading | PrintJobStatus::Queued | PrintJobStatus::Printing
        ) || job.created_at > cutoff;

        if !keep {
            removed_ids.push(id.clone());
            // Clean up backup
            let _ = delete_pdf_backup(id);
        }

        keep
    });

    removed_ids
}
