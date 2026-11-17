//! Per-job native-service records. Atomic snapshots let the desktop observe a
//! separate login service without competing for its monolithic history file.
use crate::types::PrintJob;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
static SERVICE: AtomicBool = AtomicBool::new(false);
pub fn service_mode() -> bool {
    SERVICE.load(Ordering::SeqCst)
}
pub fn enter_service() {
    SERVICE.store(true, Ordering::SeqCst);
}
fn root() -> Result<PathBuf, String> {
    crate::storage_service::get_app_data_dir()
        .map(|p| p.join("native-jobs"))
        .ok_or("Application data unavailable".into())
}
fn valid_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "Invalid native job ID".into())
}
pub fn merge(jobs: &mut HashMap<String, PrintJob>) -> Result<(), String> {
    merge_from(&root()?, jobs)
}
fn merge_from(root: &Path, jobs: &mut HashMap<String, PrintJob>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for file in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = file.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("deleted") {
            if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                jobs.remove(id);
            }
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") || path.is_symlink() {
            continue;
        }
        let job: PrintJob = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid native job record: {e}"))?;
        valid_id(&job.id)?;
        if root.join(format!("{}.deleted", job.id)).exists() {
            jobs.remove(&job.id);
            continue;
        }
        if job.native.is_none()
            || path.file_stem().and_then(|s| s.to_str()) != Some(job.id.as_str())
        {
            return Err("Invalid native job ownership".into());
        }
        if jobs
            .get(&job.id)
            .is_none_or(|old| old.updated_at < job.updated_at)
        {
            jobs.insert(job.id.clone(), job);
        }
    }
    Ok(())
}
pub fn save(job: &PrintJob) -> Result<(), String> {
    save_to(&root()?, job)
}
fn save_to(root: &Path, job: &PrintJob) -> Result<(), String> {
    valid_id(&job.id)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".lock"))
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err("Cannot lock native job store".into());
        }
    }
    if root.join(format!("{}.deleted", job.id)).exists() {
        if job.status == crate::types::PrintJobStatus::Uploading {
            return Err("Native job was deleted".into());
        }
        return Ok(());
    }
    let path = root.join(format!("{}.json", job.id));
    if path.exists() {
        let previous: PrintJob =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if previous.updated_at >= job.updated_at {
            return Ok(());
        }
        // Cancellation and the irreversible submit boundary are arbitrated
        // under the same cross-process lock, not by wall-clock timestamps.
        if previous.status == crate::types::PrintJobStatus::Cancelled
            && job.status != previous.status
        {
            return Err("Native job was cancelled".into());
        }
        if job.status == crate::types::PrintJobStatus::Cancelled
            && matches!(
                previous.status,
                crate::types::PrintJobStatus::Pending
                    | crate::types::PrintJobStatus::Failed
                    | crate::types::PrintJobStatus::Uploading
            )
        {
            let mut candidate = previous;
            candidate.request_status(crate::types::PrintJobStatus::Cancelled, None)?;
        }
    }
    let mut temporary = tempfile::NamedTempFile::new_in(&root).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temporary, job).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn delete(id: &str) -> Result<(), String> {
    valid_id(id)?;
    let root = root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".lock"))
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err("Cannot lock native job store".into());
        }
    }
    let path = root.join(format!("{id}.json"));
    if path.exists() {
        let latest: PrintJob = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if !latest.can_delete() {
            return Err(
                "Cancel or resolve this active native job before deleting its history".into(),
            );
        }
    }
    fs::write(root.join(format!("{id}.deleted")), b"").map_err(|e| e.to_string())?;
    let path = root.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn refresh(jobs: &mut HashMap<String, PrintJob>, id: &str) -> Result<(), String> {
    if jobs.get(id).is_none_or(|job| job.native.is_none()) {
        return Ok(());
    }
    valid_id(id)?;
    let root = root()?;
    if root.join(format!("{id}.deleted")).exists() {
        return Err("Native job was deleted".into());
    }
    let path = root.join(format!("{id}.json"));
    if !path.exists() {
        return Ok(());
    }
    let job: PrintJob = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if jobs
        .get(id)
        .is_none_or(|old| old.updated_at < job.updated_at)
    {
        jobs.insert(id.into(), job);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> PrintJob {
        serde_json::from_value(serde_json::json!({
            "id":uuid::Uuid::new_v4().to_string(),"name":"System document","file_path":"spool.pdf","printer":"psts-dx",
            "settings":{"copies":2,"duplex":"DuplexShortEdge","orientation":"Landscape","page_range":{"type":"All"},"pages_per_sheet":1,"booklet":false,"paper_size":"A3"},
            "status":"Uploading","created_at":chrono::Utc::now(),"updated_at":chrono::Utc::now(),"error":null,"lpq_job_id":null,
            "progress":{"stage":"Uploading","bytes_sent":0,"total_bytes":100},
            "native":{"cups_job_id":"42","options":{"page-ranges":"2-5","number-up":"4"}}
        })).unwrap()
    }
    #[test]
    fn desktop_sees_system_jobs_and_newer_cancellations_survive_stale_service_writes() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job();
        save_to(root.path(), &job).unwrap();
        let mut desktop = HashMap::new();
        merge_from(root.path(), &mut desktop).unwrap();
        assert_eq!(desktop[&job.id].native.as_ref().unwrap().cups_job_id, "42");
        assert_eq!(desktop[&job.id].file_path, "spool.pdf");
        let stale = job.clone();
        job.status = crate::types::PrintJobStatus::Cancelled;
        job.updated_at += chrono::Duration::seconds(1);
        save_to(root.path(), &job).unwrap();
        save_to(root.path(), &stale).unwrap();
        merge_from(root.path(), &mut desktop).unwrap();
        assert_eq!(
            desktop[&job.id].status,
            crate::types::PrintJobStatus::Cancelled
        );
        fs::write(root.path().join(format!("{}.deleted", job.id)), b"").unwrap();
        fs::remove_file(root.path().join(format!("{}.json", job.id))).unwrap();
        job.updated_at += chrono::Duration::seconds(1);
        save_to(root.path(), &job).unwrap();
        merge_from(root.path(), &mut desktop).unwrap();
        assert!(!desktop.contains_key(&job.id));
        job.status = crate::types::PrintJobStatus::Uploading;
        assert!(save_to(root.path(), &job).is_err());
        assert!(!root.path().join(format!("{}.json", job.id)).exists());
    }
    #[test]
    fn cancellation_and_irreversible_submission_cannot_overwrite_each_other() {
        let root = tempfile::tempdir().unwrap();
        let mut cancelled = job();
        save_to(root.path(), &cancelled).unwrap();
        let mut submitting = cancelled.clone();
        cancelled
            .request_status(crate::types::PrintJobStatus::Cancelled, None)
            .unwrap();
        save_to(root.path(), &cancelled).unwrap();
        submitting.progress.as_mut().unwrap().stage = crate::types::PrintStage::Submitting;
        submitting.updated_at = cancelled.updated_at + chrono::Duration::seconds(1);
        assert!(save_to(root.path(), &submitting).is_err());
        let root = tempfile::tempdir().unwrap();
        save_to(root.path(), &submitting).unwrap();
        cancelled.updated_at = submitting.updated_at + chrono::Duration::seconds(1);
        assert!(save_to(root.path(), &cancelled).is_err());
    }
    #[test]
    fn record_ids_cannot_escape_the_job_directory() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job();
        job.id = "../outside".into();
        assert!(save_to(root.path(), &job).is_err());
    }
}
