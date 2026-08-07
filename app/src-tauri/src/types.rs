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
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
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
pub struct PrintQueueJob {
    pub rank: String,
    pub owner: String,
    pub job_id: String,
    pub file: String,
    pub total_size: Option<String>,
    pub raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintQuota {
    pub raw_output: String,
    pub summary: Option<String>,
    pub balance: Option<String>,
    pub used: Option<String>,
    pub limit: Option<String>,
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
