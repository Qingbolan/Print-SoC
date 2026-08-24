use crate::mcp_server::MCP_PROTOCOL_VERSION;
use crate::types::ApiResponse;
use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const VIRTUAL_PRINTER_NAME: &str = "PrintAtSoC";
const CUPS_BACKEND_NAME: &str = "printatsoc";

#[derive(Debug, Serialize)]
pub struct CliIntegrationStatus {
    pub available: bool,
    pub command: Option<String>,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct VirtualPrinterStatus {
    pub supported: bool,
    pub registered: bool,
    pub backend_installed: bool,
    pub configured: bool,
    pub backend_path: Option<String>,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct McpIntegrationStatus {
    pub available: bool,
    pub command: String,
    pub protocol_version: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeIntegrationStatus {
    pub debug_build: bool,
    pub devtools_available: bool,
    pub plugins: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct IntegrationStatus {
    pub platform: String,
    pub cli: CliIntegrationStatus,
    pub virtual_printer: VirtualPrinterStatus,
    pub mcp_server: McpIntegrationStatus,
    pub runtime: RuntimeIntegrationStatus,
}

fn command_path(command: &str) -> Option<PathBuf> {
    let lookup = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    if let Ok(output) = Command::new(lookup).arg(command).output() {
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let candidate = PathBuf::from(path.trim());
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin").join(command));
        candidates.push(home.join("Library/Python/3.12/bin").join(command));
        candidates.push(home.join("Library/Python/3.11/bin").join(command));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(command));
    candidates.push(PathBuf::from("/usr/local/bin").join(command));

    candidates.into_iter().find(|path| path.exists())
}

fn find_cli() -> Option<PathBuf> {
    command_path("print-soc").or_else(|| command_path("psoc"))
}

fn cups_backend_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("/usr/libexec/cups/backend").join(CUPS_BACKEND_NAME),
        PathBuf::from("/usr/lib/cups/backend").join(CUPS_BACKEND_NAME),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn virtual_printer_registered() -> bool {
    Command::new("lpstat")
        .args(["-p", VIRTUAL_PRINTER_NAME])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn virtual_printer_configured() -> bool {
    let system_config = Path::new("/etc/print-at-soc/virtual-printer.json");
    let user_config = dirs::home_dir()
        .map(|home| home.join(".PrintAtSoC/virtual-printer.json"))
        .unwrap_or_default();
    system_config.exists() || user_config.exists()
}

#[tauri::command]
pub fn integration_get_status() -> ApiResponse<IntegrationStatus> {
    let platform = env::consts::OS.to_string();
    let virtual_printer_supported = matches!(env::consts::OS, "macos" | "linux");
    let cli_path = find_cli();
    let backend_path = cups_backend_path();
    let registered = virtual_printer_supported && virtual_printer_registered();
    let configured = virtual_printer_configured();
    let current_executable = env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "print-soc".to_string());

    let virtual_printer_detail = if !virtual_printer_supported {
        "CUPS registration is available on macOS and Linux.".to_string()
    } else if registered && backend_path.is_some() && configured {
        "Queue, CUPS backend, and forwarding configuration are ready.".to_string()
    } else if registered || backend_path.is_some() || configured {
        "Registration is incomplete. Repair the missing queue, backend, or configuration."
            .to_string()
    } else {
        "The system virtual printer is not registered.".to_string()
    };

    ApiResponse::success(IntegrationStatus {
        platform,
        cli: CliIntegrationStatus {
            available: cli_path.is_some(),
            command: cli_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            detail: if cli_path.is_some() {
                "Print@SoC CLI bridge detected.".to_string()
            } else {
                "Install the print-at-soc CLI before registering the virtual printer.".to_string()
            },
        },
        virtual_printer: VirtualPrinterStatus {
            supported: virtual_printer_supported,
            registered,
            backend_installed: backend_path.is_some(),
            configured,
            backend_path: backend_path.map(|path| path.to_string_lossy().to_string()),
            detail: virtual_printer_detail,
        },
        mcp_server: McpIntegrationStatus {
            available: true,
            command: current_executable,
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
            detail: "The stdio server starts on demand when an MCP client connects.".to_string(),
        },
        runtime: RuntimeIntegrationStatus {
            debug_build: cfg!(debug_assertions),
            devtools_available: cfg!(debug_assertions),
            plugins: vec![
                "Dialog".to_string(),
                "Filesystem".to_string(),
                "Geolocation".to_string(),
                "Process".to_string(),
                "Shell".to_string(),
            ],
        },
    })
}

#[tauri::command]
pub fn integration_test_mcp() -> ApiResponse<String> {
    let executable = match env::current_exe() {
        Ok(path) => path,
        Err(error) => return ApiResponse::error(format!("Cannot locate executable: {}", error)),
    };

    let mut child = match Command::new(executable)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return ApiResponse::error(format!("Cannot start MCP server: {}", error)),
    };

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Print@SoC Settings",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    if let Some(mut stdin) = child.stdin.take() {
        if writeln!(stdin, "{}", request).is_err() {
            let _ = child.kill();
            return ApiResponse::error("Cannot write MCP health-check request".to_string());
        }
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => return ApiResponse::error(format!("MCP health check failed: {}", error)),
    };

    let response_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .to_string();
    let response: Value = match serde_json::from_str(&response_line) {
        Ok(value) => value,
        Err(error) => {
            return ApiResponse::error(format!("Invalid MCP response: {}", error));
        }
    };

    if response.get("result").is_some() {
        ApiResponse::success(format!(
            "MCP handshake succeeded with protocol {}",
            MCP_PROTOCOL_VERSION
        ))
    } else {
        ApiResponse::error("MCP server returned an initialization error".to_string())
    }
}

#[tauri::command]
pub fn app_open_devtools(window: tauri::WebviewWindow) -> ApiResponse<String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
        ApiResponse::success("Developer console opened".to_string())
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        ApiResponse::error("Developer tools are disabled in release builds".to_string())
    }
}
