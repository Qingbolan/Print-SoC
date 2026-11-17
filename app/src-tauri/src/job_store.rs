//! Shared per-job records for desktop, native service and agent processes.
use crate::types::PrintJob;
use fs2::FileExt;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

fn root() -> Result<PathBuf, String> {
    crate::storage_service::get_app_data_dir()
        .map(|p| p.join("jobs"))
        .ok_or("Application data unavailable".into())
}
fn native_root() -> Result<PathBuf, String> {
    Ok(root()?.with_file_name("native-jobs"))
}
fn native_record_exists(native: &Path, id: &str) -> bool {
    native.join(format!("{id}.json")).exists() || native.join(format!("{id}.deleted")).exists()
}
fn record_root(id: &str) -> Result<PathBuf, String> {
    let native = native_root()?;
    Ok(if native_record_exists(&native, id) {
        native
    } else {
        root()?
    })
}
pub fn recovery_owned(job: &PrintJob) -> bool {
    // Pre-lease native services own their own recovery. Do not classify a live
    // installed worker as crashed merely because it predates submission leases.
    job.native.is_none() || root().is_ok_and(|p| p.join(format!("{}.worker", job.id)).exists())
}
fn valid_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "Invalid shared job ID".into())
}
pub fn merge(jobs: &mut HashMap<String, PrintJob>) -> Result<(), String> {
    merge_from(&root()?, jobs)?;
    merge_from(&native_root()?, jobs)
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
            .map_err(|e| format!("Invalid shared job record: {e}"))?;
        valid_id(&job.id)?;
        if root.join(format!("{}.deleted", job.id)).exists() {
            jobs.remove(&job.id);
            continue;
        }
        if path.file_stem().and_then(|s| s.to_str()) != Some(job.id.as_str()) {
            return Err("Invalid shared job ownership".into());
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
    save_partitioned(&root()?, &native_root()?, job)
}

/// Keep native records in their established partition so an already installed
/// driver sees cancellation immediately and never encounters ordinary jobs.
fn save_partitioned(root: &Path, native: &Path, job: &PrintJob) -> Result<(), String> {
    valid_id(&job.id)?;
    let _lock = lock_store(root)?;
    if job.native.is_some() || native_record_exists(native, &job.id) {
        let ordinary = root.join(format!("{}.json", job.id));
        if root.join(format!("{}.deleted", job.id)).exists() {
            return Err("Job was deleted".into());
        }
        if ordinary.exists() {
            let previous: PrintJob =
                serde_json::from_slice(&fs::read(&ordinary).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if previous.status == crate::types::PrintJobStatus::Cancelled {
                return Err("Job was cancelled".into());
            }
            if previous.updated_at > job.updated_at {
                return Err("Job changed while attaching native origin".into());
            }
        }
        save_to(native, job)?;
        if ordinary.exists() {
            fs::remove_file(ordinary).map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        save_locked(root, job)
    }
}
fn lock_store(root: &Path) -> Result<ExclusiveLock, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".lock"))
        .map_err(|e| e.to_string())?;
    lock.lock_exclusive()
        .map_err(|e| format!("Cannot lock job store: {e}"))?;
    Ok(ExclusiveLock(lock))
}
fn save_to(root: &Path, job: &PrintJob) -> Result<(), String> {
    let _lock = lock_store(root)?;
    save_locked(root, job)
}
fn save_locked(root: &Path, job: &PrintJob) -> Result<(), String> {
    valid_id(&job.id)?;
    if root.join(format!("{}.deleted", job.id)).exists() {
        if job.status == crate::types::PrintJobStatus::Uploading {
            return Err("Job was deleted".into());
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
        if previous.native.is_some() && job.native.is_none() {
            return Err("Native origin changed; reload the job before modifying it".into());
        }
        // Cancellation and the irreversible submit boundary are arbitrated
        // under the same cross-process lock, not by wall-clock timestamps.
        if previous.status == crate::types::PrintJobStatus::Cancelled
            && job.status != previous.status
        {
            return Err("Job was cancelled".into());
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
    let ordinary = root()?;
    let _ordinary_lock = lock_store(&ordinary)?;
    let root = record_root(id)?;
    let _native_lock = if root != ordinary {
        Some(lock_store(&root)?)
    } else {
        None
    };
    let path = root.join(format!("{id}.json"));
    if path.exists() {
        let latest: PrintJob = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if !latest.can_delete() {
            return Err(
                "Cancel or resolve this active shared job before deleting its history".into(),
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
    valid_id(id)?;
    let root = record_root(id)?;
    if root.join(format!("{id}.deleted")).exists() {
        return Err("Job was deleted".into());
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
    fn ordinary_jobs_are_shared_and_submission_leases_exclude_other_workers() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job();
        job.native = None;
        save_to(root.path(), &job).unwrap();
        let mut peer = HashMap::new();
        merge_from(root.path(), &mut peer).unwrap();
        assert!(peer[&job.id].native.is_none());
        let lease = acquire_submission_at(root.path(), &job.id).unwrap();
        assert!(acquire_submission_at(root.path(), &job.id).is_err());
        drop(lease);
        assert!(acquire_submission_at(root.path(), &job.id).is_ok());
    }
    #[test]
    fn installed_native_workers_keep_their_partition_and_observe_cancellation() {
        let directory = tempfile::tempdir().unwrap();
        let ordinary = directory.path().join("jobs");
        let native = directory.path().join("native-jobs");
        let mut spool = job();
        let origin = spool.native.take();
        save_partitioned(&ordinary, &native, &spool).unwrap();
        assert!(!native.exists());
        spool.native = origin;
        spool.updated_at += chrono::Duration::seconds(1);
        save_partitioned(&ordinary, &native, &spool).unwrap();
        assert!(!ordinary.join(format!("{}.json", spool.id)).exists());
        let mut installed_worker = HashMap::new();
        merge_from(&native, &mut installed_worker).unwrap();
        assert!(installed_worker.values().all(|job| job.native.is_some()));
        let mut submitting = spool.clone();
        spool
            .request_status(crate::types::PrintJobStatus::Cancelled, None)
            .unwrap();
        // The fixture had a future timestamp; advance monotonically.
        spool.updated_at = submitting.updated_at + chrono::Duration::seconds(1);
        save_partitioned(&ordinary, &native, &spool).unwrap();
        merge_from(&native, &mut installed_worker).unwrap();
        assert_eq!(
            installed_worker[&spool.id].status,
            crate::types::PrintJobStatus::Cancelled
        );
        submitting.updated_at = spool.updated_at + chrono::Duration::seconds(1);
        assert!(save_to(&native, &submitting).is_err());
        let mut ordinary_job = job();
        ordinary_job.native = None;
        save_partitioned(&ordinary, &native, &ordinary_job).unwrap();
        merge_from(&native, &mut installed_worker).unwrap();
        assert!(!installed_worker.contains_key(&ordinary_job.id));
    }
    #[test]
    fn record_ids_cannot_escape_the_job_directory() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job();
        job.id = "../outside".into();
        assert!(save_to(root.path(), &job).is_err());
    }
}

/// Hold this lease for the entire submission. Other processes may observe it,
/// but cannot submit the same job or recover a live worker as interrupted.
pub fn acquire_submission(id: &str) -> Result<ExclusiveLock, String> {
    valid_id(id)?;
    acquire_submission_at(&root()?, id)
}
fn acquire_submission_at(root: &Path, id: &str) -> Result<ExclusiveLock, String> {
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let lease = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(format!("{id}.worker")))
        .map_err(|e| e.to_string())?;
    lease
        .try_lock_exclusive()
        .map_err(|_| "This job already has an active submission worker")?;
    Ok(ExclusiveLock(lease))
}

/// Explicit unlock prevents a concurrently forked converter from extending a
/// completed worker's lease until its inherited descriptor reaches exec/exit.
pub struct ExclusiveLock(fs::File);
impl Drop for ExclusiveLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}
