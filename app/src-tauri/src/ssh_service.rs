use crate::types::*;
use lazy_static::lazy_static;
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ========== App Exit ==========

/// Exit the application
#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}

// ========== Network Connectivity Check ==========

/// Check if the app can reach NUS SoC network by attempting TCP connection
/// Parallel check: both servers checked simultaneously, 3 second timeout
#[tauri::command]
pub fn check_network_connectivity() -> ApiResponse<bool> {
    use std::net::ToSocketAddrs;
    use std::sync::mpsc;
    use std::thread;

    let hosts = ["stu.comp.nus.edu.sg:22", "stf.comp.nus.edu.sg:22"];
    let timeout = Duration::from_secs(3);
    let (tx, rx) = mpsc::channel();

    // Spawn threads to check both servers in parallel
    for host in hosts {
        let tx = tx.clone();
        let host = host.to_string();
        thread::spawn(move || {
            if let Ok(mut addrs) = host.to_socket_addrs() {
                if let Some(addr) = addrs.next() {
                    if TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok() {
                        let _ = tx.send(true);
                    }
                }
            }
        });
    }
    drop(tx); // Close sender so rx.recv_timeout works correctly

    // Wait for first success or timeout
    match rx.recv_timeout(timeout) {
        Ok(true) => ApiResponse::success(true),
        _ => ApiResponse::error(
            "Cannot connect to NUS SoC network. Please connect to NUS WiFi or VPN.".to_string(),
        ),
    }
}

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
    static ref SSH_MANAGER: Arc<Mutex<SSHConnectionManager>> =
        Arc::new(Mutex::new(SSHConnectionManager::new()));
}

/// Connect to SSH server and establish persistent connection (async, non-blocking)
#[tauri::command]
pub async fn ssh_connect(config: SSHConfig) -> ApiResponse<String> {
    // Run blocking SSH connection in a separate thread
    let result = tauri::async_runtime::spawn_blocking(move || {
        connect_persistent(&config).map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(message)) => ApiResponse::success(message),
        Ok(Err(e)) => ApiResponse::error(e),
        Err(e) => ApiResponse::error(format!("Task failed: {}", e)),
    }
}

