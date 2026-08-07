// Module declarations
mod mcp_server;
mod pdf_service;
mod print_service;
mod ssh_service;
mod storage_service;
mod types;

// Import commands
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

// Import Manager trait for window methods
use tauri::Manager;

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
            // SSH operations
            ssh_connect,
            ssh_disconnect,
            ssh_connection_status,
            ssh_test_connection,
            ssh_execute_command,
            ssh_upload_file,
            ssh_debug_command,
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
            print_submit_job,
            print_check_printer_status,
            print_list_queues,
            print_get_quota,
            print_check_active_jobs,
            // Storage operations
            print_save_history,
            print_get_backup_path,
            print_cleanup_history,
            print_get_storage_info,
        ])
        .setup(|app| {
            // Initialize storage directories
            if let Err(e) = storage_service::ensure_directories() {
                eprintln!(
                    "[App] Warning: Failed to initialize storage directories: {}",
                    e
                );
            }

            // Get the main window
            let _window = app.get_webview_window("main").unwrap();

            // Open DevTools on startup (you can remove this line if you only want keyboard shortcut)
            #[cfg(debug_assertions)]
            _window.open_devtools();

            // Note: In production builds, users can press F12 or use the menu to open DevTools
            // The window.open_devtools() method is available in both dev and production

            // Save history on window close
            let window = app.get_webview_window("main").unwrap();
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
