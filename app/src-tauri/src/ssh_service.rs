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
    generation: u64,
}

impl SSHConnectionManager {
    fn new() -> Self {
        Self {
            session: None,
            config: None,
            last_activity: Instant::now(),
            generation: 0,
        }
    }

    fn is_connected(&self) -> bool {
        self.session.is_some()
    }

    fn update_activity(&mut self) {
        self.last_activity = Instant::now();
    }

    fn begin_connection(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    fn finish_connection(&mut self, generation: u64, session: Session, config: SSHConfig) -> Result<(), String> {
        if self.generation != generation {
            return Err("Connection request was superseded by a newer connection or disconnect".into());
        }
        self.session = Some(session);
        self.config = Some(config);
        self.update_activity();
        Ok(())
    }

    fn disconnect(&mut self) {
        self.begin_connection();
        self.session = None;
        self.config = None;
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
pub fn ssh_execute_command(config: SSHConfig, command: String) -> ApiResponse<String> {
    match execute_for_account(&SSHIdentity::from(&config), &command) {
        Ok(output) => ApiResponse::success(output),
        Err(e) => ApiResponse::error(format!("SSH command failed: {}. Please reconnect.", e)),
    }
}

/// Upload a file via SSH/SCP (uses persistent connection)
#[tauri::command]
pub fn ssh_upload_file(
    config: SSHConfig,
    local_path: String,
    remote_path: String,
) -> ApiResponse<String> {
    match upload_with_progress(&SSHIdentity::from(&config), &local_path, &remote_path, &mut |_, _| Ok(())) {
        Ok(_) => ApiResponse::success(format!("File uploaded to {}", remote_path)),
        Err(e) => ApiResponse::error(format!("File upload failed; print command was not sent: {}", e)),
    }
}

/// List print queues from /etc/printcap via SSH (uses persistent connection).
pub(crate) fn ssh_list_print_queues(config: SSHConfig) -> ApiResponse<Vec<String>> {
    // Mirrors SOCprint's /etc/printcap discovery while stripping optional aliases.
    let command = "awk -F'[:|]' '/^[pc]/ { print $1 }' /etc/printcap | sort -u";

    let output = match execute_command_for(Some(&SSHIdentity::from(&config)), command, false, COMMAND_TIMEOUT_MS) {
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
pub(crate) fn ssh_get_print_quota(config: SSHConfig) -> ApiResponse<PrintQuota> {
    let command =
        "if command -v pusage >/dev/null 2>&1; then pusage; else /usr/local/bin/pusage; fi";

    match execute_command_for(Some(&SSHIdentity::from(&config)), command, true, COMMAND_TIMEOUT_MS) {
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
    config: SSHConfig,
    printer: String,
) -> ApiResponse<Vec<PrintQueueJob>> {
    match queue_snapshot_for(&SSHIdentity::from(&config), &printer) {
        Ok(snapshot) => ApiResponse::success(snapshot.jobs),
        Err(error) => ApiResponse::error(error),
    }
}

pub(crate) fn queue_snapshot(printer: &str) -> Result<QueueSnapshot, String> {
    validate_print_queue_name(printer)?;
    let output = execute_with_persistent_session(&format!("lpq -l -P {}", printer))
        .map_err(|error| format!("Failed to query queue: {}", error))?;
    Ok(crate::queue_status::parse(&output))
}

// ========== Internal Implementation ==========

const CONNECTION_TIMEOUT_SECS: u64 = 3;
const AUTH_TIMEOUT_MS: u32 = 30_000;
const COMMAND_TIMEOUT_MS: u32 = 30_000;
const PRINT_TIMEOUT_MS: u32 = 180_000;
const UPLOAD_TIMEOUT_MS: u32 = 120_000;

struct SessionTimeout<'a> { session: &'a Session, previous: u32 }
impl<'a> SessionTimeout<'a> {
    fn new(session: &'a Session, timeout: u32) -> Self {
        let previous = session.timeout();
        session.set_timeout(timeout);
        Self { session, previous }
    }
}
impl Drop for SessionTimeout<'_> {
    fn drop(&mut self) { self.session.set_timeout(self.previous); }
}

#[derive(Debug)]
pub(crate) struct RemoteExit { pub code: i32, pub output: String }
impl std::fmt::Display for RemoteExit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Remote command exited with {}: {}", self.code, self.output.trim())
    }
}
impl std::error::Error for RemoteExit {}

#[derive(Debug)]
pub struct PrintSubmissionError { pub uncertain: bool, message: String }
impl std::fmt::Display for PrintSubmissionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.message) }
}
impl std::error::Error for PrintSubmissionError {}
impl PrintSubmissionError {
    fn preparation(error: impl std::fmt::Display) -> Self {
        Self { uncertain: false, message: format!("Remote PDF preparation failed; print command was not sent: {}", error) }
    }
    fn submission(error: Box<dyn std::error::Error>) -> Self {
        let uncertain = error.downcast_ref::<RemoteExit>().is_none();
        let message = if uncertain {
            format!("Submission not confirmed: {}. The printer may have accepted the job. Check the printer queue before printing again; no automatic retry was made.", error)
        } else { format!("Printer rejected the submission: {}", error) };
        Self { uncertain, message }
    }
}

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

    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(AUTH_TIMEOUT_MS);
    sess.handshake()?;
    eprintln!("[SSH] Handshake completed");

    match &config.auth_type {
        SSHAuthType::StoredPassword => {
            let password = crate::credential_service::load_password(config)?;
            sess.userauth_password(&config.username, &password)?;
        }
        SSHAuthType::Password { password } => {
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
    attempt: &SubmissionAttempt,
    printer: &str,
    remote_file_path: &str,
    settings: &PrintSettings,
    before_submit: impl FnOnce() -> Result<(), String>,
    native: Option<&NativePrintInfo>,
) -> Result<String, PrintSubmissionError> {
    // NUS SoC public queues use explicit suffixes documented by SOCprint:
    // - -dx: double-sided
    // - -sx: single-sided
    // - -nb: no banner
    // Older app versions used base queues like psts/pstsb/pstsc, so keep those
    // as aliases while preferring explicit public queue names.
    // Validate the complete submission before doing any remote work.
    if let Some(native) = native {
        // CUPS already applied page ranges, orientation, scaling and n-up.
        // Preserve the exact spool PDF; only physical device options remain.
        let options=crate::native_service::physical_options(&native.options).map_err(PrintSubmissionError::preparation)?;
        let command=build_lpr_command_with_options(printer,remote_file_path,settings,&options).map_err(PrintSubmissionError::preparation)?;
        before_submit().map_err(PrintSubmissionError::preparation)?;
        return crate::submission_receipt::submit(attempt, &command).map_err(PrintSubmissionError::submission);
    }
    let scaled_path = format!("{}.scaled.pdf", remote_file_path);
    let lpr_command = build_lpr_command(printer, &scaled_path, settings).map_err(PrintSubmissionError::preparation)?;
    let (width_pts, height_pts) = print_page_dimensions(settings);

    // Create scaled PDF path
    let scaled_path_arg = shell_quote(&scaled_path);
    let remote_file_arg = shell_quote(remote_file_path);

    // Step 1: Scale PDF on server using ghostscript (available on NUS servers)
    // -dPDFFitPage: scale content to fit page
    // -dFIXEDMEDIA: force output page size
    let scale_command = format!(
        "umask 077; gs -sDEVICE=pdfwrite {} -dFIXEDMEDIA -dAutoRotatePages=/None \
         -dDEVICEWIDTHPOINTS={} -dDEVICEHEIGHTPOINTS={} \
         -dCompatibilityLevel=1.4 -dNOPAUSE -dBATCH -dQUIET \
         -sOutputFile={} {}",
        if settings.scaling == ScalingMode::Fit { "-dPDFFitPage" } else { "" }, width_pts, height_pts, scaled_path_arg, remote_file_arg
    );

    eprintln!(
        "[SSH] Scaling PDF on server: {} -> {}",
        remote_file_path, scaled_path
    );
    // Do not submit an unscaled or partially written document after conversion failure.
    let started = Instant::now();
    let prepared = execute_command_for(Some(&attempt.account), &scale_command, false, PRINT_TIMEOUT_MS);
    eprintln!("[SSH] PDF preparation finished in {:?}: {}", started.elapsed(),
        if prepared.is_ok() { "success" } else { "failed" });
    let result = prepared.map_err(PrintSubmissionError::preparation).and_then(|_| {
        before_submit().map_err(PrintSubmissionError::preparation)?;
        eprintln!("[SSH] Submitting print job: {}", lpr_command);
        let started = Instant::now();
        let submitted = crate::submission_receipt::submit(attempt, &lpr_command);
        eprintln!("[SSH] Print submission finished in {:?}: {}", started.elapsed(),
            if submitted.is_ok() { "acknowledged" } else { "error" });
        submitted.map_err(PrintSubmissionError::submission)
    });

    // Step 3: Cleanup scaled file
    if result.is_ok() || result.as_ref().is_err_and(|error| !error.uncertain) {
        let _ = execute_for_account(&attempt.account, &format!("rm -f {}", shell_quote(&scaled_path)));
    }

    result
}

/// Binding is a physical paper edge; orientation must not silently change it.
fn build_lpr_command(
    printer: &str,
    file_path: &str,
    settings: &PrintSettings,
) -> Result<String, String> {
    build_lpr_command_with_options(printer,file_path,settings,&[])
}

fn build_lpr_command_with_options(printer:&str,file_path:&str,settings:&PrintSettings,options:&[(String,String)]) -> Result<String,String> {
    let queue = queue_for_duplex_mode(printer, matches!(settings.duplex, DuplexMode::Simplex));
    validate_print_queue_name(&queue)?;
    let sides = match settings.duplex {
        DuplexMode::Simplex => "one-sided",
        DuplexMode::DuplexLongEdge => "two-sided-long-edge",
        DuplexMode::DuplexShortEdge => "two-sided-short-edge",
    };
    let mut command = format!("lpr -P {} -o sides={}", queue, sides);
    match settings.color_mode {
        ColorMode::Auto => {},
        ColorMode::Monochrome => command.push_str(" -o print-color-mode=monochrome"),
        ColorMode::Color => command.push_str(" -o print-color-mode=color"),
    }
    if settings.copies > 1 {
        command.push_str(&format!(" '-#' {}", settings.copies));
    }
    for (key,value) in options { command.push_str(&format!(" -o {}",shell_quote(&format!("{key}={value}")))); }
    command.push_str(&format!(" {}", shell_quote(file_path)));
    Ok(command)
}

fn print_page_dimensions(settings: &PrintSettings) -> (u32, u32) {
    let (width, height) = match settings.paper_size {
        PaperSize::A4 => (595, 842),
        PaperSize::A3 => (842, 1191),
    };
    match settings.orientation {
        Orientation::Portrait => (width, height),
        Orientation::Landscape => (height, width),
    }
}

// ========== Persistent Connection Implementation ==========

const KEEPALIVE_INTERVAL_SECS: u32 = 30;

/// Connect and store a persistent SSH session
fn connect_persistent(config: &SSHConfig) -> Result<String, Box<dyn std::error::Error>> {
    let (generation, active) = {
        let mut manager = SSH_MANAGER.lock().map_err(|_| "Connection state unavailable")?;
        (manager.begin_connection(), manager.get_config())
    };
    // Resolve saved credentials once per connection lifecycle. Reconnects use only
    // the in-memory session secret, which disconnect_persistent clears.
    let mut resolved = config.clone();
    if matches!(resolved.auth_type, SSHAuthType::StoredPassword) {
        let password = match active {
            Some(SSHConfig { host, port, username, auth_type: SSHAuthType::Password { password } })
                if host == config.host && port == config.port && username == config.username => password,
            _ => crate::credential_service::load_password(config)?,
        };
        resolved.auth_type = SSHAuthType::Password { password };
    }
    let session = create_ssh_session(&resolved)?;

    // Enable keepalive to prevent connection timeout
    session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

    let mut manager = SSH_MANAGER
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;
    manager.finish_connection(generation, session, resolved)?;

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

    // Disconnect is idempotent, including after a failed reconnect.
    manager.disconnect();

    Ok("Disconnected from SSH server".to_string())
}

/// Check if session needs reconnection and attempt to reconnect if necessary
/// Returns the config needed for reconnection, or None if session is healthy
fn check_session_health() -> Result<Option<(SSHConfig, u64)>, Box<dyn std::error::Error>> {
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
                    return Ok(Some((config_clone, manager.generation)));
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
    if let Some((config, generation)) = reconnect_config {
        let new_session = create_ssh_session(&config)?;
        new_session.set_keepalive(true, KEEPALIVE_INTERVAL_SECS);

        // Now acquire lock again and store the new session
        let mut manager = SSH_MANAGER
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;
        manager.finish_connection(generation, new_session, config)?;
    }

    Ok(())
}

/// Execute a function with a valid session
/// This is the core abstraction that handles session management
fn with_session_for<T, F>(account: Option<&SSHIdentity>, operation: F) -> Result<T, Box<dyn std::error::Error>>
where F: FnOnce(&Session) -> Result<T, Box<dyn std::error::Error>> {
    ensure_session_valid()?;
    let manager = SSH_MANAGER.lock().map_err(|e| format!("Failed to acquire lock: {}", e))?;
    if let Some(expected) = account {
        if manager.config.as_ref().map(SSHIdentity::from).as_ref() != Some(expected) {
            return Err("The connected account changed. Reconnect to the account that submitted this job.".into());
        }
    }
    let session = manager.session.as_ref().ok_or("No active SSH session")?;
    operation(session)
}

pub(crate) fn execute_for_account(account: &SSHIdentity, command: &str) -> Result<String, Box<dyn std::error::Error>> {
    execute_command_for(Some(account), command, false, PRINT_TIMEOUT_MS)
}

pub(crate) fn queue_snapshot_for(account: &SSHIdentity, printer: &str) -> Result<QueueSnapshot, String> {
    validate_print_queue_name(printer)?;
    let output = execute_for_account(account, &format!("lpq -l -P {}", printer)).map_err(|e| e.to_string())?;
    Ok(crate::queue_status::parse(&output))
}

/// All command channels drain merged stdout/stderr to avoid stream backpressure deadlocks.
fn execute_command(command: &str, pty: bool, timeout_ms: u32) -> Result<String, Box<dyn std::error::Error>> {
    execute_command_for(None, command, pty, timeout_ms)
}

fn execute_command_for(account: Option<&SSHIdentity>, command: &str, pty: bool, timeout_ms: u32) -> Result<String, Box<dyn std::error::Error>> {
    with_session_for(account, |session| {
        let _timeout = SessionTimeout::new(session, timeout_ms);
        let mut channel = session.channel_session()?;
        if pty { channel.request_pty("xterm", None, Some((80, 24, 0, 0)))?; }
        channel.handle_extended_data(ssh2::ExtendedData::Merge)?;
        channel.exec(command)?;
        let mut output = String::new();
        channel.read_to_string(&mut output)?;
        channel.wait_close()?;
        let code = channel.exit_status()?;
        if code != 0 { return Err(Box::new(RemoteExit { code, output })); }
        Ok(output)
    })
}

fn execute_with_persistent_session(command: &str) -> Result<String, Box<dyn std::error::Error>> {
    execute_command(command, false, COMMAND_TIMEOUT_MS)
}

/// Upload file using persistent session
pub(crate) fn upload_with_progress(
    account: &SSHIdentity,
    local_path: &str,
    remote_path: &str,
    progress: &mut impl FnMut(u64, u64) -> std::io::Result<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let local_file = std::fs::File::open(local_path)?;
    let metadata = local_file.metadata()?;
    let file_size = metadata.len();

    with_session_for(Some(account), |session| {
        let _timeout = SessionTimeout::new(session, UPLOAD_TIMEOUT_MS);
        let mut remote_file = session.scp_send(Path::new(remote_path), 0o600, file_size, None)?;

        crate::scp_transfer::send_contents_observed(&mut std::io::BufReader::new(local_file), &mut remote_file, file_size, progress)?;
        remote_file.send_eof()?;
        remote_file.wait_eof()?;
        remote_file.close()?;
        remote_file.wait_close()?;
        let code = remote_file.exit_status()?;
        if code != 0 {
            let mut diagnostic = String::new();
            remote_file.stderr().take(4096).read_to_string(&mut diagnostic)?;
            return Err(Box::new(RemoteExit { code, output: diagnostic }));
        }
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

pub(crate) fn queue_for_duplex_mode(queue: &str, simplex: bool) -> String {
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

pub(crate) fn parse_lpq_jobs(output: &str) -> Vec<PrintQueueJob> {
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
        files: vec![],
        origin: None,
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
    fn stale_connection_cannot_restore_account_after_disconnect_or_switch() {
        let config = |username: &str| SSHConfig {
            host: "stu".into(), port: 22, username: username.into(),
            auth_type: SSHAuthType::StoredPassword,
        };
        let mut manager = SSHConnectionManager::new();
        let old = manager.begin_connection();
        manager.disconnect();
        assert!(manager.finish_connection(old, Session::new().unwrap(), config("alice")).is_err());
        assert!(!manager.is_connected());
        assert!(manager.get_config().is_none());

        let reconnect = manager.begin_connection();
        let replacement = manager.begin_connection();
        manager.finish_connection(replacement, Session::new().unwrap(), config("bob")).unwrap();
        assert!(manager.finish_connection(reconnect, Session::new().unwrap(), config("alice")).is_err());
        assert_eq!(manager.get_config().unwrap().username, "bob");
    }

    #[test]
    fn scoped_operation_timeout_restores_even_on_failure() {
        let session = Session::new().unwrap();
        session.set_timeout(AUTH_TIMEOUT_MS);
        let operation = || -> Result<(), &'static str> {
            let _timeout = SessionTimeout::new(&session, PRINT_TIMEOUT_MS);
            assert_eq!(session.timeout(), PRINT_TIMEOUT_MS);
            Err("simulated timeout")
        };
        assert!(operation().is_err());
        assert_eq!(session.timeout(), AUTH_TIMEOUT_MS);
    }

    #[test]
    fn uncertain_submission_is_distinguished_from_remote_rejection() {
        let timeout = std::io::Error::new(std::io::ErrorKind::TimedOut, "Timed out waiting on socket");
        let error = PrintSubmissionError::submission(Box::new(timeout));
        assert!(error.uncertain);
        assert!(error.to_string().contains("no automatic retry"));
        let rejected = PrintSubmissionError::submission(Box::new(RemoteExit { code: 1, output: "queue unavailable".into() }));
        assert!(!rejected.uncertain);
        let preparation = PrintSubmissionError::preparation("conversion timed out");
        assert!(!preparation.uncertain);
        assert!(preparation.to_string().contains("print command was not sent"));
    }

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

    fn duplex_test_settings(duplex: DuplexMode, orientation: Orientation) -> PrintSettings {
        PrintSettings {
            color_mode: ColorMode::Auto, scaling: ScalingMode::Fit,
            copies: 2,
            duplex,
            orientation,
            page_range: PageRange::All,
            pages_per_sheet: 1,
            booklet: false,
            paper_size: PaperSize::A4,
        }
    }

    #[test]
    fn submission_preserves_binding_for_both_orientations_and_layouts() {
        for orientation in [Orientation::Portrait, Orientation::Landscape] {
            for (mode, suffix, sides) in [
                (DuplexMode::Simplex, "sx", "one-sided"),
                (DuplexMode::DuplexLongEdge, "dx", "two-sided-long-edge"),
                (DuplexMode::DuplexShortEdge, "dx", "two-sided-short-edge"),
            ] {
                for (pages_per_sheet, booklet) in [(1, false), (2, false), (1, true)] {
                    let mut settings = duplex_test_settings(mode.clone(), orientation.clone());
                    settings.pages_per_sheet = pages_per_sheet;
                    settings.booklet = booklet;
                    assert_eq!(
                        build_lpr_command("psts-sx", "/tmp/alice's file.pdf", &settings).unwrap(),
                        format!("lpr -P psts-{} -o sides={} '-#' 2 {}", suffix, sides,
                            shell_quote("/tmp/alice's file.pdf"))
                    );
                }
            }
        }
    }

    #[test]
    fn submission_validates_queue_and_preserves_no_banner() {
        let mut settings = duplex_test_settings(DuplexMode::DuplexShortEdge, Orientation::Portrait);
        settings.copies = 1;
        assert!(build_lpr_command("psts; touch /tmp/unwanted", "/tmp/test.pdf", &settings).is_err());
        assert_eq!(build_lpr_command("psts-nb", "/tmp/test.pdf", &settings).unwrap(),
            "lpr -P psts-nb -o sides=two-sided-short-edge '/tmp/test.pdf'");
    }

    #[test]
    fn paper_dimensions_respect_orientation_and_size() {
        let mut settings = duplex_test_settings(DuplexMode::DuplexShortEdge, Orientation::Landscape);
        assert_eq!(print_page_dimensions(&settings), (842, 595));
        settings.paper_size = PaperSize::A3;
        assert_eq!(print_page_dimensions(&settings), (1191, 842));
        settings.orientation = Orientation::Portrait;
        assert_eq!(print_page_dimensions(&settings), (842, 1191));
        settings.paper_size = PaperSize::A4;
        assert_eq!(print_page_dimensions(&settings), (595, 842));
    }

    #[test]
    fn shell_quotes_single_quotes() {
        assert_eq!(
            shell_quote("/tmp/alice's file.pdf"),
            "'/tmp/alice'\"'\"'s file.pdf'"
        );
    }
}
