use crate::types::*;
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

/// Test SSH connection with given configuration
#[tauri::command]
pub fn ssh_test_connection(config: SSHConfig) -> ApiResponse<String> {
    match test_ssh_connection_internal(&config) {
        Ok(message) => ApiResponse::success(message),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Execute a command via SSH
#[tauri::command]
pub fn ssh_execute_command(config: SSHConfig, command: String) -> ApiResponse<String> {
    match execute_ssh_command_internal(&config, &command) {
        Ok(output) => ApiResponse::success(output),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Upload a file via SSH/SCP
#[tauri::command]
pub fn ssh_upload_file(
    config: SSHConfig,
    local_path: String,
    remote_path: String,
) -> ApiResponse<String> {
    match upload_file_internal(&config, &local_path, &remote_path) {
        Ok(_) => ApiResponse::success(format!("File uploaded to {}", remote_path)),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Check printer queue status via SSH
#[tauri::command]
pub fn ssh_check_printer_queue(config: SSHConfig, printer: String) -> ApiResponse<Vec<String>> {
    let command = format!("lpq -P {}", printer);
    match execute_ssh_command_internal(&config, &command) {
        Ok(output) => {
            let jobs: Vec<String> = output.lines().map(|s| s.to_string()).collect();
            ApiResponse::success(jobs)
        }
        Err(e) => ApiResponse::error(e.to_string()),
    }
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
    // Build lpr command according to NUS SoC documentation
    let mut lpr_command = format!("lpr -P {}", printer);

    // Add copies (using -# notation as per SoC docs)
    if settings.copies > 1 {
        lpr_command.push_str(&format!(" -\\# {}", settings.copies));
    }

    // Add duplex options
    // Note: Single-sided queues have -sx suffix, double-sided don't
    match settings.duplex {
        DuplexMode::DuplexLongEdge => {
            lpr_command.push_str(" -o sides=two-sided-long-edge");
        }
        DuplexMode::DuplexShortEdge => {
            lpr_command.push_str(" -o sides=two-sided-short-edge");
        }
        DuplexMode::Simplex => {
            lpr_command.push_str(" -o sides=one-sided");
        }
    }

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
