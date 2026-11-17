use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ========== SSH Authentication ==========
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SSHAuthType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SSHAuthType {
    StoredPassword,
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
}

/// Non-secret ownership of a remote submission. Never persist SSH credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SSHIdentity {
    pub host: String,
    pub port: u16,
    pub username: String,
}
impl From<&SSHConfig> for SSHIdentity {
    fn from(config: &SSHConfig) -> Self {
        Self { host: config.host.to_lowercase(), port: config.port, username: config.username.clone() }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionAttempt {
    pub id: String,
    pub account: SSHIdentity,
}

// ========== Print Job ==========
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintJob {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub printer: String,
    pub settings: PrintSettings,
    pub status: PrintJobStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub error: Option<String>,
    /// The job ID assigned by lpq (e.g., "psts-123")
    pub lpq_job_id: Option<String>,
    #[serde(default)]
    pub progress: Option<PrintProgress>,
    #[serde(default)]
    pub submission: Option<SubmissionAttempt>,
    #[serde(default)]
    pub native: Option<NativePrintInfo>,
    #[serde(default)]
    pub tracking: Option<JobTracking>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativePrintInfo {
    pub cups_job_id: String,
    pub options: std::collections::BTreeMap<String, String>,
}
impl PrintJob {
    /// History follows submission time; later status refreshes never reorder it.
    pub fn newest_first(a: &Self, b: &Self) -> std::cmp::Ordering {
        b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id))
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;
    #[test]
    fn unordered_history_is_newest_first_with_stable_ties() {
        let job = |id: &str, seconds| PrintJob {
            id: id.into(), name: "test".into(), file_path: "test.pdf".into(), printer: "psts".into(),
            settings: PrintSettings { copies: 1, duplex: DuplexMode::Simplex, orientation: Orientation::Portrait,
                page_range: PageRange::All, pages_per_sheet: 1, booklet: false, paper_size: PaperSize::A4 },
            status: PrintJobStatus::Completed, created_at: DateTime::from_timestamp(seconds, 0).unwrap(),
            updated_at: Utc::now(), error: None, lpq_job_id: None, progress: None, submission: None, native: None, tracking: None,
        };
        let mut jobs = vec![job("old", 100), job("b", 300), job("middle", 200), job("a", 300)];
        jobs.sort_by(PrintJob::newest_first);
        assert_eq!(jobs.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(), vec!["a", "b", "middle", "old"]);
        let stored = serde_json::to_vec(&jobs).unwrap();
        let restored: Vec<PrintJob> = serde_json::from_slice(&stored).unwrap();
        assert_eq!(restored.first().unwrap().id, "a");
        assert_eq!(restored.last().unwrap().id, "old");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintSettings {
    pub copies: u32,
    pub duplex: DuplexMode,
    pub orientation: Orientation,
    pub page_range: PageRange,
    pub pages_per_sheet: u32,
    pub booklet: bool,
    pub paper_size: PaperSize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DuplexMode {
    Simplex,
    DuplexLongEdge,
    DuplexShortEdge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Orientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PageRange {
    All,
    Range { start: u32, end: u32 },
    Selection { pages: Vec<u32> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaperSize {
    A4,
    A3,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrintJobStatus {
    Pending,
    Uploading,
    Queued,
    Printing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobTracking {
    pub checked_at: DateTime<Utc>,
    pub queue_position: Option<u32>,
    pub jobs_ahead: Option<u32>,
    pub stale: bool,
    pub error: Option<String>,
    pub evidence: String,
    pub device_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintQueueJob {
    pub rank: String,
    pub owner: String,
    pub job_id: String,
    pub file: String,
    pub total_size: Option<String>,
    pub raw_line: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintQuota {
    pub raw_output: String,
    pub summary: Option<String>,
    pub balance: Option<String>,
    pub used: Option<String>,
    pub limit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueSnapshot {
    pub status: String,
    pub jobs: Vec<PrintQueueJob>,
    pub diagnostics: Vec<String>,
    pub raw_output: String,
    pub checked_at: DateTime<Utc>,
    pub jobs_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrintStage { Preparing, Uploading, Formatting, Submitting, Accepted, SubmissionUnknown, LeftQueue, OutputConfirmed }

impl PrintStage {
    pub fn cancellable(&self) -> bool {
        matches!(self, Self::Preparing | Self::Uploading | Self::Formatting)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintProgress {
    pub stage: PrintStage,
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

// ========== API Responses ==========
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

// ========== PDF Processing ==========
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PDFInfo {
    pub num_pages: u32,
    pub page_size: (f64, f64),
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookletLayout {
    pub total_sheets: u32,
    pub pages_per_sheet: u32,
    pub page_order: Vec<Vec<Option<u32>>>,
}

// ========== Storage Info ==========
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub data_dir: String,
    pub history_size: u64,
    pub backups_size: u64,
    pub total_size: u64,
    pub backup_count: usize,
}
