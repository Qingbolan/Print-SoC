use crate::print_service;
use crate::ssh_service;
use crate::storage_service;
use crate::types::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::Path;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

pub fn is_mcp_command(args: &[String]) -> bool {
    args.iter().any(|arg| {
        matches!(
            arg.as_str(),
            "mcp" | "mcp-server" | "--mcp" | "--mcp-server"
        )
    })
}

pub fn run_stdio() -> Result<(), Box<dyn std::error::Error>> {
    if let Err(e) = storage_service::ensure_directories() {
        eprintln!(
            "[MCP] Warning: failed to initialize storage directories: {}",
            e
        );
    }

    eprintln!("[MCP] Print@SoC MCP server started on stdio");

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(e) => {
                send_error(
                    &mut writer,
                    Value::Null,
                    -32700,
                    format!("Parse error: {}", e),
                )?;
                continue;
            }
        };

        if !request.is_object() {
            send_error(
                &mut writer,
                Value::Null,
                -32600,
                "Invalid request: expected JSON object".to_string(),
            )?;
            continue;
        }

        let method = match request.get("method").and_then(Value::as_str) {
            Some(method) => method,
            None => {
                // JSON-RPC responses from clients do not need server handling.
                continue;
            }
        };

        let id = request.get("id").cloned();
        let params = request.get("params").cloned().unwrap_or(Value::Null);

        if id.is_none() {
            handle_notification(method);
            continue;
        }

        let id = id.unwrap_or(Value::Null);
        match handle_request(method, &params) {
            Ok(result) => send_result(&mut writer, id, result)?,
            Err((code, message)) => send_error(&mut writer, id, code, message)?,
        }
    }

    Ok(())
}

fn handle_notification(method: &str) {
    match method {
        "notifications/initialized" => eprintln!("[MCP] Client initialized"),
        "notifications/cancelled" => eprintln!("[MCP] Request cancelled by client"),
        "exit" => eprintln!("[MCP] Client requested exit"),
        _ => eprintln!("[MCP] Ignoring notification: {}", method),
    }
}

fn handle_request(method: &str, params: &Value) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => Ok(initialize_result(params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => handle_tool_call(params),
        "shutdown" => Ok(Value::Null),
        _ => Err((-32601, format!("Method not found: {}", method))),
    }
}

fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(MCP_PROTOCOL_VERSION);
    let protocol_version = match requested {
        "2025-06-18" | "2025-03-26" | "2024-11-05" => requested,
        _ => MCP_PROTOCOL_VERSION,
    };

    json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {
                "listChanged": false
            }
        },
        "serverInfo": {
            "name": "print-soc",
            "title": "Print@SoC MCP Server",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": "Use connect_ssh before calling print queue, quota, or submit tools. submit_pdf_print_job requires confirm=true because it sends a real print job."
    })
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "connect_ssh",
            "title": "Connect to SoC SSH",
            "description": "Connect to a NUS SoC SSH server and keep a persistent session for subsequent print tools. Credentials may be supplied as arguments or via PSOC_SSH_* environment variables.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "enum": ["stu", "stf"],
                        "description": "Convenience server selector. Ignored when host is provided."
                    },
                    "host": {
                        "type": "string",
                        "description": "SSH host. Defaults to stu.comp.nus.edu.sg or PSOC_SSH_HOST."
                    },
                    "port": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 65535,
                        "description": "SSH port. Defaults to 22 or PSOC_SSH_PORT."
                    },
                    "username": {
                        "type": "string",
                        "description": "SoC UNIX username. Defaults to PSOC_SSH_USERNAME."
                    },
                    "auth_type": {
                        "type": "string",
                        "enum": ["password", "private_key"],
                        "description": "Authentication type. Inferred from password/key_path when omitted."
                    },
                    "password": {
                        "type": "string",
                        "description": "SSH password. Defaults to PSOC_SSH_PASSWORD."
                    },
                    "key_path": {
                        "type": "string",
                        "description": "Private key path. Defaults to PSOC_SSH_KEY_PATH."
                    },
                    "passphrase": {
                        "type": "string",
                        "description": "Private key passphrase. Defaults to PSOC_SSH_KEY_PASSPHRASE."
                    }
                }
            }
        }),
        json!({
            "name": "disconnect_ssh",
            "title": "Disconnect SoC SSH",
            "description": "Close the current persistent SoC SSH session.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "connection_status",
            "title": "Connection Status",
            "description": "Return whether this MCP server currently has an active SSH session.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "list_print_queues",
            "title": "List Print Queues",
            "description": "List print queues from the connected SoC server.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "check_print_quota",
            "title": "Check Print Quota",
            "description": "Run pusage on the connected SoC server and return parsed print quota information.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "check_printer_queue",
            "title": "Check Printer Queue",
            "description": "Run lpq for a specific SoC print queue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "printer": {
                        "type": "string",
                        "description": "Safe print queue name, for example psts-dx or psts-sx."
                    }
                },
                "required": ["printer"]
            }
        }),
        json!({
            "name": "submit_pdf_print_job",
            "title": "Submit PDF Print Job",
            "description": "Submit a local PDF to a SoC print queue through the connected SSH session. This performs a real print operation and requires confirm=true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Local PDF file path."
                    },
                    "printer": {
                        "type": "string",
                        "description": "Target SoC print queue."
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Must be true to submit the print job."
                    },
                    "copies": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 99,
                        "description": "Number of copies. Defaults to 1."
                    },
                    "duplex": {
                        "type": "string",
                        "enum": ["simplex", "duplex_long_edge", "duplex_short_edge"],
                        "description": "Duplex mode. Defaults to duplex_long_edge."
                    },
                    "orientation": {
                        "type": "string",
                        "enum": ["portrait", "landscape"],
                        "description": "Page orientation. Defaults to portrait."
                    },
                    "pages_per_sheet": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 16,
                        "description": "N-up pages per sheet. Defaults to 1."
                    },
                    "booklet": {
                        "type": "boolean",
                        "description": "Create a booklet layout before printing. Defaults to false."
                    },
                    "paper_size": {
                        "type": "string",
                        "enum": ["A4", "A3"],
                        "description": "Paper size. Defaults to A4."
                    }
                },
                "required": ["file_path", "printer", "confirm"]
            }
        }),
    ]
}

fn handle_tool_call(params: &Value) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tools/call requires params.name".to_string()))?;
    let arguments = params.get("arguments").unwrap_or(&Value::Null);

    match name {
        "connect_ssh" => Ok(connect_ssh_tool(arguments)),
        "disconnect_ssh" => Ok(api_tool_result("message", ssh_service::ssh_disconnect())),
        "connection_status" => Ok(api_tool_result(
            "connected",
            ssh_service::ssh_connection_status(),
        )),
        "list_print_queues" => Ok(api_tool_result(
            "queues",
            ssh_service::ssh_list_print_queues(empty_ssh_config()),
        )),
        "check_print_quota" => Ok(api_tool_result(
            "quota",
            ssh_service::ssh_get_print_quota(empty_ssh_config()),
        )),
        "check_printer_queue" => Ok(check_printer_queue_tool(arguments)),
        "submit_pdf_print_job" => Ok(submit_pdf_print_job_tool(arguments)),
        _ => Err((-32602, format!("Unknown tool: {}", name))),
    }
}

fn connect_ssh_tool(arguments: &Value) -> Value {
    match build_ssh_config(arguments) {
        Ok(config) => api_tool_result("message", ssh_service::ssh_connect_blocking(config)),
        Err(e) => tool_error(e),
    }
}

fn check_printer_queue_tool(arguments: &Value) -> Value {
    let printer = match required_string(arguments, "printer") {
        Ok(value) => value,
        Err(e) => return tool_error(e),
    };

    api_tool_result(
        "jobs",
        ssh_service::ssh_check_printer_queue(empty_ssh_config(), printer),
    )
}