/// Connect to SSH from non-Tauri entrypoints such as the MCP stdio server.
pub fn ssh_connect_blocking(config: SSHConfig) -> ApiResponse<String> {
    match connect_persistent(&config) {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Return the current persistent SSH configuration, if connected.
pub fn ssh_current_config() -> Option<SSHConfig> {
    SSH_MANAGER
        .lock()
        .ok()
        .and_then(|manager| manager.get_config())
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

/// List print queues from /etc/printcap via SSH (uses persistent connection).
pub(crate) fn ssh_list_print_queues(_config: SSHConfig) -> ApiResponse<Vec<String>> {
    // Mirrors SOCprint's /etc/printcap discovery while stripping optional aliases.
    let command = "awk -F'[:|]' '/^p/ { print $1 }' /etc/printcap | sort -u";

    let output = match execute_with_persistent_session(command) {
        Ok(output) => output,
        Err(e) => {
            return ApiResponse::error(format!(
                "Failed to list print queues: {}. Please reconnect.",
                e
            ))
        }
    };

    let queues = output
        .lines()
        .map(str::trim)
        .filter(|queue| is_safe_print_queue_name(queue))
        .map(ToString::to_string)
        .collect();

    ApiResponse::success(queues)
}

/// Check print quota via pusage. pusage requires a PTY on SoC Unix servers.
pub(crate) fn ssh_get_print_quota(_config: SSHConfig) -> ApiResponse<PrintQuota> {
    let command =
        "if command -v pusage >/dev/null 2>&1; then pusage; else /usr/local/bin/pusage; fi";

    match execute_with_persistent_session_pty(command) {
        Ok(output) => ApiResponse::success(parse_print_quota_output(&output)),
        Err(e) => ApiResponse::error(format!(
            "Failed to check print quota: {}. Please reconnect.",
            e
        )),
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

/// Check printer queue status via SSH (uses persistent connection).
pub(crate) fn ssh_check_printer_queue(
    _config: SSHConfig,
    printer: String,
) -> ApiResponse<Vec<PrintQueueJob>> {
    if let Err(e) = validate_print_queue_name(&printer) {
        return ApiResponse::error(e);
    }

    let command = format!("lpq -P {}", printer);

    let output = match execute_with_persistent_session(&command) {
        Ok(output) => output,
        Err(e) => {
            return ApiResponse::error(format!(
                "Failed to check printer queue: {}. Please reconnect.",
                e
            ))
        }
    };

    ApiResponse::success(parse_lpq_jobs(&output))
}

// ========== Internal Implementation ==========

const CONNECTION_TIMEOUT_SECS: u64 = 3; // 3 seconds max per attempt

fn create_ssh_session(config: &SSHConfig) -> Result<Session, Box<dyn std::error::Error>> {
    // Single attempt, no retries - fail fast with 3s timeout
    try_create_ssh_session(config)
}

fn try_create_ssh_session(config: &SSHConfig) -> Result<Session, Box<dyn std::error::Error>> {
    use std::net::ToSocketAddrs;
    use std::sync::mpsc;
    use std::thread;

    eprintln!(
        "[SSH] Connecting to {}@{}:{}",
        config.username, config.host, config.port
    );

    // Resolve hostname
    let addr_string = format!("{}:{}", config.host, config.port);
    let addrs: Vec<_> = addr_string
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve hostname {}: {}", config.host, e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("No IP address found for hostname: {}", config.host).into());
    }

    eprintln!("[SSH] Resolved to {} IP(s): {:?}", addrs.len(), addrs);

    // Try all addresses in parallel, first success wins
    let (tx, rx) = mpsc::channel();

    for addr in addrs {
        let tx = tx.clone();
        thread::spawn(move || {
            eprintln!("[SSH] Trying IP: {}", addr);
            if let Ok(stream) =
                TcpStream::connect_timeout(&addr, Duration::from_secs(CONNECTION_TIMEOUT_SECS))
            {
                eprintln!("[SSH] TCP connection established to {}", addr);
                let _ = tx.send(stream);
            }
        });
    }
    drop(tx); // Close sender

    // Wait max 3 seconds for first successful connection
    let tcp = rx
        .recv_timeout(Duration::from_secs(CONNECTION_TIMEOUT_SECS))
        .map_err(|_| "Connection timeout - no server reachable")?;

    // Set read/write timeouts
    tcp.set_read_timeout(Some(Duration::from_secs(CONNECTION_TIMEOUT_SECS)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(CONNECTION_TIMEOUT_SECS)))?;

    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(CONNECTION_TIMEOUT_SECS as u32 * 1000); // milliseconds
    sess.handshake()?;
    eprintln!("[SSH] Handshake completed");

    match &config.auth_type {
        SSHAuthType::Password { password } => {
            eprintln!(
                "[SSH] Authenticating with password (length: {})",
                password.len()
            );
            sess.userauth_password(&config.username, password)?;
        }
        SSHAuthType::PrivateKey {
            key_path,
            passphrase,
        } => {
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
/// Scales PDF on server-side using gs before printing
pub fn submit_print_job_ssh(
    _config: &SSHConfig,
    printer: &str,
    remote_file_path: &str,
    settings: &PrintSettings,
) -> Result<String, Box<dyn std::error::Error>> {
    // NUS SoC public queues use explicit suffixes documented by SOCprint:
    // - -dx: double-sided
    // - -sx: single-sided
    // - -nb: no banner
    // Older app versions used base queues like psts/pstsb/pstsc, so keep those
    // as aliases while preferring explicit public queue names.
    let actual_printer = match settings.duplex {
        DuplexMode::Simplex => queue_for_duplex_mode(printer, true),
        DuplexMode::DuplexLongEdge | DuplexMode::DuplexShortEdge => {
            queue_for_duplex_mode(printer, false)
        }
    };

    validate_print_queue_name(&actual_printer)
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

    // Paper size dimensions in points
    let (width_pts, height_pts) = match settings.paper_size {
        PaperSize::A4 => (595, 842),
        PaperSize::A3 => (842, 1191),
    };

    // Create scaled PDF path
    let scaled_path = remote_file_path.replace(".pdf", "_scaled.pdf");
    let scaled_path_arg = shell_quote(&scaled_path);
    let remote_file_arg = shell_quote(remote_file_path);

    // Step 1: Scale PDF on server using ghostscript (available on NUS servers)
    // -dPDFFitPage: scale content to fit page
    // -dFIXEDMEDIA: force output page size
    let scale_command = format!(
        "gs -sDEVICE=pdfwrite -dPDFFitPage -dFIXEDMEDIA \
         -dDEVICEWIDTHPOINTS={} -dDEVICEHEIGHTPOINTS={} \
         -dCompatibilityLevel=1.4 -dNOPAUSE -dBATCH -dQUIET \
         -sOutputFile={} {} 2>/dev/null || cp {} {}",
        width_pts, height_pts, scaled_path_arg, remote_file_arg, remote_file_arg, scaled_path_arg
    );

    eprintln!(
        "[SSH] Scaling PDF on server: {} -> {}",
        remote_file_path, scaled_path
    );
    let scale_result = execute_with_persistent_session(&scale_command);
    if let Err(e) = &scale_result {
        eprintln!("[SSH] PDF scaling warning: {}", e);
        // Continue with original file if scaling fails
    }

    // Step 2: Build lpr command
    let print_file = &scaled_path;
    let mut lpr_command = format!("lpr -P {}", actual_printer);

    // Add copies (using -# notation as per SoC docs)
    if settings.copies > 1 {
        lpr_command.push_str(&format!(" '-#' {}", settings.copies));
    }

    // Add the file
    lpr_command.push_str(&format!(" {}", shell_quote(print_file)));

    eprintln!("[SSH] Submitting print job: {}", lpr_command);
    let result = execute_with_persistent_session(&lpr_command);

    // Step 3: Cleanup scaled file
    let _ = execute_with_persistent_session(&format!("rm -f {}", shell_quote(&scaled_path)));

    result
}

// ========== Persistent Connection Implementation ==========

const KEEPALIVE_INTERVAL_SECS: u32 = 30;

/// Connect and store a persistent SSH session
fn connect_persistent(config: &SSHConfig) -> Result<String, Box<dyn std::error::Error>> {
    let session = create_ssh_session(config)?;

    // Enable keepalive to prevent connection timeout
    session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

    let mut manager = SSH_MANAGER
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;
    manager.session = Some(session);
    manager.config = Some(config.clone());
    manager.update_activity();

    Ok(format!(
        "Connected to {}@{}:{}",
        config.username, config.host, config.port
    ))
}

/// Disconnect persistent SSH session
fn disconnect_persistent() -> Result<String, Box<dyn std::error::Error>> {
    let mut manager = SSH_MANAGER
        .lock()
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
    let mut manager = SSH_MANAGER
        .lock()
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
        let mut manager = SSH_MANAGER
            .lock()
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

    let manager = SSH_MANAGER
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    let session = manager.session.as_ref().ok_or("No active SSH session")?;

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

/// Execute a command using a PTY. Required by tools such as /usr/local/bin/pusage.
fn execute_with_persistent_session_pty(
    command: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    with_session(|session| {
        let mut channel = session.channel_session()?;
        channel.request_pty("xterm", None, Some((80, 24, 0, 0)))?;
        channel.exec(command)?;

        let mut output = String::new();
        channel.read_to_string(&mut output)?;

        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr)?;

        channel.wait_close()?;
        let exit_status = channel.exit_status()?;

        if exit_status != 0 {
            let error_details = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !output.trim().is_empty() {
                output.trim().to_string()
            } else {
                format!("No error message (command: {})", command)
            };
            return Err(format!("Command failed (exit {}): {}", exit_status, error_details).into());
        }

        if stderr.trim().is_empty() {
            Ok(output)
        } else if output.trim().is_empty() {
            Ok(stderr)
        } else {
            Ok(format!("{}\n{}", output.trim_end(), stderr.trim_end()))
        }
    })
}

/// Upload file using persistent session
fn upload_with_persistent_session(
    local_path: &str,
    remote_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let local_file = std::fs::File::open(local_path)?;
    let metadata = local_file.metadata()?;
    let file_size = metadata.len();

    with_session(|session| {
        let mut remote_file = session.scp_send(Path::new(remote_path), 0o644, file_size, None)?;

        std::io::copy(
            &mut std::io::BufReader::new(std::fs::File::open(local_path)?),
            &mut remote_file,
        )?;

        Ok(())
    })
}

fn normalize_legacy_public_queue(queue: &str) -> String {
    match queue {
        "pstsb" => "pstb".to_string(),
        "pstsb-dx" => "pstb-dx".to_string(),
        "pstsb-sx" => "pstb-sx".to_string(),
        "pstsc" => "pstc".to_string(),
        "pstsc-dx" => "pstc-dx".to_string(),
        "pstsc-sx" => "pstc-sx".to_string(),
        _ => queue.to_string(),
    }
}

fn is_socprint_public_base_queue(queue: &str) -> bool {
    matches!(queue, "psc008" | "psc011" | "psts" | "pstb" | "pstc")
}

fn replace_queue_suffix(queue: &str, suffix: &str) -> String {
    if let Some(base) = queue.strip_suffix("-sx") {
        format!("{}-{}", base, suffix)
    } else if let Some(base) = queue.strip_suffix("-dx") {
        format!("{}-{}", base, suffix)
    } else {
        format!("{}-{}", queue, suffix)
    }
}

fn queue_for_duplex_mode(queue: &str, simplex: bool) -> String {
    let normalized = normalize_legacy_public_queue(queue);

    if normalized.ends_with("-nb") {
        return normalized;
    }

    if simplex {
        return replace_queue_suffix(&normalized, "sx");
    }

    if normalized.ends_with("-sx") || normalized.ends_with("-dx") {
        return replace_queue_suffix(&normalized, "dx");
    }

    if is_socprint_public_base_queue(&normalized) {
        return format!("{}-dx", normalized);
    }

    normalized
}

pub(crate) fn validate_print_queue_name(queue: &str) -> Result<(), String> {
    if is_safe_print_queue_name(queue) {
        Ok(())
    } else {
        Err(format!("Invalid print queue name: {}", queue))
    }
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn is_safe_print_queue_name(queue: &str) -> bool {
    !queue.is_empty()
        && queue.len() <= 128
        && queue
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn parse_lpq_jobs(output: &str) -> Vec<PrintQueueJob> {
    output.lines().filter_map(parse_lpq_job_line).collect()
}

fn parse_lpq_job_line(line: &str) -> Option<PrintQueueJob> {
    let trimmed = line.trim();
    if trimmed.is_empty() || should_skip_lpq_line(trimmed) {
        return None;
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 4 || !is_lpq_rank_token(parts[0]) {
        return None;
    }

    let file_parts = &parts[3..];
    let (file, total_size) = split_lpq_file_and_size(file_parts);

    Some(PrintQueueJob {
        rank: parts[0].to_string(),
        owner: parts[1].to_string(),
        job_id: parts[2].to_string(),
        file,
        total_size,
        raw_line: trimmed.to_string(),
    })
}

fn should_skip_lpq_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("printer:")
        || lower.starts_with("queue:")
        || lower.starts_with("rank")
        || lower.contains("no entries")
        || lower.contains("no printable jobs")
        || lower.contains("is ready")
}

fn is_lpq_rank_token(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if matches!(lower.as_str(), "active" | "stalled") {
        return true;
    }

    for suffix in ["st", "nd", "rd", "th"] {
        if let Some(number) = lower.strip_suffix(suffix) {
            return !number.is_empty() && number.chars().all(|c| c.is_ascii_digit());
        }
    }

    false
}

fn split_lpq_file_and_size(parts: &[&str]) -> (String, Option<String>) {
    if parts.len() >= 3 {
        let unit = parts[parts.len() - 1].to_ascii_lowercase();
        let amount = parts[parts.len() - 2];
        let looks_like_size = matches!(
            unit.as_str(),
            "byte" | "bytes" | "kb" | "kbytes" | "mb" | "mbytes" | "gb" | "gbytes"
        ) && amount.chars().any(|c| c.is_ascii_digit());

        if looks_like_size {
            let file = parts[..parts.len() - 2].join(" ");
            let total_size = Some(parts[parts.len() - 2..].join(" "));
            return (file, total_size);
        }
    }

    (parts.join(" "), None)
}

pub(crate) fn normalize_lpq_job_id(job_id: &str) -> String {
    let trimmed = job_id.trim();
    if let Some((_, suffix)) = trimmed.rsplit_once('-') {
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return suffix.to_string();
        }
    }

    trimmed.to_string()
}

fn parse_print_quota_output(output: &str) -> PrintQuota {
    let raw_output = strip_ansi_sequences(output).trim().to_string();
    let lines: Vec<String> = raw_output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect();

    PrintQuota {
        raw_output,
        summary: lines.first().cloned(),
        balance: find_quota_line_value(&lines, &["balance", "remaining", "left"]),
        used: find_quota_line_value(&lines, &["used", "usage", "printed"]),
        limit: find_quota_line_value(&lines, &["quota", "limit", "allocated"]),
    }
}

fn find_quota_line_value(lines: &[String], keys: &[&str]) -> Option<String> {
    for line in lines {
        let lower = line.to_ascii_lowercase();
        if keys.iter().any(|key| lower.contains(key)) {
            if let Some((_, value)) = line.split_once(':') {
                let value = value.trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
            return Some(line.clone());
        }
    }

    None
}

fn strip_ansi_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        } else {
            output.push(ch);
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lpq_jobs_with_total_size() {
        let output = "\
Printer: psts@print
Queue: 2 printable jobs
Rank    Owner   Job     File(s)                         Total Size
active  alice   123     lecture notes.pdf                1024 bytes
1st     bob     124     assignment.pdf                   2048 bytes
";

        let jobs = parse_lpq_jobs(output);

        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].rank, "active");
        assert_eq!(jobs[0].owner, "alice");
        assert_eq!(jobs[0].job_id, "123");
        assert_eq!(jobs[0].file, "lecture notes.pdf");
        assert_eq!(jobs[0].total_size.as_deref(), Some("1024 bytes"));
        assert_eq!(jobs[1].rank, "1st");
    }

    #[test]
    fn ignores_empty_lpq_output() {
        let output = "\
Printer: psts@print
Queue: no printable jobs in queue
";

        assert!(parse_lpq_jobs(output).is_empty());
    }

    #[test]
    fn parses_quota_output_with_ansi_removed() {
        let output = "\u{1b}[32mPrint quota: 10.00 remaining\u{1b}[0m\nUsed: 2.50\n";

        let quota = parse_print_quota_output(output);

        assert_eq!(
            quota.summary.as_deref(),
            Some("Print quota: 10.00 remaining")
        );
        assert_eq!(quota.limit.as_deref(), Some("10.00 remaining"));
        assert_eq!(quota.used.as_deref(), Some("2.50"));
        assert!(!quota.raw_output.contains('\u{1b}'));
    }

    #[test]
    fn normalizes_socprint_public_queue_suffixes() {
        assert_eq!(queue_for_duplex_mode("psts", false), "psts-dx");
        assert_eq!(queue_for_duplex_mode("psts-sx", false), "psts-dx");
        assert_eq!(queue_for_duplex_mode("psts-dx", true), "psts-sx");
        assert_eq!(queue_for_duplex_mode("psc008", true), "psc008-sx");
        assert_eq!(queue_for_duplex_mode("pstsb", false), "pstb-dx");
        assert_eq!(queue_for_duplex_mode("pstsc-sx", false), "pstc-dx");
    }

    #[test]
    fn shell_quotes_single_quotes() {
        assert_eq!(
            shell_quote("/tmp/alice's file.pdf"),
            "'/tmp/alice'\"'\"'s file.pdf'"
        );
    }
}
