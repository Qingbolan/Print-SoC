//! Agent operations reuse the same account, conversion and job lifecycle as the UI.
use crate::{
    mcp_server::{
        bool_arg, build_print_settings, required_string, structured_tool_result, tool_error,
    },
    types::*,
};
use serde_json::{json, Map, Value};
use std::path::Path;

pub(crate) fn settings_schema() -> Map<String, Value> {
    json!({
        "copies":{"type":"integer","minimum":1,"maximum":99},
        "paper_size":{"type":"string","enum":["A4","A3"]},
        "duplex":{"type":"string","enum":["simplex","duplex_long_edge","duplex_short_edge"]},
        "orientation":{"type":"string","enum":["portrait","landscape"]},
        "pages_per_sheet":{"type":"integer","enum":[1,2,4,6,9]},
        "booklet":{"type":"boolean"},
        "color_mode":{"type":"string","enum":["auto","monochrome","color"]},
        "scaling":{"type":"string","enum":["fit","actual_size"]},
        "page_range":{"oneOf":[
            {"type":"object","properties":{"type":{"const":"All"}},"required":["type"],"additionalProperties":false},
            {"type":"object","properties":{"type":{"const":"Range"},"start":{"type":"integer","minimum":1},"end":{"type":"integer","minimum":1}},"required":["type","start","end"],"additionalProperties":false},
            {"type":"object","properties":{"type":{"const":"Selection"},"pages":{"type":"array","items":{"type":"integer","minimum":1},"minItems":1}},"required":["type","pages"],"additionalProperties":false}
        ]}
    }).as_object().unwrap().clone()
}
fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false}})
}
pub fn tool_definitions() -> Vec<Value> {
    let mut plan = settings_schema();
    plan.insert("file_path".into(), json!({"type":"string"}));
    plan.insert("printer".into(), json!({"type":"string"}));
    let id = json!({"job_id":{"type":"string"}});
    let confirmed = json!({"job_id":{"type":"string"},"confirm":{"type":"boolean"}});
    vec![
        tool("get_saved_account","Read the shared account identity without exposing credentials.",json!({}),&[]),
        tool("prepare_document","Convert a supported image, Office/text document or PDF to the retained preview PDF. Does not print.",json!({"file_path":{"type":"string"}}),&["file_path"]),
        tool("prepare_print_job","Create a durable pending job and a layout preview with the requested settings. Does not submit. Reuse its job_id when authorized.",Value::Object(plan),&["file_path","printer"]),
        tool("submit_print_job","Submit an existing reviewed job once. Requires explicit authorization; no automatic resubmission.",confirmed.clone(),&["job_id","confirm"]),
        tool("list_print_jobs","Read shared desktop, agent and native history, newest first.",json!({}),&[]),
        tool("get_print_job","Read a retained job, settings and tracking evidence.",id.clone(),&["job_id"]),
        tool("get_job_preview","Return the retained layout preview PDF path and page information.",id.clone(),&["job_id"]),
        tool("refresh_print_jobs","Refresh active jobs for the connected account using complete long-format queue evidence.",json!({}),&[]),
        tool("cancel_print_job","Cancel this user's exact job. Requires authorization; uses its persisted queue and identity.",confirmed.clone(),&["job_id","confirm"]),
        tool("confirm_print_output","Record the user's explicit confirmation that the printed paper was received. Never infer this from queue departure.",confirmed,&["job_id","confirm"]),
        tool("get_queue_snapshot","Read long-format queue jobs with checked_at, diagnostics and jobs_complete; only complete snapshots support position counts.",json!({"printer":{"type":"string"}}),&["printer"]),
        tool("find_printers","Filter live discovered printers by access/capabilities/location; defaults to public access. Includes fresh queue health when requested.",json!({"building":{"type":"string"},"paper_size":{"type":"string","enum":["A4","A3"]},"color":{"type":"boolean"},"duplex":{"type":"boolean"},"allowed_access":{"type":"array","items":{"type":"string","enum":["public","staff","restricted","unknown"]}},"check_queues":{"type":"boolean"}}),&[]),
        tool("system_printer_status","Inspect the installed native service and selected destination without exposing connection tokens.",json!({}),&[]),
        tool("configure_system_printer","Preview or apply native system-printer setup using the shared account. Defaults to dry_run. Real changes require confirm=true and local administrator authorization.",json!({"printer":{"type":"string"},"name":{"type":"string"},"paper_size":{"type":"string","enum":["A4","A3"]},"duplex":{"type":"string","enum":["simplex","duplex-long-edge","duplex-short-edge"]},"dry_run":{"type":"boolean"},"confirm":{"type":"boolean"}}),&["printer"]),
        tool("remove_system_printer","Preview or remove the native system printer, preserving account/history. Defaults to dry_run.",json!({"name":{"type":"string"},"dry_run":{"type":"boolean"},"confirm":{"type":"boolean"}}),&[]),
    ]
}
fn unwrap_response<T>(response: ApiResponse<T>) -> Result<T, String> {
    if !response.success {
        return Err(response.error.unwrap_or_else(|| "Operation failed".into()));
    }
    response.data.ok_or("Missing operation result".into())
}
fn current() -> Result<SSHConfig, String> {
    crate::ssh_service::ssh_current_config().ok_or(
        "Connect first with connect_ssh; empty arguments use the saved desktop account".into(),
    )
}
fn confirmed(args: &Value) -> Result<(), String> {
    if !bool_arg(args, "confirm", false)? {
        return Err(
            "This operation requires confirm=true for the user's authorized request".into(),
        );
    }
    Ok(())
}
fn job(args: &Value) -> Result<PrintJob, String> {
    unwrap_response(crate::print_service::print_get_job(required_string(
        args, "job_id",
    )?))
}
fn preview(job: &PrintJob) -> Result<Value, String> {
    let path = crate::pdf_service::retained_layout(job, ||false)?;
    let info = crate::pdf_service::get_pdf_info_internal(&path).map_err(|e| e.to_string())?;
    Ok(json!({"file_path":path,"info":info,"settings":job.settings,"mime_type":"application/pdf"}))
}
fn configure(args: &Value, remove: bool) -> Result<Value, String> {
    let dry = bool_arg(args, "dry_run", true)?;
    if !dry {
        confirmed(args)?;
    }
    let mut cmd = std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    cmd.arg(if remove {
        "--uninstall-system-printer"
    } else {
        "--install-system-printer"
    });
    cmd.args(["--non-interactive", "--plain"]);
    if dry {
        cmd.arg("--dry-run");
    } else {
        cmd.arg("--yes");
    }
    for (key, flag) in [
        ("printer", "--printer"),
        ("name", "--name"),
        ("paper_size", "--paper-size"),
        ("duplex", "--duplex"),
    ] {
        if let Some(value) = args.get(key) {
            cmd.arg(flag)
                .arg(value.as_str().ok_or("Expected string option")?);
        }
    }
    cmd.stdin(std::process::Stdio::null());
    let result =
        crate::process_service::run_capture(&mut cmd, std::time::Duration::from_secs(120), || {
            false
        })
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(result.diagnostic);
    }
    Ok(json!({"dry_run":dry,"message":result.output}))
}
pub fn call(name: &str, args: &Value) -> Option<Value> {
    if !tool_definitions().iter().any(|t| t["name"] == name) {
        return None;
    }
    let result = (|| -> Result<Value, String> {
        match name {
            "get_saved_account" => Ok(
                json!({"account":unwrap_response(crate::account_service::account_current(None))?}),
            ),
            "prepare_document" => Ok(serde_json::to_value(crate::document_service::prepare(
                Path::new(&required_string(args, "file_path")?),
            )?)
            .map_err(|e| e.to_string())?),
            "prepare_print_job" => {
                let doc = crate::document_service::prepare(Path::new(&required_string(
                    args,
                    "file_path",
                )?))?;
                let requested = required_string(args, "printer")?;
                let settings = build_print_settings(args)?;
                let printer = crate::ssh_service::queue_for_duplex_mode(&requested, matches!(settings.duplex, DuplexMode::Simplex));
                crate::printer_catalog::validate_destination(&printer, &settings)?;
                let job = unwrap_response(crate::print_service::print_create_job(
                    doc.name, doc.path, printer, settings,
                ))?;
                match preview(&job) {
                    Ok(preview) => Ok(json!({"job":job,"preview":preview})),
                    Err(error) => {
                        Ok(json!({"job":job,"preview_error":error,"ready_for_review":false}))
                    }
                }
            }
            "submit_print_job" => {
                confirmed(args)?;
                let job = job(args)?;
                if job.status != PrintJobStatus::Pending {
                    return Err("Only an unsubmitted pending job can be submitted; inspect its history before creating another".into());
                }
                let message =
                    unwrap_response(crate::print_service::submit_job(job.id.clone(), current()?))?;
                Ok(
                    json!({"result":message,"job":unwrap_response(crate::print_service::print_get_job(job.id))?}),
                )
            }
            "list_print_jobs" => {
                Ok(json!({"jobs":unwrap_response(crate::print_service::print_get_all_jobs())?}))
            }
            "get_print_job" => Ok(serde_json::to_value(job(args)?).map_err(|e| e.to_string())?),
            "get_job_preview" => preview(&job(args)?),
            "refresh_print_jobs" => {
                let response = unwrap_response(
                    crate::print_service::print_check_active_jobs_blocking(current()?),
                )?;
                Ok(
                    json!({"refresh":response,"jobs":unwrap_response(crate::print_service::print_get_all_jobs())?}),
                )
            }
            "cancel_print_job" => {
                confirmed(args)?;
                let job = job(args)?;
                let config = if matches!(
                    job.status,
                    PrintJobStatus::Pending | PrintJobStatus::Failed | PrintJobStatus::Uploading
                ) {
                    SSHConfig {
                        host: String::new(),
                        port: 22,
                        username: String::new(),
                        auth_type: SSHAuthType::StoredPassword,
                    }
                } else {
                    current()?
                };
                Ok(
                    json!({"result":unwrap_response(crate::print_service::print_cancel_job_blocking(job.id.clone(),config))?,"job":unwrap_response(crate::print_service::print_get_job(job.id))?}),
                )
            }
            "confirm_print_output" => {
                confirmed(args)?;
                Ok(serde_json::to_value(unwrap_response(
                    crate::print_service::print_resolve_submission(
                        required_string(args, "job_id")?,
                        true,
                    ),
                )?)
                .map_err(|e| e.to_string())?)
            }
            "get_queue_snapshot" => {
                Ok(serde_json::to_value(crate::ssh_service::queue_snapshot_for(
                    &SSHIdentity::from(&current()?),
                    &required_string(args, "printer")?,
                )?)
                .map_err(|e| e.to_string())?)
            }
            "find_printers" => {
                let config = current()?;
                let queues =
                    unwrap_response(crate::ssh_service::ssh_list_print_queues(config.clone()))?;
                let mut printers = crate::printer_catalog::find(&queues, args)?;
                if bool_arg(args, "check_queues", false)? {
                    for printer in &mut printers {
                        match crate::ssh_service::queue_snapshot_for(
                            &SSHIdentity::from(&config),
                            printer["queue_name"].as_str().unwrap(),
                        ) {
                            Ok(snapshot) => {
                                printer["status"] = json!(snapshot.status);
                                printer["queue_count"] = if snapshot.jobs_complete {
                                    json!(snapshot.jobs.len())
                                } else {
                                    Value::Null
                                };
                                printer["snapshot"] = json!(snapshot);
                            }
                            Err(error) => {
                                printer["queue_error"] = json!(error);
                                printer["queue_count"] = Value::Null;
                            }
                        }
                    }
                    printers.sort_by_key(|p| {
                        (
                            p["status"]
                                .as_str()
                                .is_some_and(|s| matches!(s, "Offline" | "Error" | "OutOfPaper")),
                            p["queue_count"].as_u64().unwrap_or(u64::MAX),
                        )
                    });
                }
                Ok(json!({"printers":printers,"checked_at":chrono::Utc::now()}))
            }
            "system_printer_status" => crate::native_install::inspect(),
            "configure_system_printer" => configure(args, false),
            "remove_system_printer" => configure(args, true),
            _ => unreachable!(),
        }
    })();
    Some(match result {
        Ok(value) => structured_tool_result(value),
        Err(error) => tool_error(error),
    })
}
