use crate::types::*;
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use lazy_static::lazy_static;

// ========== Persistent SSH Connection Manager ==========

/// Manages a persistent SSH connection throughout the application lifecycle
struct SSHConnectionManager {
    session: Option<Session>,
    config: Option<SSHConfig>,
    last_activity: Instant,
}

impl SSHConnectionManager {
    fn new() -> Self {
        Self {
            session: None,
            config: None,
            last_activity: Instant::now(),
        }
    }

    fn is_connected(&self) -> bool {
        self.session.is_some()
    }

    fn update_activity(&mut self) {
        self.last_activity = Instant::now();
    }

    #[allow(dead_code)]
    fn get_config(&self) -> Option<SSHConfig> {
        self.config.clone()
    }
}

lazy_static! {
    static ref SSH_MANAGER: Arc<Mutex<SSHConnectionManager>> = Arc::new(Mutex::new(SSHConnectionManager::new()));
}

/// Connect to SSH server and establish persistent connection
#[tauri::command]
pub fn ssh_connect(config: SSHConfig) -> ApiResponse<String> {
    match connect_persistent(&config) {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Disconnect from SSH server
#[tauri::command]
pub fn ssh_disconnect() -> ApiResponse<String> {
    match disconnect_persistent() {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Get current SSH connection status
#[tauri::command]
pub fn ssh_connection_status() -> ApiResponse<bool> {
    let manager = SSH_MANAGER.lock().unwrap();
    ApiResponse::success(manager.is_connected())
}

/// Test SSH connection with given configuration
#[tauri::command]
pub fn ssh_test_connection(config: SSHConfig) -> ApiResponse<String> {
    match test_ssh_connection_internal(&config) {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Execute a command via SSH (uses persistent connection if available)
#[tauri::command]
pub fn ssh_execute_command(config: SSHConfig, command: String) -> ApiResponse<String> {
    // Try to use persistent connection first
    match execute_with_persistent_session(&command) {
        Ok(output) => return ApiResponse::success(output),
        Err(_) => {
            // Fall back to creating a new connection if persistent connection is not available
            match execute_ssh_command_internal(&config, &command) {
                Ok(output) => ApiResponse::success(output),
                Err(e) => ApiResponse::error(e.to_string()),
            }
        }
    }
}

/// Upload a file via SSH/SCP (uses persistent connection if available)
#[tauri::command]
pub fn ssh_upload_file(
    config: SSHConfig,
    local_path: String,
    remote_path: String,
) -> ApiResponse<String> {
    // Try to use persistent connection first
    match upload_with_persistent_session(&local_path, &remote_path) {
        Ok(_) => return ApiResponse::success(format!("File uploaded to {}", remote_path)),
        Err(_) => {
            // Fall back to creating a new connection if persistent connection is not available
            match upload_file_internal(&config, &local_path, &remote_path) {
                Ok(_) => ApiResponse::success(format!("File uploaded to {}", remote_path)),
                Err(e) => ApiResponse::error(e.to_string()),
            }
        }
    }
}

/// Check printer queue status via SSH (uses persistent connection if available)
#[tauri::command]
pub fn ssh_check_printer_queue(config: SSHConfig, printer: String) -> ApiResponse<Vec<String>> {
    let command = format!("lpq -P {}", printer);

    // Try to use persistent connection first, fall back to new connection
    let output = match execute_with_persistent_session(&command) {
        Ok(output) => output,
        Err(_) => {
            match execute_ssh_command_internal(&config, &command) {
                Ok(output) => output,
                Err(e) => return ApiResponse::error(e.to_string()),
            }
        }
    };

    // Parse lpq output to extract actual print jobs
    // lpq output format:
    // Printer: printer@host
    // Queue: X printable jobs (or "no printable jobs in queue")
    // Rank    Owner   Job     File(s)                         Total Size
    // 1st     user1   123     document.pdf                    1024 bytes
    // 2nd     user2   124     file.pdf                        2048 bytes

    let jobs: Vec<String> = output
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            // Skip empty lines
            if trimmed.is_empty() {
                return false;
            }
            // Skip header lines
            if trimmed.starts_with("Printer:") ||
               trimmed.starts_with("Queue:") ||
               trimmed.starts_with("Rank") {
                return false;
            }
            // Check if line starts with a rank indicator
            // Valid ranks: 1st, 2nd, 3rd, 4th, 5th, ..., 21st, 22nd, etc.
            if let Some(first_word) = trimmed.split_whitespace().next() {
                return first_word.ends_with("st") ||
                       first_word.ends_with("nd") ||
                       first_word.ends_with("rd") ||
                       first_word.ends_with("th");
            }
            false
        })
        .map(|s| s.to_string())
        .collect();

    ApiResponse::success(jobs)
}

// ========== Internal Implementation ==========

const MAX_RETRIES: u32 = 3;
const CONNECTION_TIMEOUT_SECS: u64 = 30;  // Increased from 10s to 30s
const RETRY_DELAY_MS: u64 = 2000;  // Increased from 1s to 2s

fn create_ssh_session(config: &SSHConfig) -> Result<Session, Box<dyn std::error::Error>> {
    create_ssh_session_with_retry(config, MAX_RETRIES)
}

fn create_ssh_session_with_retry(
    config: &SSHConfig,
    max_retries: u32,
) -> Result<Session, Box<dyn std::error::Error>> {
    let mut last_error: Option<Box<dyn std::error::Error>> = None;

    for attempt in 1..=max_retries {
        match try_create_ssh_session(config) {
            Ok(session) => return Ok(session),
            Err(e) => {
                last_error = Some(e);
                if attempt < max_retries {
                    std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }
    }

    Err(format!(
        "Failed to connect after {} attempts: {}",
        max_retries,
        last_error.unwrap()
    )
    .into())
}

fn try_create_ssh_session(config: &SSHConfig) -> Result<Session, Box<dyn std::error::Error>> {
    use std::net::ToSocketAddrs;

    // Resolve hostname to socket address
    let addr_string = format!("{}:{}", config.host, config.port);
    let mut addrs = addr_string.to_socket_addrs()
        .map_err(|e| format!("Failed to resolve hostname {}: {}", config.host, e))?;

    let socket_addr = addrs.next()
        .ok_or_else(|| format!("No IP address found for hostname: {}", config.host))?;

    // Connect with timeout
    let tcp = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(CONNECTION_TIMEOUT_SECS))?;

    // Set read/write timeouts
    tcp.set_read_timeout(Some(Duration::from_secs(CONNECTION_TIMEOUT_SECS)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(CONNECTION_TIMEOUT_SECS)))?;

    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(CONNECTION_TIMEOUT_SECS as u32 * 1000); // milliseconds
    sess.handshake()?;

    match &config.auth_type {
        SSHAuthType::Password { password } => {
            sess.userauth_password(&config.username, password)?;
        }
        SSHAuthType::PrivateKey { key_path, passphrase } => {
            sess.userauth_pubkey_file(
                &config.username,
                None,
                Path::new(key_path),
                passphrase.as_deref(),
            )?;
        }
    }

    if !sess.authenticated() {
        return Err("SSH authentication failed".into());
    }

    Ok(sess)
}

fn test_ssh_connection_internal(config: &SSHConfig) -> Result<String, Box<dyn std::error::Error>> {
    let sess = create_ssh_session(config)?;

    let mut channel = sess.channel_session()?;
    channel.exec("echo 'Connection successful'")?;

    let mut output = String::new();
    channel.read_to_string(&mut output)?;
    channel.wait_close()?;

    Ok(output.trim().to_string())
}

fn execute_ssh_command_internal(
    config: &SSHConfig,
    command: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let sess = create_ssh_session(config)?;

    let mut channel = sess.channel_session()?;
    channel.exec(command)?;

    let mut output = String::new();
    channel.read_to_string(&mut output)?;

    // Also read stderr
    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr)?;

    channel.wait_close()?;
    let exit_status = channel.exit_status()?;

    if exit_status != 0 {
        return Err(format!("Command failed with status {}: {}", exit_status, stderr).into());
    }

    Ok(output)
}

fn upload_file_internal(
    config: &SSHConfig,
    local_path: &str,
    remote_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let sess = create_ssh_session(config)?;

    let local_file = std::fs::File::open(local_path)?;
    let metadata = local_file.metadata()?;
    let file_size = metadata.len();

    let mut remote_file = sess.scp_send(
        Path::new(remote_path),
        0o644,
        file_size,
        None,
    )?;

    std::io::copy(&mut std::io::BufReader::new(local_file), &mut remote_file)?;

    Ok(())
}

/// Submit a print job via SSH lpr command
pub fn submit_print_job_ssh(
    config: &SSHConfig,
    printer: &str,
    remote_file_path: &str,
    settings: &PrintSettings,
) -> Result<String, Box<dyn std::error::Error>> {
    // NUS SoC Rule: Duplex is controlled by queue name, not lpr options
    // - Duplex (double-sided): use queues without -sx suffix (e.g., psts, pstsb)
    // - Simplex (single-sided): use queues with -sx suffix (e.g., psts-sx, pstsb-sx)

    let actual_printer = match settings.duplex {
        DuplexMode::Simplex => {
            // Single-sided: ensure queue has -sx suffix
            if printer.ends_with("-sx") {
                printer.to_string()
            } else if printer.ends_with("-nb") {
                // Keep -nb suffix, don't change
                printer.to_string()
            } else {
                // Add -sx suffix for single-sided
                format!("{}-sx", printer)
            }
        }
        DuplexMode::DuplexLongEdge | DuplexMode::DuplexShortEdge => {
            // Double-sided: ensure queue does NOT have -sx suffix
            if printer.ends_with("-sx") {
                // Remove -sx suffix for double-sided
                printer.trim_end_matches("-sx").to_string()
            } else {
                printer.to_string()
            }
        }
    };

    // Build lpr command according to NUS SoC documentation
    let mut lpr_command = format!("lpr -P {}", actual_printer);

    // Add copies (using -# notation as per SoC docs)
    if settings.copies > 1 {
        lpr_command.push_str(&format!(" -\\# {}", settings.copies));
    }

    // Do NOT add -o sides options - NUS SoC controls this via queue selection

    // Add orientation
    match settings.orientation {
        Orientation::Landscape => lpr_command.push_str(" -o landscape"),
        Orientation::Portrait => lpr_command.push_str(" -o portrait"),
    }

    // Add paper size (media)
    // Common media names are generally accepted by CUPS/LPD. Map directly for A4, A3.
    let media = match settings.paper_size {
        PaperSize::A4 => Some("A4"),
        PaperSize::A3 => Some("A3"),
    };
    if let Some(m) = media {
        lpr_command.push_str(&format!(" -o media={}", m));
    }

    // Note: pages_per_sheet should be handled via pdfjam BEFORE uploading
    // We don't use -o number-up in lpr as pdfjam does better job

    // Page ranges (CUPS)
    match &settings.page_range {
        PageRange::All => {}
        PageRange::Range { start, end } => {
            if *start >= 1 && *end >= *start {
                lpr_command.push_str(&format!(" -o page-ranges={}-{}", start, end));
            }
        }
        PageRange::Selection { pages } => {
            if !pages.is_empty() {
                let list = pages
                    .iter()
                    .filter(|p| **p >= 1)
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                if !list.is_empty() {
                    lpr_command.push_str(&format!(" -o page-ranges={}", list));
                }
            }
        }
    }

    // Add the file
    lpr_command.push_str(&format!(" {}", remote_file_path));

    execute_ssh_command_internal(config, &lpr_command)
}

// ========== Persistent Connection Implementation ==========

const KEEPALIVE_INTERVAL_SECS: u32 = 30;

/// Connect and store a persistent SSH session
fn connect_persistent(config: &SSHConfig) -> Result<String, Box<dyn std::error::Error>> {
    let session = create_ssh_session(config)?;

    // Enable keepalive to prevent connection timeout
    session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

    let mut manager = SSH_MANAGER.lock().unwrap();
    manager.session = Some(session);
    manager.config = Some(config.clone());
    manager.update_activity();

    Ok(format!("Connected to {}@{}:{}", config.username, config.host, config.port))
}

/// Disconnect persistent SSH session
fn disconnect_persistent() -> Result<String, Box<dyn std::error::Error>> {
    let mut manager = SSH_MANAGER.lock().unwrap();

    if manager.session.is_none() {
        return Err("No active SSH connection".into());
    }

    // Drop the session to close the connection
    manager.session = None;
    manager.config = None;

    Ok("Disconnected from SSH server".to_string())
}

/// Get the persistent session, reconnecting if necessary
fn get_persistent_session() -> Result<(), Box<dyn std::error::Error>> {
    let mut manager = SSH_MANAGER.lock().unwrap();

    // Check if we have a session
    if manager.session.is_none() {
        return Err("No active SSH connection. Please connect first.".into());
    }

    // Check if the session is still alive
    if let Some(ref session) = manager.session {
        // Try a simple keepalive check
        match session.keepalive_send() {
            Ok(_) => {
                manager.update_activity();
                return Ok(());
            }
            Err(_) => {
                // Connection lost, try to reconnect
                if let Some(ref config) = manager.config {
                    let config_clone = config.clone();
                    drop(manager); // Release lock before reconnecting

                    // Try to reconnect
                    match create_ssh_session(&config_clone) {
                        Ok(new_session) => {
                            new_session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);
                            let mut manager = SSH_MANAGER.lock().unwrap();
                            manager.session = Some(new_session);
                            manager.update_activity();
                            return Ok(());
                        }
                        Err(e) => {
                            return Err(format!("Failed to reconnect: {}", e).into());
                        }
                    }
                } else {
                    return Err("Connection lost and no config available for reconnection".into());
                }
            }
        }
    }

    Ok(())
}

/// Execute command using persistent session
fn execute_with_persistent_session(
    command: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    // Ensure we have a valid session
    get_persistent_session()?;

    let manager = SSH_MANAGER.lock().unwrap();
    let session = manager.session.as_ref()
        .ok_or("No active SSH session")?;

    let mut channel = session.channel_session()?;
    channel.exec(command)?;

    let mut output = String::new();
    channel.read_to_string(&mut output)?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr)?;

    channel.wait_close()?;
    let exit_status = channel.exit_status()?;

    if exit_status != 0 {
        return Err(format!("Command failed with status {}: {}", exit_status, stderr).into());
    }

    Ok(output)
}

/// Upload file using persistent session
fn upload_with_persistent_session(
    local_path: &str,
    remote_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure we have a valid session
    get_persistent_session()?;

    let manager = SSH_MANAGER.lock().unwrap();
    let session = manager.session.as_ref()
        .ok_or("No active SSH session")?;

    let local_file = std::fs::File::open(local_path)?;
    let metadata = local_file.metadata()?;
    let file_size = metadata.len();

    let mut remote_file = session.scp_send(
        Path::new(remote_path),
        0o644,
        file_size,
        None,
    )?;

    std::io::copy(&mut std::io::BufReader::new(local_file), &mut remote_file)?;

    Ok(())
}
