use crate::types::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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
    let history_dir =
        get_history_dir().ok_or_else(|| "Failed to get history directory path".to_string())?;
    let backups_dir =
        get_backups_dir().ok_or_else(|| "Failed to get backups directory path".to_string())?;

    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create history directory: {}", e))?;
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backups directory: {}", e))?;

    Ok(())
}

/// Import the previous history once, then read the shared cross-process store.
pub fn load_print_history() -> Result<HashMap<String, PrintJob>, String> {
    use fs2::FileExt;
    ensure_directories()?;
    let history_path = get_history_file_path().ok_or("History directory unavailable")?;
    let migration = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(history_path.with_extension("migration.lock"))
        .map_err(|e| e.to_string())?;
    migration.lock_exclusive().map_err(|e| e.to_string())?;
    if history_path.exists() {
        let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
        let jobs: Vec<PrintJob> = if content.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&content).map_err(|e| format!("Invalid legacy history: {e}"))?
        };
        // Never recover or advance timestamps while importing: a live service
        // may already have a newer record or a deletion tombstone.
        for job in jobs {
            crate::job_store::save(&job)?;
        }
        fs::rename(&history_path, history_path.with_extension("migrated.json"))
            .map_err(|e| e.to_string())?;
    }
    drop(migration);
    let mut jobs = HashMap::new();
    crate::job_store::merge(&mut jobs)?;
    for id in jobs.keys().cloned().collect::<Vec<_>>() {
        // An active worker owns recovery. Refresh after acquiring its lease to
        // avoid recovering a stale snapshot of a job that just finished.
        let Ok(_lease) = crate::job_store::acquire_submission(&id) else {
            continue;
        };
        if crate::job_store::refresh(&mut jobs, &id).is_err() {
            jobs.remove(&id);
            continue;
        }
        let Some(job) = jobs.get_mut(&id) else {
            continue;
        };
        let mut changed = job.recover_interrupted();
        if !Path::new(&job.file_path).exists() {
            if let Some(path) = get_backup_file_path(&id) {
                job.file_path = path.to_string_lossy().into_owned();
                job.updated_at = chrono::Utc::now();
                changed = true;
            }
        }
        if changed {
            crate::job_store::save(job)?;
        }
    }
    Ok(jobs)
}

/// Save print history to JSON file (atomic write)
pub fn save_print_history(jobs: &HashMap<String, PrintJob>) -> Result<(), String> {
    ensure_directories()?;

    for job in jobs.values() {
        crate::job_store::save(job)?;
    }
    Ok(())
}

/// Backup a PDF file to the backups directory
pub fn backup_pdf_file(job_id: &str, source_path: &str) -> Result<PathBuf, String> {
    ensure_directories()?;

    let backups_dir =
        get_backups_dir().ok_or_else(|| "Failed to get backups directory path".to_string())?;

    let job_backup_dir = backups_dir.join(job_id);
    fs::create_dir_all(&job_backup_dir)
        .map_err(|e| format!("Failed to create job backup directory: {}", e))?;

    let backup_path = job_backup_dir.join("original.pdf");

    fs::copy(source_path, &backup_path).map_err(|e| format!("Failed to copy PDF file: {}", e))?;

    eprintln!(
        "[Storage] Backed up PDF for job {} to {:?}",
        job_id, backup_path
    );
    Ok(backup_path)
}

/// Delete PDF backup for a job
pub fn delete_pdf_backup(job_id: &str) -> Result<(), String> {
    let preview = crate::pdf_service::job_layout_path(job_id)?;
    if preview.exists() { fs::remove_file(preview).map_err(|e|e.to_string())?; }
    let backups_dir =
        get_backups_dir().ok_or_else(|| "Failed to get backups directory path".to_string())?;

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
    let data_dir =
        get_app_data_dir().ok_or_else(|| "Failed to get app data directory".to_string())?;
    let history_dir =
        get_history_dir().ok_or_else(|| "Failed to get history directory".to_string())?;
    let backups_dir =
        get_backups_dir().ok_or_else(|| "Failed to get backups directory".to_string())?;

    let history_size = get_dir_size(&history_dir) + get_dir_size(&data_dir.join("native-jobs"));
    let backups_size = get_dir_size(&backups_dir) + get_dir_size(&data_dir.join("previews"));
    let total_size = history_size + backups_size + get_dir_size(&data_dir.join("imports"));

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
            PrintJobStatus::Pending
                | PrintJobStatus::Uploading
                | PrintJobStatus::Queued
                | PrintJobStatus::Printing
        ) || job.created_at > cutoff;

        if !keep {
            if crate::job_store::delete(id).is_err() {
                return true;
            }
            removed_ids.push(id.clone());
            // Clean up backup
            let _ = delete_pdf_backup(id);
        }

        keep
    });

    removed_ids
}