fn submit_pdf_print_job_tool(arguments: &Value) -> Value {
    match bool_arg(arguments, "confirm", false) {
        Ok(true) => {}
        Ok(false) => {
            return tool_error(
                "submit_pdf_print_job requires confirm=true because it sends a real print job",
            )
        }
        Err(e) => return tool_error(e),
    }

    let file_path = match required_string(arguments, "file_path") {
        Ok(value) => value,
        Err(e) => return tool_error(e),
    };
    let printer = match required_string(arguments, "printer") {
        Ok(value) => value,
        Err(e) => return tool_error(e),
    };
    let settings = match build_print_settings(arguments) {
        Ok(value) => value,
        Err(e) => return tool_error(e),
    };
    let ssh_config = match ssh_service::ssh_current_config() {
        Some(config) => config,
        None => return tool_error("No active SSH connection. Call connect_ssh first."),
    };

    let job_name = Path::new(&file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("MCP print job")
        .to_string();

    let create_response =
        print_service::print_create_job(job_name, file_path.clone(), printer, settings);
    if !create_response.success {
        return api_tool_result("job", create_response);
    }

    let job = match create_response.data {
        Some(job) => job,
        None => return tool_error("Print job was not created"),
    };

    let submit_response = print_service::print_submit_job(job.id.clone(), ssh_config);
    if !submit_response.success {
        return api_tool_result("message", submit_response);
    }

    let message = submit_response.data.unwrap_or_default();
    let job_id = job.id.clone();
    let saved_job = print_service::print_get_job(job_id).data.unwrap_or(job);
    let _ = print_service::print_save_history();

    structured_tool_result(json!({
        "message": message,
        "job": saved_job
    }))
}

fn build_ssh_config(arguments: &Value) -> Result<SSHConfig, String> {
    let server = optional_string(arguments, "server").or_else(|| env_string("PSOC_SSH_SERVER"));
    let host = optional_string(arguments, "host")
        .or_else(|| env_string("PSOC_SSH_HOST"))
        .unwrap_or_else(|| match server.as_deref() {
            Some("stf") => "stf.comp.nus.edu.sg".to_string(),
            _ => "stu.comp.nus.edu.sg".to_string(),
        });
    let port = optional_port(arguments)?.unwrap_or_else(|| {
        env_string("PSOC_SSH_PORT")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(22)
    });
    let username = optional_string(arguments, "username")
        .or_else(|| env_string("PSOC_SSH_USERNAME"))
        .ok_or_else(|| "Missing username. Provide username or PSOC_SSH_USERNAME.".to_string())?;

    let requested_auth = optional_string(arguments, "auth_type");
    let password =
        optional_string(arguments, "password").or_else(|| env_string("PSOC_SSH_PASSWORD"));
    let key_path =
        optional_string(arguments, "key_path").or_else(|| env_string("PSOC_SSH_KEY_PATH"));
    let passphrase =
        optional_string(arguments, "passphrase").or_else(|| env_string("PSOC_SSH_KEY_PASSPHRASE"));

    let auth_type = match requested_auth.as_deref() {
        Some("password") => SSHAuthType::Password {
            password: password.ok_or_else(|| {
                "Password auth requires password or PSOC_SSH_PASSWORD.".to_string()
            })?,
        },
        Some("private_key") => SSHAuthType::PrivateKey {
            key_path: key_path.ok_or_else(|| {
                "Private key auth requires key_path or PSOC_SSH_KEY_PATH.".to_string()
            })?,
            passphrase,
        },
        Some(other) => return Err(format!("Unsupported auth_type: {}", other)),
        None => {
            if let Some(password) = password {
                SSHAuthType::Password { password }
            } else if let Some(key_path) = key_path {
                SSHAuthType::PrivateKey {
                    key_path,
                    passphrase,
                }
            } else {
                return Err(
                    "Missing SSH auth. Provide password/key_path or PSOC_SSH_PASSWORD/PSOC_SSH_KEY_PATH."
                        .to_string(),
                );
            }
        }
    };

    Ok(SSHConfig {
        host,
        port,
        username,
        auth_type,
    })
}

fn build_print_settings(arguments: &Value) -> Result<PrintSettings, String> {
    let pages_per_sheet = u32_arg(arguments, "pages_per_sheet", 1, 1, 16)?;
    let booklet = bool_arg(arguments, "booklet", false)?;
    if pages_per_sheet > 1 && booklet {
        return Err("booklet cannot be combined with pages_per_sheet > 1".to_string());
    }

    Ok(PrintSettings {
        copies: u32_arg(arguments, "copies", 1, 1, 99)?,
        duplex: parse_duplex(arguments)?,
        orientation: parse_orientation(arguments)?,
        page_range: PageRange::All,
        pages_per_sheet,
        booklet,
        paper_size: parse_paper_size(arguments)?,
    })
}

fn parse_duplex(arguments: &Value) -> Result<DuplexMode, String> {
    match optional_string(arguments, "duplex")
        .unwrap_or_else(|| "duplex_long_edge".to_string())
        .as_str()
    {
        "simplex" | "Simplex" => Ok(DuplexMode::Simplex),
        "duplex" | "duplex_long_edge" | "DuplexLongEdge" => Ok(DuplexMode::DuplexLongEdge),
        "duplex_short_edge" | "DuplexShortEdge" => Ok(DuplexMode::DuplexShortEdge),
        value => Err(format!("Unsupported duplex value: {}", value)),
    }
}

fn parse_orientation(arguments: &Value) -> Result<Orientation, String> {
    match optional_string(arguments, "orientation")
        .unwrap_or_else(|| "portrait".to_string())
        .as_str()
    {
        "portrait" | "Portrait" => Ok(Orientation::Portrait),
        "landscape" | "Landscape" => Ok(Orientation::Landscape),
        value => Err(format!("Unsupported orientation value: {}", value)),
    }
}

fn parse_paper_size(arguments: &Value) -> Result<PaperSize, String> {
    match optional_string(arguments, "paper_size")
        .unwrap_or_else(|| "A4".to_string())
        .as_str()
    {
        "A4" | "a4" => Ok(PaperSize::A4),
        "A3" | "a3" => Ok(PaperSize::A3),
        value => Err(format!("Unsupported paper_size value: {}", value)),
    }
}

fn api_tool_result<T: Serialize>(key: &str, response: ApiResponse<T>) -> Value {
    if response.success {
        let data = response
            .data
            .map(|data| serde_json::to_value(data).unwrap_or(Value::Null))
            .unwrap_or(Value::Null);
        structured_tool_result(json!({ key: data }))
    } else {
        tool_error(
            response
                .error
                .unwrap_or_else(|| "Unknown error".to_string()),
        )
    }
}

fn structured_tool_result(structured: Value) -> Value {
    let text = serde_json::to_string_pretty(&structured).unwrap_or_else(|_| "{}".to_string());
    json!({
        "content": [
            {
                "type": "text",
                "text": text
            }
        ],
        "structuredContent": structured,
        "isError": false
    })
}

fn tool_error(message: impl Into<String>) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": message.into()
            }
        ],
        "isError": true
    })
}

fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    optional_string(arguments, key)
        .ok_or_else(|| format!("Missing required string argument: {}", key))
}

fn optional_string(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn optional_port(arguments: &Value) -> Result<Option<u16>, String> {
    match arguments.get("port") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => {
            let port = number
                .as_u64()
                .ok_or_else(|| "port must be an integer from 1 to 65535".to_string())?;
            if (1..=65535).contains(&port) {
                Ok(Some(port as u16))
            } else {
                Err("port must be an integer from 1 to 65535".to_string())
            }
        }
        Some(_) => Err("port must be an integer from 1 to 65535".to_string()),
    }
}

fn bool_arg(arguments: &Value, key: &str, default: bool) -> Result<bool, String> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(format!("{} must be a boolean", key)),
    }
}

fn u32_arg(arguments: &Value, key: &str, default: u32, min: u32, max: u32) -> Result<u32, String> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Number(number)) => {
            let value = number
                .as_u64()
                .ok_or_else(|| format!("{} must be an integer from {} to {}", key, min, max))?;
            if value < min as u64 || value > max as u64 {
                return Err(format!(
                    "{} must be an integer from {} to {}",
                    key, min, max
                ));
            }
            Ok(value as u32)
        }
        Some(_) => Err(format!(
            "{} must be an integer from {} to {}",
            key, min, max
        )),
    }
}

fn env_string(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn empty_ssh_config() -> SSHConfig {
    SSHConfig {
        host: String::new(),
        port: 22,
        username: String::new(),
        auth_type: SSHAuthType::Password {
            password: String::new(),
        },
    }
}

fn send_result(writer: &mut impl Write, id: Value, result: Value) -> io::Result<()> {
    send_message(
        writer,
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        }),
    )
}

fn send_error(writer: &mut impl Write, id: Value, code: i64, message: String) -> io::Result<()> {
    send_message(
        writer,
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": code,
                "message": message
            }
        }),
    )
}

fn send_message(writer: &mut impl Write, message: Value) -> io::Result<()> {
    let encoded = serde_json::to_string(&message)?;
    writer.write_all(encoded.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
}
