// Module declarations
mod types;
mod ssh_service;
mod pdf_service;
mod print_service;
mod storage_service;

// Import commands
use ssh_service::{
    ssh_connect, ssh_disconnect, ssh_connection_status,
    ssh_test_connection, ssh_execute_command, ssh_upload_file, ssh_check_printer_queue,
    ssh_debug_command, check_network_connectivity, exit_app
};
use pdf_service::{pdf_get_info, pdf_generate_booklet_layout, pdf_create_booklet, pdf_create_nup};
use print_service::{
    print_create_job, print_get_all_jobs, print_get_job, print_update_job_status,
    print_cancel_job, print_delete_job, print_submit_job, print_get_printers,
    print_check_printer_status, print_check_active_jobs,
    print_save_history, print_get_backup_path, print_cleanup_history, print_get_storage_info,
};

// Import Manager trait for window methods
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
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
            ssh_check_printer_queue,
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
            print_get_printers,
            print_check_printer_status,
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
                eprintln!("[App] Warning: Failed to initialize storage directories: {}", e);
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
