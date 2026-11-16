// Module declarations
mod credential_service;
mod document_service;
mod integration_service;
mod mcp_server;
mod pdf_service;
mod process_service;
mod print_service;
mod job_lifecycle;
mod submission_receipt;
mod queue_status;
mod ssh_service;
mod scp_transfer;
mod storage_service;
mod types;
mod window_chrome;

// Import commands
use integration_service::{integration_add_virtual_printer, app_open_devtools, integration_get_status, integration_test_mcp};
use pdf_service::{pdf_create_booklet, pdf_create_nup, pdf_generate_booklet_layout, pdf_get_info};
use print_service::{
    print_cancel_job, print_check_active_jobs, print_check_printer_status, print_cleanup_history,
    print_create_job, print_delete_job, print_get_all_jobs, print_get_backup_path, print_get_job,
    print_get_quota, print_get_storage_info, print_list_queues, print_save_history,
    print_submit_job, print_update_job_status,
};
use ssh_service::{
    check_network_connectivity, exit_app, ssh_connect, ssh_connection_status, ssh_debug_command,
    ssh_disconnect, ssh_execute_command, ssh_test_connection, ssh_upload_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if mcp_server::is_mcp_command(&args) {
        let exit_code = match mcp_server::run_stdio() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("[MCP] Server failed: {}", e);
                1
            }
        };
        std::process::exit(exit_code);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_geolocation::init())
        .invoke_handler(tauri::generate_handler![
            // App control
            exit_app,
            check_network_connectivity,
            app_open_devtools,
            credential_service::credential_save,
            credential_service::credential_delete,
            // SSH operations
            ssh_connect,
            ssh_disconnect,
            ssh_connection_status,
            ssh_test_connection,
            ssh_execute_command,
            ssh_upload_file,
            ssh_debug_command,
            document_service::document_prepare,
            document_service::document_extensions,
            // PDF operations
            pdf_get_info,
            pdf_generate_booklet_layout,
            pdf_create_booklet,
            pdf_create_nup,
            // Print job operations
            print_create_job,
            print_get_all_jobs,
            print_get_job,
            print_update_job_status,
            print_cancel_job,
            print_delete_job,
            print_service::print_resolve_submission,
            print_service::print_link_job_account,
            print_submit_job,
            print_check_printer_status,
            print_service::print_get_queue_snapshot,
            print_list_queues,
            print_get_quota,
            print_check_active_jobs,
            // Storage operations
            print_save_history,
            print_get_backup_path,
            print_cleanup_history,
            print_get_storage_info,
            integration_get_status,
            integration_add_virtual_printer,
            integration_test_mcp,
        ])
        .setup(|app| {
            // Initialize storage directories
            if let Err(e) = storage_service::ensure_directories() {
                eprintln!(
                    "[App] Warning: Failed to initialize storage directories: {}",
                    e
                );
            }

            // Save history on window close
            let window = window_chrome::create_main_window(app)?;
            window.on_window_event(|event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    eprintln!("[App] Window closing, saving print history...");
                    if let Err(e) = print_service::save_if_dirty() {
                        eprintln!("[App] Failed to save history on close: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
