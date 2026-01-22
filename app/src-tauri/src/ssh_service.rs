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
    match SSH_MANAGER.lock() {
        Ok(manager) => ApiResponse::success(manager.is_connected()),
        Err(_) => ApiResponse::success(false), // If lock fails, assume disconnected
    }
}

/// Test SSH connection with given configuration
#[tauri::command]
pub fn ssh_test_connection(config: SSHConfig) -> ApiResponse<String> {
    match test_ssh_connection_internal(&config) {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Execute a command via SSH (uses persistent connection)
#[tauri::command]
pub fn ssh_execute_command(_config: SSHConfig, command: String) -> ApiResponse<String> {
    match execute_with_persistent_session(&command) {
        Ok(output) => ApiResponse::success(output),
        Err(e) => ApiResponse::error(format!("SSH command failed: {}. Please reconnect.", e)),
    }
}

/// Upload a file via SSH/SCP (uses persistent connection)
#[tauri::command]
pub fn ssh_upload_file(
    _config: SSHConfig,
    local_path: String,
    remote_path: String,
) -> ApiResponse<String> {
    match upload_with_persistent_session(&local_path, &remote_path) {
        Ok(_) => ApiResponse::success(format!("File uploaded to {}", remote_path)),
        Err(e) => ApiResponse::error(format!("File upload failed: {}. Please reconnect.", e)),
    }
}

/// Debug: Run a raw command and return full output (for testing)
#[tauri::command]
pub fn ssh_debug_command(command: String) -> ApiResponse<String> {
    match execute_with_persistent_session(&command) {
        Ok(output) => ApiResponse::success(output),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Check printer queue status via SSH (uses persistent connection)
#[tauri::command]
pub fn ssh_check_printer_queue(_config: SSHConfig, printer: String) -> ApiResponse<Vec<String>> {
    let command = format!("lpq -P {}", printer);

    let output = match execute_with_persistent_session(&command) {
        Ok(output) => output,
        Err(e) => return ApiResponse::error(format!("Failed to check printer queue: {}. Please reconnect.", e)),
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

/// Submit a print job via SSH lpr command (uses persistent connection)
pub fn submit_print_job_ssh(
    _config: &SSHConfig,
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
    // NUS SoC uses basic lpr syntax: lpr -P queue [-# copies] filename
    let mut lpr_command = format!("lpr -P {}", actual_printer);

    // Add copies (using -# notation as per SoC docs)
    // Note: # needs escaping in shell, use single quotes around the whole number
    if settings.copies > 1 {
        lpr_command.push_str(&format!(" '-#' {}", settings.copies));
    }

    // NUS SoC lpr may not support CUPS -o options
    // Duplex is controlled via queue name (-sx suffix)
    // Paper size and orientation are typically handled by the PDF itself

    // Add the file (quoted to handle spaces in filename)
    lpr_command.push_str(&format!(" \"{}\"", remote_file_path));

    execute_with_persistent_session(&lpr_command)
}

// ========== Persistent Connection Implementation ==========

const KEEPALIVE_INTERVAL_SECS: u32 = 30;

/// Connect and store a persistent SSH session
fn connect_persistent(config: &SSHConfig) -> Result<String, Box<dyn std::error::Error>> {
    let session = create_ssh_session(config)?;

    // Enable keepalive to prevent connection timeout
    session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

    let mut manager = SSH_MANAGER.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;
    manager.session = Some(session);
    manager.config = Some(config.clone());
    manager.update_activity();

    Ok(format!("Connected to {}@{}:{}", config.username, config.host, config.port))
}

/// Disconnect persistent SSH session
fn disconnect_persistent() -> Result<String, Box<dyn std::error::Error>> {
    let mut manager = SSH_MANAGER.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if manager.session.is_none() {
        return Err("No active SSH connection".into());
    }

    manager.session = None;
    manager.config = None;

    Ok("Disconnected from SSH server".to_string())
}

/// Check if session needs reconnection and attempt to reconnect if necessary
/// Returns the config needed for reconnection, or None if session is healthy
fn check_session_health() -> Result<Option<SSHConfig>, Box<dyn std::error::Error>> {
    let mut manager = SSH_MANAGER.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if manager.session.is_none() {
        return Err("No active SSH connection. Please connect first.".into());
    }

    if let Some(ref session) = manager.session {
        match session.keepalive_send() {
            Ok(_) => {
                manager.update_activity();
                return Ok(None); // Session is healthy
            }
            Err(_) => {
                // Session is dead, return config for reconnection
                if let Some(ref config) = manager.config {
                    let config_clone = config.clone();
                    // Clear the dead session
                    manager.session = None;
                    return Ok(Some(config_clone));
                } else {
                    return Err("Connection lost and no config available for reconnection".into());
                }
            }
        }
    }

    Ok(None)
}

/// Ensure we have a valid session, reconnecting if necessary
fn ensure_session_valid() -> Result<(), Box<dyn std::error::Error>> {
    // First check health and get config if reconnection needed
    let reconnect_config = check_session_health()?;

    // If we need to reconnect, do it outside the lock
    if let Some(config) = reconnect_config {
        let new_session = create_ssh_session(&config)?;
        new_session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

        // Now acquire lock again and store the new session
        let mut manager = SSH_MANAGER.lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;
        manager.session = Some(new_session);
        manager.config = Some(config);
        manager.update_activity();
    }

    Ok(())
}

/// Execute a function with a valid session
/// This is the core abstraction that handles session management
fn with_session<T, F>(operation: F) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce(&Session) -> Result<T, Box<dyn std::error::Error>>,
{
    ensure_session_valid()?;

    let manager = SSH_MANAGER.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    let session = manager.session.as_ref()
        .ok_or("No active SSH session")?;

    operation(session)
}

/// Execute command using persistent session
fn execute_with_persistent_session(command: &str) -> Result<String, Box<dyn std::error::Error>> {
    with_session(|session| {
        let mut channel = session.channel_session()?;
        channel.exec(command)?;

        let mut output = String::new();
        channel.read_to_string(&mut output)?;

        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr)?;

        channel.wait_close()?;
        let exit_status = channel.exit_status()?;

        if exit_status != 0 {
            // Include both stdout and stderr in error for debugging
            let error_details = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !output.trim().is_empty() {
                output.trim().to_string()
            } else {
                format!("No error message (command: {})", command)
            };
            return Err(format!("Command failed (exit {}): {}", exit_status, error_details).into());
        }

        Ok(output)
    })
}

/// Upload file using persistent session
fn upload_with_persistent_session(local_path: &str, remote_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let local_file = std::fs::File::open(local_path)?;
    let metadata = local_file.metadata()?;
    let file_size = metadata.len();

    with_session(|session| {
        let mut remote_file = session.scp_send(
            Path::new(remote_path),
            0o644,
            file_size,
            None,
        )?;

        std::io::copy(&mut std::io::BufReader::new(std::fs::File::open(local_path)?), &mut remote_file)?;

        Ok(())
    })
}
